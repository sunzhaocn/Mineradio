use crate::providers::request_json;
use anyhow::{Context, Result, ensure};
use futures_util::StreamExt;
use serde::Deserialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::sync::Mutex;
use std::time::Duration;
use tempfile::NamedTempFile;
use tokio::io::AsyncWriteExt;
use url::Url;

const CURRENT: &str = env!("CARGO_PKG_VERSION");
const RELEASES: &str = "https://github.com/sunzhaocn/Mineradio/releases";
const FEED: &str = "https://api.github.com/repos/sunzhaocn/Mineradio/releases";
const MANIFEST_NAME: &str = "mineradio-windows-update.json";
const MANIFEST_URL: &str =
    "https://github.com/sunzhaocn/Mineradio/releases/latest/download/mineradio-windows-update.json";
const MAX_INSTALLER: u64 = 512 * 1024 * 1024;
const MAX_MANIFEST: usize = 4096;

#[derive(Deserialize)]
struct ReleaseManifest {
    version: String,
    size: u64,
    sha256: String,
}

#[derive(Clone)]
pub struct Release {
    version: String,
    url: Url,
    size: u64,
    digest: [u8; 32],
}

#[derive(Default)]
pub struct Updater {
    state: Mutex<State>,
}

struct State {
    status: &'static str,
    release: Option<Release>,
    transferred: u64,
    error: &'static str,
}

impl Default for State {
    fn default() -> Self {
        Self {
            status: "idle",
            release: None,
            transferred: 0,
            error: "",
        }
    }
}

impl Updater {
    pub fn state(&self) -> Value {
        let state = self.state.lock().expect("update state poisoned");
        let fraction = state.release.as_ref().filter(|_| state.transferred > 0);
        json!({"status":state.status,"currentVersion":CURRENT,
            "version":state.release.as_ref().map_or(CURRENT, |update| update.version.as_str()),
            "updateAvailable":state.release.is_some(),"releaseUrl":RELEASES,
            "progress":fraction.map_or(0, |release| 100 * state.transferred / release.size),
            "transferred":state.transferred,"total":state.release.as_ref().map_or(0, |release| release.size),
            "error":state.error})
    }

    pub fn request_check(&self) -> bool {
        let mut state = self.state.lock().expect("update state poisoned");
        if matches!(state.status, "checking" | "downloading" | "installing") {
            return false;
        }
        state.status = "checking";
        state.error = "";
        true
    }

    pub async fn check(&self) {
        let feed = async {
            let client = reqwest::Client::builder()
                .user_agent(concat!("Mineradio-Windows/", env!("CARGO_PKG_VERSION")))
                .redirect(reqwest::redirect::Policy::none())
                .timeout(Duration::from_secs(12))
                .build()?;
            let rows = request_json(
                client
                    .get(FEED)
                    .query(&[("per_page", "20")])
                    .header("Accept", "application/vnd.github+json"),
            )
            .await?;
            ensure!(rows.is_array(), "发布目录无效");
            Ok::<_, anyhow::Error>(find_update(&rows))
        }
        .await;
        let update = match feed {
            Ok(release) => Ok(release),
            Err(_) => check_release_manifest().await,
        };
        let mut state = self.state.lock().expect("update state poisoned");
        match update {
            Ok(release) => {
                state.release = release;
                state.status = if state.release.is_some() {
                    "available"
                } else {
                    "current"
                };
                state.transferred = 0;
            }
            Err(_) => {
                state.status = "error";
                state.error = "暂时无法检查更新，请稍后重试";
            }
        }
    }

    pub fn request_download(&self) -> Option<Release> {
        let mut state = self.state.lock().expect("update state poisoned");
        if !matches!(state.status, "available" | "error") {
            return None;
        }
        let release = state.release.clone()?;
        state.status = "downloading";
        state.transferred = 0;
        state.error = "";
        Some(release)
    }

