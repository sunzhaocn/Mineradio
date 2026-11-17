use crate::profile::Profile;
use anyhow::{Context, Result, ensure};
use axum::body::Body;
use futures_util::StreamExt;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tokio::io::AsyncWriteExt;

const MAX_EXPORT: u64 = 512 * 1024 * 1024;
const MAX_IMAGE: usize = 64 * 1024 * 1024;

pub struct NativeFiles {
    profile: Profile,
    exports: Mutex<HashMap<String, (PathBuf, Instant)>>,
    active_cache: PathBuf,
}

impl NativeFiles {
    pub fn new(profile: Profile) -> Result<Self> {
        Ok(Self {
            active_cache: profile.cache_root()?,
            profile,
            exports: Mutex::default(),
        })
    }

    pub fn slideshow_directory(&self) -> PathBuf {
        self.profile.root.join("slideshow-images")
    }

    pub fn slideshow(&self) -> Result<Value> {
        let dir = self.slideshow_directory();
        fs::create_dir_all(&dir)?;
        let mut rows = Vec::new();
        for entry in fs::read_dir(dir)?.take(10_000) {
            let entry = entry?;
            let Some(name) = entry.file_name().to_str().map(str::to_owned) else {
                continue;
            };
            if image_extension(&name).is_none() || !entry.file_type()?.is_file() {
                continue;
            }
            let stat = entry.metadata()?;
            if stat.len() == 0 {
                continue;
            }
            let id = hex::encode(Sha256::digest(name.as_bytes()));
            let version = stat
                .modified()
                .ok()
                .and_then(|value| value.duration_since(std::time::UNIX_EPOCH).ok())
                .map_or(0, |stamp| stamp.as_millis());
            rows.push((name.to_lowercase(),json!({"id":id,"name":name,"url":format!("/api/native/slides/{id}?v={version}-{}",stat.len())})));
        }
        rows.sort_by(|a, b| a.0.cmp(&b.0));
        Ok(json!({"ok":true,"images":rows.into_iter().map(|(_,value)|value).collect::<Vec<_>>()}))
    }

    pub fn slide(&self, id: &str) -> Result<Option<PathBuf>> {
        if id.len() != 64 || !id.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            return Ok(None);
        }
        let dir = self.slideshow_directory();
        if !dir.is_dir() {
            return Ok(None);
        }
        for entry in fs::read_dir(dir)?.take(10_000) {
            let entry = entry?;
            let full_name = entry.file_name();
            let Some(name) = full_name.to_str() else {
                continue;
            };
            if image_extension(name).is_some()
                && entry.file_type()?.is_file()
                && hex::encode(Sha256::digest(name.as_bytes())) == id
            {
                return Ok(Some(entry.path()));
            }
        }
        Ok(None)
    }

    pub fn add_slide(&self, name: &str, bytes: &[u8]) -> Result<Value> {
        let extension = image_extension(name).context("不支持的轮播图片格式")?;
        ensure!(
            !bytes.is_empty() && bytes.len() <= MAX_IMAGE && image_signature(&extension, bytes),
            "轮播图片为空或格式无效"
        );
        let cleaned = safe_name(name, "图片");
        let stem = Path::new(&cleaned)
            .file_stem()
            .and_then(|text| text.to_str())
            .unwrap_or("图片");
        let stem: String = stem.chars().take(80).collect();
        let digest = hex::encode(Sha256::digest(bytes));
        let dir = self.slideshow_directory();
        fs::create_dir_all(&dir)?;
        let path = dir.join(format!("{stem}-{}.{extension}", &digest[..16]));
        if !path.exists() {
            let mut temporary = tempfile::NamedTempFile::new_in(dir)?;
            std::io::Write::write_all(&mut temporary, bytes)?;
            temporary.as_file().sync_all()?;
            if let Err(error) = temporary.persist_noclobber(path) {
                if error.error.kind() != std::io::ErrorKind::AlreadyExists {
                    return Err(error.into());
                }
            }
        }
        Ok(json!({"ok":true}))
    }

    #[cfg(windows)]
    pub fn reserve_export(&self, path: PathBuf) -> Value {
        let mut exports = self.exports.lock().expect("desktop export state poisoned");
        let now = Instant::now();
        exports.retain(|_, (_, until)| *until > now);
        if exports.len() >= 8 {
            return json!({"ok":false,"error":"EXPORT_BUSY"});
        }
        let token = uuid::Uuid::new_v4().simple().to_string();
        exports.insert(token.clone(), (path, now + Duration::from_secs(5 * 60)));
        json!({"ok":true,"token":token})
    }

    pub async fn write_export(&self, token: &str, body: Body) -> Result<Value> {
        let (destination, _) = self
            .exports
            .lock()
            .expect("desktop export state poisoned")
            .remove(token)
            .filter(|(_, until)| *until > Instant::now())
            .context("导出文件选择已过期，请重新选择")?;
        let parent = destination.parent().context("导出位置无效")?;
        let output = tempfile::NamedTempFile::new_in(parent)?;
        let mut stream = body.into_data_stream();
        let mut bytes = 0;
        let mut file = tokio::fs::File::from_std(output.reopen()?);
        while let Some(chunk) = stream.next().await {
            let chunk = chunk?;
            bytes += chunk.len() as u64;
            ensure!(bytes <= MAX_EXPORT, "导出文件过大");
            file.write_all(&chunk).await?;
        }
        ensure!(bytes > 0, "导出文件为空");
        file.sync_all().await?;
        drop(file);
        output.persist(&destination)?;
        Ok(json!({"ok":true,"filePath":destination}))
    }

    pub fn cache_snapshot(&self) -> Result<Value> {
        let active = &self.active_cache;
        let root = self.profile.cache_root()?;
        let lyrics = root.join("lyrics");
        let chromium = active.join("chromium");
        let beats = active.join("beatmaps");
        let wallpaper = active.join("wallpaper-engine");
        let webview_cache = active.join("webview-cache");
        let (lyrics_bytes, chromium_bytes, beatmaps_bytes, wallpaper_bytes) = (
            directory_bytes(&lyrics),
            directory_bytes(&chromium) + directory_bytes(&webview_cache),
            directory_bytes(&beats),
            directory_bytes(&wallpaper),
        );
        Ok(json!({"ok":true,"settings":{
            "rootPath":root,"lyricsPath":lyrics,"chromiumPath":root.join("webview-cache"),"activeChromiumPath":webview_cache,
            "beatmapsPath":root.join("beatmaps"),"activeBeatmapsPath":beats,"wallpaperEnginePath":root.join("wallpaper-engine"),
            "activeWallpaperEnginePath":wallpaper,"userDataPath":self.profile.root,"restartRequired":root != *active},
            "usage":{"lyricsBytes":lyrics_bytes,"chromiumBytes":chromium_bytes,"beatmapsBytes":beatmaps_bytes,
                "wallpaperEngineBytes":wallpaper_bytes,"userDataBytes":directory_bytes(&self.profile.root),
                "totalManagedBytes":lyrics_bytes+chromium_bytes+beatmaps_bytes+wallpaper_bytes}}))
    }
}

