use anyhow::{Context, Result, bail};
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use tempfile::NamedTempFile;

const MAX_JSON_BYTES: u64 = 32 * 1024 * 1024;

#[derive(Clone)]
pub struct Profile {
    pub root: PathBuf,
    pub standard: bool,
}

#[derive(Deserialize, Serialize)]
pub struct Ports {
    pub web: u16,
    pub api: u16,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopPreferences {
    pub version: u32,
    pub close_behavior: CloseBehavior,
}

#[derive(Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum CloseBehavior {
    Tray,
    Exit,
}

impl Default for DesktopPreferences {
    fn default() -> Self {
        Self {
            version: 1,
            close_behavior: CloseBehavior::Tray,
        }
    }
}

impl Profile {
    pub fn open(override_path: Option<PathBuf>) -> Result<Self> {
        let standard = override_path.is_none() && !cfg!(feature = "preview");
        let root = match override_path {
            Some(path) => std::path::absolute(path)?,
            None => {
                PathBuf::from(std::env::var_os("APPDATA").context("找不到 Windows 用户资料目录")?)
                    .join(if cfg!(feature = "preview") {
                        "Mineradio-Rust-Preview"
                    } else {
                        "Mineradio"
                    })
            }
        };
        fs::create_dir_all(&root)?;
        Ok(Self { root, standard })
    }

    pub fn settings(&self) -> DesktopPreferences {
        read_json(&self.root.join("desktop-preferences.json"))
            .unwrap_or_default()
            .unwrap_or_default()
    }

    pub fn save_close_behavior(&self, behavior: CloseBehavior) -> Result<()> {
        write_json(
            &self.root.join("desktop-preferences.json"),
            &DesktopPreferences {
                version: 1,
                close_behavior: behavior,
            },
        )
    }

    pub fn ports(&self) -> Result<Option<Ports>> {
        let ports: Option<Ports> = read_json(&self.root.join("backend-ports.json"))?;
        if let Some(ports) = &ports {
            if ports.web < 1024 || ports.api < 1024 || ports.web == ports.api {
                bail!("Mineradio 的固定端口配置无效");
            }
        }
        Ok(ports)
    }

    pub fn save_ports(&self, ports: &Ports) -> Result<()> {
        write_json(&self.root.join("backend-ports.json"), ports)
    }

    pub fn device_key(&self) -> PathBuf {
        self.root
            .join("data")
            .join("config")
            .join("server-account.key")
    }

    pub fn qishui_device(&self) -> Result<(String, String)> {
        #[derive(Deserialize, Serialize)]
        struct Device {
            device_id: String,
            install_id: String,
        }
        let path = self.root.join("qishui-device.json");
        if let Some(device) = read_json::<Device>(&path)? {
            let valid = |value: &str| {
                (1..=25).contains(&value.len())
                    && !value.starts_with('0')
                    && value.bytes().all(|byte| byte.is_ascii_digit())
            };
            if valid(&device.device_id) && valid(&device.install_id) {
                return Ok((device.device_id, device.install_id));
            }
        }
        let random =
            |min: u128, count: u128| (min + uuid::Uuid::new_v4().as_u128() % count).to_string();
        let device = Device {
            device_id: random(10u128.pow(15), 8 * 10u128.pow(15)),
            install_id: random(10u128.pow(14), 8 * 10u128.pow(14)),
        };
        write_json(&path, &device)?;
        Ok((device.device_id, device.install_id))
    }

    pub fn webview_directory(&self) -> PathBuf {
        self.root.join("WebView2")
    }

    pub fn visual_settings(&self) -> PathBuf {
        self.root.join("current-fx-autosave.json")
    }

    pub fn cache_root(&self) -> Result<PathBuf> {
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct CacheSettings {
            root_path: PathBuf,
        }
        let saved: Option<CacheSettings> = read_json(&self.root.join("cache-settings.json"))?;
        Ok(saved
            .map(|entry| entry.root_path)
            .filter(|path| path.is_absolute())
            .unwrap_or_else(|| self.root.join("cache")))
    }

    pub fn save_cache_root(&self, root: &Path) -> Result<()> {
        anyhow::ensure!(root.is_absolute() && root.is_dir(), "缓存目录不可用");
        let probe = tempfile::NamedTempFile::new_in(root)?;
        drop(probe);
        write_json(
            &self.root.join("cache-settings.json"),
            &serde_json::json!({"version":1,"rootPath":root}),
        )
    }
}

pub fn read_json<T: DeserializeOwned>(path: &Path) -> Result<Option<T>> {
    let file = match File::open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.into()),
    };
    let mut bytes = Vec::new();
    file.take(MAX_JSON_BYTES + 1).read_to_end(&mut bytes)?;
    if bytes.len() as u64 > MAX_JSON_BYTES {
        bail!("Mineradio 数据文件过大");
    }
    let bytes = bytes.strip_prefix(&[0xef, 0xbb, 0xbf]).unwrap_or(&bytes);
    serde_json::from_slice(bytes)
        .with_context(|| format!("无法读取 {}", path.display()))
        .map(Some)
}

pub fn write_json<T: Serialize>(path: &Path, value: &T) -> Result<()> {
    let parent = path.parent().context("数据文件没有父目录")?;
    fs::create_dir_all(parent)?;
    let mut temporary = NamedTempFile::new_in(parent)?;
    serde_json::to_writer_pretty(temporary.as_file_mut(), value)?;
    temporary.write_all(b"\n")?;
    if temporary.as_file().metadata()?.len() > MAX_JSON_BYTES {
        bail!("Mineradio 数据文件过大");
    }
    temporary.as_file_mut().sync_all()?;
    temporary.persist(path)?;
    Ok(())
}