    pub async fn download(
        &self,
        release: Release,
        mut publish: impl FnMut(Value),
    ) -> Result<NamedTempFile> {
        let client = reqwest::Client::builder()
            .user_agent(concat!("Mineradio-Windows/", env!("CARGO_PKG_VERSION")))
            .timeout(Duration::from_secs(300))
            .connect_timeout(Duration::from_secs(12))
            .redirect(reqwest::redirect::Policy::custom(|request| {
                if request.previous().len() <= 3 && trusted_asset_host(request.url()) {
                    request.follow()
                } else {
                    request.error("release redirect outside GitHub")
                }
            }))
            .build()?;
        let response = client
            .get(release.url)
            .header("Accept-Encoding", "identity")
            .send()
            .await?
            .error_for_status()?;
        ensure!(
            response
                .content_length()
                .is_none_or(|length| length == release.size),
            "更新包大小不匹配"
        );
        let pending = tempfile::Builder::new()
            .prefix("Mineradio-update-")
            .suffix(".exe")
            .tempfile()?;
        let mut file = tokio::fs::File::from_std(pending.reopen()?);
        let mut body = response.bytes_stream();
        let mut hash = Sha256::new();
        let mut bytes = 0u64;
        let mut last = 0u64;
        while let Some(chunk) = body.next().await {
            let chunk = chunk?;
            bytes += chunk.len() as u64;
            ensure!(bytes <= release.size, "更新包大小不匹配");
            hash.update(&chunk);
            file.write_all(&chunk).await?;
            let percent = 100 * bytes / release.size;
            if percent > last {
                self.state
                    .lock()
                    .expect("update state poisoned")
                    .transferred = bytes;
                publish(self.state());
                last = percent;
            }
        }
        file.sync_all().await?;
        let actual: [u8; 32] = hash.finalize().into();
        ensure!(
            bytes == release.size && actual == release.digest,
            "更新包校验失败"
        );
        Ok(pending)
    }

    pub fn finish(&self, valid: bool) -> Value {
        {
            let mut state = self.state.lock().expect("update state poisoned");
            state.status = if valid { "installing" } else { "error" };
            state.error = if valid {
                ""
            } else {
                "暂时无法下载、校验或启动更新包，请稍后重试"
            };
        }
        self.state()
    }
}

fn version(value: &str) -> Option<[u32; 3]> {
    let mut result = [0; 3];
    let mut fields = value.strip_prefix('v').unwrap_or(value).split('.');
    for number in &mut result {
        let text = fields.next()?;
        if text.is_empty()
            || text.len() > 1 && text.starts_with('0')
            || !text.bytes().all(|byte| byte.is_ascii_digit())
        {
            return None;
        }
        *number = text.parse().ok()?;
    }
    fields.next().is_none().then_some(result)
}

async fn check_release_manifest() -> Result<Option<Release>> {
    let client = reqwest::Client::builder()
        .user_agent(concat!("Mineradio-Windows/", env!("CARGO_PKG_VERSION")))
        .timeout(Duration::from_secs(12))
        .redirect(reqwest::redirect::Policy::custom(|request| {
            if request.previous().len() <= 3 && trusted_manifest_redirect(request.url()) {
                request.follow()
            } else {
                request.error("manifest redirect outside GitHub")
            }
        }))
        .build()?;
    let response = client
        .get(MANIFEST_URL)
        .header("Accept-Encoding", "identity")
        .send()
        .await?
        .error_for_status()?;
    let mut stream = response.bytes_stream();
    let mut data = Vec::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk?;
        ensure!(data.len() + chunk.len() <= MAX_MANIFEST, "更新清单过大");
        data.extend_from_slice(&chunk);
    }
    read_release_manifest(&data)
}

fn read_release_manifest(data: &[u8]) -> Result<Option<Release>> {
    let manifest: ReleaseManifest = serde_json::from_slice(data)?;
    let tag = format!("v{}", manifest.version);
    let published = version(&tag).context("更新清单版本无效")?;
    let current = version(CURRENT).context("当前版本无效")?;
    let release = release_asset(&tag, manifest.size, &manifest.sha256).context("更新清单无效")?;
    Ok((published > current).then_some(release))
}

fn rust_installer_name(version: &str) -> String {
    format!("Mineradio-{version}-Rust-Setup-x64.exe")
}

fn release_asset(tag: &str, size: u64, hash: &str) -> Option<Release> {
    version(tag)?;
    if !(1..=MAX_INSTALLER).contains(&size) {
        return None;
    }
    let mut digest = [0; 32];
    hex::decode_to_slice(hash, &mut digest).ok()?;
    let version = tag.strip_prefix('v').unwrap_or(tag);
    let url = Url::parse(&format!(
        "{RELEASES}/download/{tag}/{}",
        rust_installer_name(version)
    ))
    .ok()?;
    Some(Release {
        version: version.into(),
        url,
        size,
        digest,
    })
}