fn directory_bytes(destination: &Path) -> u64 {
    let mut pending = vec![destination.to_path_buf()];
    let mut budget = 300_000;
    let mut total = 0u64;
    while let Some(path) = pending.pop() {
        let Ok(entries) = fs::read_dir(path) else {
            continue;
        };
        for entry in entries.filter_map(std::result::Result::ok) {
            if budget == 0 {
                return total;
            }
            budget -= 1;
            let Ok(kind) = entry.file_type() else {
                continue;
            };
            if kind.is_dir() && !kind.is_symlink() {
                #[cfg(windows)]
                {
                    use std::os::windows::fs::MetadataExt;
                    if entry
                        .metadata()
                        .is_ok_and(|meta| meta.file_attributes() & 0x400 != 0)
                    {
                        continue;
                    }
                }
                pending.push(entry.path());
            } else if kind.is_file()
                && let Ok(meta) = entry.metadata()
            {
                total = total.saturating_add(meta.len());
            }
        }
    }
    total
}

pub fn safe_name(value: &str, fallback: &str) -> String {
    let name: String = value
        .chars()
        .take(160)
        .map(|letter| {
            if letter.is_control() || "\\/:*?\"<>|".contains(letter) {
                '_'
            } else {
                letter
            }
        })
        .collect();
    let name = name.trim().trim_end_matches(['.', ' ']);
    if name.is_empty() {
        fallback.into()
    } else {
        name.into()
    }
}

fn image_extension(name: &str) -> Option<String> {
    let ext = Path::new(name).extension()?.to_str()?.to_ascii_lowercase();
    matches!(
        ext.as_str(),
        "jpg" | "jpeg" | "png" | "webp" | "gif" | "bmp" | "avif"
    )
    .then_some(ext)
}

fn image_signature(extension: &str, bytes: &[u8]) -> bool {
    match extension {
        "jpg" | "jpeg" => bytes.starts_with(b"\xff\xd8\xff"),
        "png" => bytes.starts_with(b"\x89PNG\r\n\x1a\n"),
        "webp" => bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP"),
        "gif" => bytes.starts_with(b"GIF89a") || bytes.starts_with(b"GIF87a"),
        "bmp" => bytes.starts_with(b"BM"),
        "avif" => {
            bytes.get(4..8) == Some(b"ftyp")
                && bytes
                    .get(8..12)
                    .is_some_and(|kind| matches!(kind, b"avif" | b"avis" | b"mif1"))
        }
        _ => false,
    }
}
