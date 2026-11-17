mod cenc;

use crate::accounts::{Accounts, Provider};
use crate::profile::Profile;
use crate::tools;
use anyhow::{Context, Result, ensure};
use cenc::Codec;
use futures_util::StreamExt;
use sha2::{Digest, Sha256};
use std::collections::VecDeque;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tokio::io::AsyncWriteExt;
use tokio::sync::{Mutex as AsyncMutex, Semaphore};
use url::Url;

const MAX_BYTES: u64 = 128 * 1024 * 1024;
const CACHE_LIMIT: u64 = 512 * 1024 * 1024;
const ACCESS_TTL: Duration = Duration::from_secs(15 * 60);

#[derive(Clone)]
pub struct Source {
    url: Url,
    size: u64,
    key: [u8; 16],
    identity: String,
    codec: Codec,
}

impl Source {
    pub fn new(
        url: &str,
        size: u64,
        play_auth: &str,
        identity: String,
        codec: &str,
    ) -> Option<Self> {
        let url = Url::parse(url).ok().filter(allowed_cdn)?;
        if size > MAX_BYTES || identity.len() > 512 {
            return None;
        }
        let key = cenc::decode_play_auth(play_auth).ok()?;
        let codec = match codec {
            "flac" => Codec::Flac,
            "aac" | "mp4a" => Codec::Aac,
            _ => return None,
        };
        Some(Self {
            url,
            size,
            key,
            identity,
            codec,
        })
    }
}

fn allowed_cdn(url: &Url) -> bool {
    url.scheme() == "https"
        && url.port_or_known_default() == Some(443)
        && url.username().is_empty()
        && url.password().is_none()
        && url.fragment().is_none()
        && url.host_str().is_some_and(|host| {
            ["douyinvod.com", "bytecdn.cn"].into_iter().any(|domain| {
                host == domain
                    || host
                        .strip_suffix(domain)
                        .is_some_and(|parent| parent.ends_with('.'))
            })
        })
}

#[derive(Clone)]
struct Grant {
    address: String,
    scope: [u8; 32],
    expires: Instant,
    source: Source,
    file_id: String,
}

pub struct ProtectedAudio {
    client: reqwest::Client,
    profile: Profile,
    grants: Mutex<VecDeque<Grant>>,
    serial: [AsyncMutex<()>; 16],
    budget: Semaphore,
}

impl ProtectedAudio {
    pub fn new(profile: Profile) -> Result<Self> {
        let client = reqwest::Client::builder()
            .user_agent("Mozilla/5.0")
            .connect_timeout(Duration::from_secs(7))
            .timeout(Duration::from_secs(40))
            .redirect(reqwest::redirect::Policy::custom(|attempt| {
                if attempt.previous().len() < 4 && allowed_cdn(attempt.url()) {
                    attempt.follow()
                } else {
                    attempt.error("unexpected protected audio redirect")
                }
            }))
            .build()?;
        Ok(Self {
            client,
            profile,
            grants: Mutex::default(),
            serial: std::array::from_fn(|_| AsyncMutex::new(())),
            budget: Semaphore::new(2),
        })
    }

    pub fn register(
        &self,
        origin: &str,
        song: &str,
        quality: &str,
        source: Source,
        accounts: &Accounts,
    ) -> String {
        let scope = accounts.scope(Provider::Qishui);
        let address = format!("{origin}/qishui/audio?id={song}&quality={quality}");
        let mut hasher = Sha256::new();
        hasher.update(b"mineradio-rust-clear-audio-v1\0");
        hasher.update(scope);
        for field in [song, quality, &source.identity] {
            hasher.update(field);
            hasher.update([0]);
        }
        hasher.update(source.key);
        let file_id = hex::encode(hasher.finalize());
        let mut grants = self.grants.lock().expect("protected audio grants poisoned");
        let now = Instant::now();
        grants.retain(|grant| {
            grant.expires > now && !(grant.address == address && grant.scope == scope)
        });
        grants.push_front(Grant {
            address: address.clone(),
            scope,
            expires: now + ACCESS_TTL,
            source,
            file_id,
        });
        grants.truncate(512);
        address
    }