fn find_update(rows: &Value) -> Option<Release> {
    let current = version(CURRENT)?;
    rows.as_array()?
        .iter()
        .filter_map(|row| {
            if row["prerelease"] != false || row["draft"] != false {
                return None;
            }
            let tag = row["tag_name"].as_str()?;
            let numeric = version(tag)?;
            if numeric <= current {
                return None;
            }
            let version = tag.strip_prefix('v').unwrap_or(tag);
            let filename = rust_installer_name(version);
            let asset = row["assets"]
                .as_array()?
                .iter()
                .find(|asset| asset["name"] == filename && asset["state"] == "uploaded")?;
            let size = asset["size"].as_u64()?;
            let hash = asset["digest"].as_str()?.strip_prefix("sha256:")?;
            let release = release_asset(tag, size, hash)?;
            if asset["browser_download_url"].as_str()? != release.url.as_str() {
                return None;
            }
            Some((numeric, release))
        })
        .max_by_key(|(version, _)| *version)
        .map(|(_, release)| release)
}

fn trusted_https(url: &Url) -> bool {
    url.scheme() == "https"
        && url.port_or_known_default() == Some(443)
        && url.password().is_none()
        && url.username().is_empty()
}

fn trusted_asset_host(url: &Url) -> bool {
    trusted_https(url)
        && matches!(
            url.host_str(),
            Some("release-assets.githubusercontent.com" | "objects.githubusercontent.com")
        )
}

fn trusted_manifest_redirect(url: &Url) -> bool {
    trusted_asset_host(url)
        || (trusted_https(url)
            && url.host_str() == Some("github.com")
            && url.query().is_none()
            && url.fragment().is_none()
            && url
                .path()
                .strip_prefix("/sunzhaocn/Mineradio/releases/download/")
                .and_then(|path| path.split_once('/'))
                .is_some_and(|(tag, name)| version(tag).is_some() && name == MANIFEST_NAME))
}

pub fn install(package: NamedTempFile) -> Result<()> {
    let (file, path) = package.keep().context("无法准备更新包")?;
    drop(file);
    if let Err(error) = std::process::Command::new(&path).arg("--updated").spawn() {
        let _ = std::fs::remove_file(path);
        return Err(error).context("无法启动更新包");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn update_entry_requires_newer_rust_setup_with_digest() {
        let row = |tag: &str, name: &str, digest: &str| {
            json!({
                "prerelease":false,"draft":false,"tag_name":tag,
                "assets":[{"name":name,"state":"uploaded","size":500,"digest":digest,
                    "browser_download_url":format!("{RELEASES}/download/{tag}/{name}")}]
            })
        };
        let new = "Mineradio-9.10.1-Rust-Setup-x64.exe";
        let valid = format!("sha256:{}", "17".repeat(32));
        assert!(
            find_update(&json!([
                row("v9.10.1", "Mineradio-9.10.1-Setup-x64.exe", &valid),
                row("v9.10.1", new, ""),
                row("v2.3.18", "Mineradio-2.3.18-Rust-Setup-x64.exe", &valid),
            ]))
            .is_none()
        );
        assert_eq!(
            find_update(&json!([row("v9.10.1", new, &valid)]))
                .unwrap()
                .version,
            "9.10.1"
        );
    }

    #[test]
    fn release_manifest_validates_version_size_and_digest() {
        let manifest = |version: &str, size, digest: &str| {
            serde_json::to_vec(&json!({"version":version,"size":size,"sha256":digest})).unwrap()
        };
        let digest = "17".repeat(32);
        let release = read_release_manifest(&manifest("9.10.1", 500, &digest))
            .unwrap()
            .unwrap();
        assert_eq!(
            release.url.as_str(),
            "https://github.com/sunzhaocn/Mineradio/releases/download/v9.10.1/Mineradio-9.10.1-Rust-Setup-x64.exe"
        );
        assert!(
            read_release_manifest(&manifest(CURRENT, 500, &digest))
                .unwrap()
                .is_none()
        );
        assert!(read_release_manifest(&manifest("9.10.1", MAX_INSTALLER + 1, &digest)).is_err());
        assert!(read_release_manifest(&manifest("9.10.1", 500, "invalid")).is_err());
        assert!(read_release_manifest(&manifest("v9.10.1", 500, &digest)).is_err());
    }

    #[test]
    fn release_manifest_redirects_stay_on_the_release_path_or_asset_host() {
        let allowed = format!("{RELEASES}/download/v9.10.1/{MANIFEST_NAME}");
        assert!(trusted_manifest_redirect(&Url::parse(&allowed).unwrap()));
        assert!(trusted_manifest_redirect(
            &Url::parse("https://release-assets.githubusercontent.com/example").unwrap()
        ));
        assert!(!trusted_manifest_redirect(
            &Url::parse(&format!("{allowed}?x=1")).unwrap()
        ));
        assert!(!trusted_manifest_redirect(
            &Url::parse(&allowed.replace("sunzhaocn", "another")).unwrap()
        ));
        assert!(!trusted_manifest_redirect(
            &Url::parse(&allowed.replace("https", "http")).unwrap()
        ));
    }
}