    pub async fn prepare(&self, address: &str, accounts: &Accounts) -> Result<PathBuf> {
        let scope = accounts.scope(Provider::Qishui);
        let grant = self
            .grants
            .lock()
            .expect("protected audio grants poisoned")
            .iter()
            .find(|grant| {
                grant.address == address && grant.scope == scope && grant.expires > Instant::now()
            })
            .cloned()
            .context("音源授权已失效，请重新点击播放")?;
        let folder = self.profile.cache_root()?.join("qishui").join("audio");
        let format = grant.source.codec.extension();
        let path = folder.join(format!("rust-{}.{}", grant.file_id, format));
        let queue = usize::from(grant.file_id.as_bytes()[0]) % self.serial.len();
        let _same_file = self.serial[queue].lock().await;
        if tokio::fs::symlink_metadata(&path)
            .await
            .is_ok_and(|metadata| {
                metadata.is_file()
                    && !metadata.file_type().is_symlink()
                    && (1..=MAX_BYTES).contains(&metadata.len())
            })
        {
            return Ok(path);
        }
        let _slot = self.budget.acquire().await?;
        let ffmpeg = tools::ffmpeg().context("汽水音频封装组件未安装")?;
        tokio::fs::create_dir_all(&folder).await?;
        let data = self.download(&grant.source).await?;
        let key = grant.source.key;
        let (data, codec) = tokio::task::spawn_blocking(move || {
            let mut bytes = data;
            let codec = cenc::decrypt(&mut bytes, &key)?;
            Ok::<_, anyhow::Error>((bytes, codec))
        })
        .await??;
        ensure!(codec == grant.source.codec, "播放音质的编码与元数据不一致");
        let input = tempfile::Builder::new()
            .prefix(".protected-")
            .suffix(".mp4")
            .tempfile_in(&folder)?;
        let output = tempfile::Builder::new()
            .prefix(".clear-")
            .tempfile_in(&folder)?;
        let mut file = tokio::fs::File::from_std(input.reopen()?);
        file.write_all(&data).await?;
        file.flush().await?;
        drop(file);
        drop(data);
        let mut command = tools::hidden_command(&ffmpeg);
        command
            .args(["-nostdin", "-v", "error", "-y", "-i"])
            .arg(input.path())
            .args(["-map", "0:a:0", "-c:a", "copy"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        if codec == Codec::Flac {
            command.args(["-f", "flac"]);
        } else {
            command.args(["-movflags", "+faststart", "-f", "ipod"]);
        }
        let result =
            tokio::time::timeout(Duration::from_secs(34), command.arg(output.path()).status())
                .await??;
        let output_size = output.as_file().metadata()?.len();
        ensure!(
            result.success() && (1..=MAX_BYTES).contains(&output_size),
            "汽水音频封装失败"
        );
        output.persist(&path)?;
        let kept = path.clone();
        tokio::task::spawn_blocking(move || prune(&folder, &kept)).await?;
        Ok(path)
    }

    async fn download(&self, source: &Source) -> Result<Vec<u8>> {
        let response = self
            .client
            .get(source.url.clone())
            .header("accept-encoding", "identity")
            .send()
            .await?;
        ensure!(
            response.status() == reqwest::StatusCode::OK
                && response
                    .content_length()
                    .is_none_or(|size| size <= MAX_BYTES),
            "汽水音频下载失败"
        );
        let mut buffer = Vec::new();
        let mut stream = response.bytes_stream();
        while let Some(chunk) = stream.next().await {
            let chunk = chunk?;
            ensure!(
                (buffer.len() + chunk.len()) as u64 <= MAX_BYTES,
                "汽水音频超出大小限制"
            );
            buffer.extend_from_slice(&chunk);
        }
        ensure!(
            !buffer.is_empty() && (source.size == 0 || buffer.len() as u64 == source.size),
            "汽水音频大小不符"
        );
        Ok(buffer)
    }
}

fn prune(folder: &Path, keep: &Path) {
    let Ok(entries) = std::fs::read_dir(folder) else {
        return;
    };
    let mut files: Vec<_> = entries
        .filter_map(std::result::Result::ok)
        .filter_map(|entry| {
            let path = entry.path();
            let id = path.file_stem()?.to_str()?.strip_prefix("rust-")?;
            if id.len() != 64
                || !id.bytes().all(|byte| byte.is_ascii_hexdigit())
                || !matches!(path.extension()?.to_str()?, "flac" | "m4a")
            {
                return None;
            }
            let meta = entry.metadata().ok()?;
            if !meta.is_file() {
                return None;
            }
            Some((meta.modified().ok()?, meta.len(), path))
        })
        .collect();
    let mut total: u64 = files.iter().map(|(_, length, _)| length).sum();
    files.sort_unstable_by_key(|(modified, _, _)| *modified);
    for (modified, length, path) in files {
        let expired = modified
            .elapsed()
            .is_ok_and(|age| age >= Duration::from_secs(86_400));
        if path != keep && (expired || total > CACHE_LIMIT) && std::fs::remove_file(&path).is_ok() {
            total = total.saturating_sub(length);
        }
    }
}
