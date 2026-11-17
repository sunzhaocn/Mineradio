use crate::profile::{Profile, read_json, write_json};
use crate::providers::text;
use anyhow::{Context, Result, ensure};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

const IMAGES: &[&str] = &["jpg", "jpeg", "png", "gif", "webp", "bmp", "avif"];
const VIDEOS: &[&str] = &["mp4", "m4v", "mov", "webm", "ogv"];
const PACKAGES: &[&str] = &["pkg", "pak"];

pub struct WallpaperLibrary {
    path: PathBuf,
    token: String,
    runtime: Mutex<Cache>,
}

#[derive(Default)]
struct Cache {
    loaded: Option<Instant>,
    projects: HashMap<String, Project>,
    snapshot: Value,
}

#[derive(Default, Deserialize, Serialize)]
#[serde(default, rename_all = "camelCase")]
struct Config {
    version: u32,
    manual_roots: Vec<PathBuf>,
    manual_project_files: Vec<PathBuf>,
}

struct Project {
    root: PathBuf,
    manifest: PathBuf,
    media: Option<PathBuf>,
    preview: Option<PathBuf>,
    scene: Option<PathBuf>,
    summary: Value,
}

impl WallpaperLibrary {
    pub fn new(profile: &Profile) -> Self {
        let first = uuid::Uuid::new_v4().simple().to_string();
        let second = uuid::Uuid::new_v4().simple().to_string();
        Self {
            path: profile.root.join("wallpaper-engine-library.json"),
            token: format!("{first}{}", &second[..16]),
            runtime: Mutex::default(),
        }
    }

    pub fn scan(&self, force: bool) -> Result<Value> {
        let mut cache = self.runtime.lock().expect("wallpaper library poisoned");
        if !force
            && cache
                .loaded
                .is_some_and(|start| start.elapsed() < Duration::from_secs(30))
        {
            return Ok(cache.snapshot.clone());
        }
        let config: Config = read_json(&self.path)?.unwrap_or_default();
        let roots = steam_libraries();
        let mut candidates = Vec::new();
        for steam in &roots {
            let workshop = steam.join("steamapps/workshop/content/431960");
            let default = steam.join("steamapps/common/wallpaper_engine/projects");
            candidates.extend(
                subdirectories(&workshop)
                    .into_iter()
                    .map(|dir| (dir, "steam-workshop")),
            );
            for kind in ["myprojects", "defaultprojects"] {
                candidates.extend(
                    subdirectories(&default.join(kind))
                        .into_iter()
                        .map(|dir| (dir, "steam-project")),
                );
            }
        }
        let overrides: HashMap<_, _> = config
            .manual_project_files
            .iter()
            .take(64)
            .filter_map(|file| Some((path_key(file.parent()?), file.clone())))
            .collect();
        for root in config.manual_roots.iter().take(32) {
            candidates.extend(
                manual_directories(root)
                    .into_iter()
                    .map(|dir| (dir, "manual")),
            );
        }
        let mut entries = HashMap::new();
        let mut cards = Vec::new();
        for (root, source) in candidates.into_iter().take(10_000) {
            let id = opaque(&root);
            if entries.contains_key(&id) {
                continue;
            }
            if let Ok(Some(record)) = index(&root, &id, source, overrides.get(&path_key(&root))) {
                cards.push(record.summary.clone());
                entries.insert(id, record);
            }
        }
        cards.sort_by_key(|value| {
            (
                value["playable"] != true,
                value["enginePlayable"] != true,
                text(&value["title"]).to_lowercase(),
            )
        });
        let manual: Vec<_> = config.manual_roots.iter().take(32).map(|root|
            json!({"id":opaque(root),"name":root.file_name().unwrap_or(root.as_os_str())})).collect();
        let snapshot = json!({"ok":true,"count":cards.len(),
            "dynamicCount":cards.iter().filter(|value| value["mediaType"] == "video").count(),
            "enginePlayableCount":cards.iter().filter(|value| value["enginePlayable"] == true).count(),
            "previewOnlyCount":cards.iter().filter(|value| value["previewOnly"] == true).count(),
            "sourceCount":roots.len()+manual.len(),"manualRoots":manual,"mediaToken":self.token,"projects":cards});
        cache.loaded = Some(Instant::now());
        cache.snapshot = snapshot.clone();
        cache.projects = entries;
        Ok(snapshot)
    }

    pub fn add_directory(&self, root: &Path) -> Result<Value> {
        ensure!(
            root.is_absolute() && !manual_directories(root).is_empty(),
            "所选目录没有有效的 Wallpaper Engine 项目"
        );
        self.update(|config| insert_path(&mut config.manual_roots, root, 32))?;
        self.scan(true)
    }

    pub fn add_file(&self, file: &Path) -> Result<Value> {
        let root = file.parent().context("项目文件路径无效")?;
        let name = file
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or_default();
        if name.eq_ignore_ascii_case("project.json") {
            return self.add_directory(root);
        }
        ensure!(
            file.is_absolute() && valid_package(file),
            "所选文件不是有效的 Wallpaper Engine 场景包"
        );
        let metadata = manifest(&root.join("project.json"))?;
        ensure!(
            text(&metadata["type"]).eq_ignore_ascii_case("scene"),
            "场景包旁缺少有效的 project.json"
        );
        self.update(|config| {
            insert_path(&mut config.manual_roots, root, 32);
            insert_path(&mut config.manual_project_files, file, 64);
        })?;
        self.scan(true)
    }

    pub fn remove(&self, id: &str) -> Result<Value> {
        self.update(|config| {
            config.manual_roots.retain(|root| opaque(root) != id);
            config
                .manual_project_files
                .retain(|file| file.parent().is_some_and(|root| opaque(root) != id));
        })?;
        self.scan(true)
    }

    fn update(&self, action: impl FnOnce(&mut Config)) -> Result<()> {
        let mut cache = self.runtime.lock().expect("wallpaper library poisoned");
        let mut config: Config = read_json(&self.path)?.unwrap_or_default();
        config.version = 2;
        action(&mut config);
        write_json(&self.path, &config)?;
        cache.loaded = None;
        Ok(())
    }

    pub fn details(&self, id: &str) -> Result<Value> {
        self.scan(false)?;
        let cache = self.runtime.lock().expect("wallpaper library poisoned");
        let project = cache.projects.get(id).context("未找到该壁纸项目")?;
        let metadata = manifest(&project.manifest)?;
        let mut value = project.summary.clone();
        let properties = properties(&metadata);
        value["ok"] = json!(true);
        value["propertyCount"] = json!(properties.len());
        value["audioPropertyCount"] = json!(
            properties
                .iter()
                .filter(|field| field["audio"] == true)
                .count()
        );
        value["mutedAudioPropertyCount"] = json!(0);
        value["properties"] = json!(properties);
        Ok(value)
    }

    pub fn file(&self, id: &str, kind: &str, token: &str) -> Result<Option<PathBuf>> {
        if token != self.token {
            return Ok(None);
        }
        self.scan(false)?;
        let cache = self.runtime.lock().expect("wallpaper library poisoned");
        let file = cache.projects.get(id).and_then(|project| {
            let path = match kind {
                "media" => project.media.as_ref(),
                "preview" => project.preview.as_ref(),
                _ => None,
            }?;
            in_root(&project.root, path)
        });
        Ok(file)
    }

    pub fn workshop_id(&self, id: &str) -> Result<String> {
        self.scan(false)?;
        let cache = self.runtime.lock().expect("wallpaper library poisoned");
        let project = cache.projects.get(id).context("未找到该壁纸项目")?;
        let workshop = text(&project.summary["workshopId"]);
        ensure!(
            (5..=32).contains(&workshop.len()),
            "WALLPAPER_ENGINE_WORKSHOP_DETAILS_UNAVAILABLE"
        );
        Ok(workshop)
    }

    pub fn scene(&self, id: &str) -> Result<(PathBuf, PathBuf, Value, Value)> {
        self.scan(false)?;
        let cache = self.runtime.lock().expect("wallpaper library poisoned");
        let project = cache
            .projects
            .get(id)
            .context("WALLPAPER_SCENE_NOT_FOUND")?;
        let scene = project
            .scene
            .as_ref()
            .and_then(|path| in_root(&project.root, path))
            .filter(|path| valid_package(path))
            .context("WALLPAPER_SCENE_PACKAGE_INVALID")?;
        let declared = manifest(&project.manifest)?;
        let mut muted = serde_json::Map::new();
        muted.insert("volume".into(), json!(0));
        for property in properties(&declared)
            .iter()
            .filter(|item| item["audio"] == true)
        {
            let key = text(&property["key"]);
            let label = text(&property["label"]);
            let name = format!("{key} {label}").to_lowercase();
            let value = if property["type"] == "slider"
                && (name.contains("volume") || name.contains("音量"))
            {
                Some(property["min"].as_f64().unwrap_or(0.0).min(0.0).into())
            } else if property["type"] == "bool" && name.contains("mute") {
                Some(Value::Bool(true))
            } else if property["type"] == "bool" {
                Some(Value::Bool(false))
            } else {
                None
            };
            if let Some(value) = value {
                muted.insert(key, value);
            }
        }
        Ok((
            project.manifest.clone(),
            scene,
            declared,
            Value::Object(muted),
        ))
    }
}

fn insert_path(items: &mut Vec<PathBuf>, path: &Path, limit: usize) {
    let key = path_key(path);
    items.retain(|current| path_key(current) != key);
    items.push(path.to_owned());
    if items.len() > limit {
        items.drain(..items.len() - limit);
    }
}

fn path_key(path: &Path) -> String {
    path.to_string_lossy()
        .trim_start_matches(r"\\?\")
        .to_lowercase()
        .replace('/', "\\")
}

fn opaque(path: &Path) -> String {
    hex::encode(Sha256::digest(path_key(path).as_bytes()))[..24].to_string()
}

pub fn steam_libraries() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    for variable in ["ProgramFiles(x86)", "ProgramFiles"] {
        if let Some(directory) = std::env::var_os(variable) {
            let root = PathBuf::from(directory).join("Steam");
            if root.join("steamapps").is_dir() {
                roots.push(root);
            }
        }
    }
    let mut libraries = steam_library_folders(&roots);
    let mut seen = HashSet::new();
    libraries.retain(|path| seen.insert(path_key(path)));
    libraries
}

fn steam_library_folders(roots: &[PathBuf]) -> Vec<PathBuf> {
    let mut result = roots.to_vec();
    let pattern = regex::Regex::new(r#""path"\s*"([^"]+)""#).expect("Steam VDF paths");
    for root in roots {
        if let Ok(vdf) = fs::read_to_string(root.join("steamapps/libraryfolders.vdf")) {
            for path in pattern.captures_iter(&vdf).take(40) {
                let folder = PathBuf::from(path[1].replace(r"\\", r"\"));
                if folder.is_absolute() && folder.join("steamapps").is_dir() {
                    result.push(folder);
                }
            }
        }
    }
    result
}

fn subdirectories(path: &Path) -> Vec<PathBuf> {
    fs::read_dir(path)
        .into_iter()
        .flatten()
        .filter_map(std::result::Result::ok)
        .take(5000)
        .filter(|entry| {
            entry
                .file_type()
                .is_ok_and(|kind| kind.is_dir() && !kind.is_symlink())
        })
        .map(|entry| entry.path())
        .collect()
}

fn manual_directories(root: &Path) -> Vec<PathBuf> {
    let mut pending = vec![(root.to_owned(), 0)];
    let mut result = Vec::new();
    let mut inspected = 0;
    while let Some((path, depth)) = pending.pop() {
        inspected += 1;
        if inspected > 4000 {
            break;
        }
        if path.join("project.json").is_file() {
            result.push(path);
        } else if depth < 5 {
            pending.extend(
                subdirectories(&path)
                    .into_iter()
                    .map(|child| (child, depth + 1)),
            );
        }
    }
    result
}

fn in_root(root: &Path, path: &Path) -> Option<PathBuf> {
    let file = path.canonicalize().ok()?;
    (file.starts_with(root) && file.is_file()).then_some(file)
}

fn extension(path: &Path) -> String {
    path.extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
}

fn pick(root: &Path, names: &[&str], suffixes: &[&str]) -> Option<PathBuf> {
    names
        .iter()
        .filter(|name| !name.is_empty())
        .find_map(|name| {
            let file = Path::new(name);
            if file.is_absolute() || !suffixes.contains(&extension(file).as_str()) {
                return None;
            }
            in_root(root, &root.join(file))
        })
}

fn valid_package(path: &Path) -> bool {
    let mut signature = [0u8; 8];
    PACKAGES.contains(&extension(path).as_str())
        && fs::File::open(path)
            .and_then(|mut file| file.read_exact(&mut signature))
            .is_ok()
        && &signature[4..8] == b"PKGV"
}

fn manifest(path: &Path) -> Result<Value> {
    let mut raw = Vec::new();
    fs::File::open(path)?
        .take(1024 * 1024 + 1)
        .read_to_end(&mut raw)?;
    ensure!(raw.len() <= 1024 * 1024, "壁纸项目清单过大");
    Ok(serde_json::from_slice(
        raw.strip_prefix(b"\xef\xbb\xbf").unwrap_or(&raw),
    )?)
}

fn index(
    path: &Path,
    id: &str,
    source: &str,
    scene_override: Option<&PathBuf>,
) -> Result<Option<Project>> {
    let root = path.canonicalize()?;
    let manifest_path = in_root(&root, &root.join("project.json")).context("项目清单无效")?;
    let metadata = manifest(&manifest_path)?;
    let kind = text(&metadata["type"]).to_lowercase();
    let file = metadata["file"].as_str().unwrap_or_default();
    let media = if matches!(kind.as_str(), "" | "video" | "image") {
        pick(&root, &[file], IMAGES).or_else(|| pick(&root, &[file], VIDEOS))
    } else {
        None
    };
    let preview = pick(
        &root,
        &[
            metadata["preview"].as_str().unwrap_or_default(),
            metadata["cover"].as_str().unwrap_or_default(),
            "preview.jpg",
            "preview.jpeg",
            "preview.png",
            "preview.webp",
            "preview.gif",
            "cover.jpg",
            "cover.png",
            "cover.webp",
            "cover.gif",
        ],
        IMAGES,
    );
    let scene = if kind == "scene" {
        scene_override
            .and_then(|path| in_root(&root, path))
            .or_else(|| pick(&root, &[file, "scene.pkg", "scene.pak"], PACKAGES))
            .filter(|file| valid_package(file))
    } else {
        None
    };
    if media.is_none() && preview.is_none() && scene.is_none() {
        return Ok(None);
    }
    let media_type = media
        .as_ref()
        .map(|path| {
            if VIDEOS.contains(&extension(path).as_str()) {
                "video"
            } else {
                "image"
            }
        })
        .unwrap_or_default();
    let stamp = fs::metadata(&manifest_path)
        .ok()
        .and_then(|item| item.modified().ok())
        .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
        .map_or_else(
            || {
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_millis()
            },
            |value| value.as_millis(),
        );
    let folder = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or_default();
    let title = metadata["title"]
        .as_str()
        .filter(|title| !title.trim().is_empty())
        .unwrap_or(folder);
    let workshop = text(&metadata["workshopid"]);
    let workshop = if workshop.is_empty() && source == "steam-workshop" {
        folder
    } else {
        &workshop
    };
    let workshop = if workshop.bytes().all(|byte| byte.is_ascii_digit()) {
        workshop
    } else {
        ""
    };
    let project_type = if kind.is_empty() { media_type } else { &kind };
    let fields = properties(&metadata);
    let summary = json!({"id":id,"title":title.chars().filter(|c|!c.is_control()).take(240).collect::<String>(),
        "workshopId":workshop,"projectType":project_type,"mediaType":media_type,"updatedAt":stamp,
        "source":source,"sourceLabel":if source=="manual" {"导入目录"} else {"Steam"},
        "playable":media.is_some(),"hasPreview":preview.is_some(),"enginePlayable":scene.is_some(),
        "previewOnly":media.is_none() && scene.is_none(),"mediaAnimated":media.as_ref().is_some_and(|path|extension(path)=="gif"),
        "previewAnimated":preview.as_ref().is_some_and(|path|extension(path)=="gif"),
        "propertyCount":fields.len(),"audioPropertyCount":fields.iter().filter(|value|value["audio"]==true).count()});
    Ok(Some(Project {
        root,
        manifest: manifest_path,
        media,
        preview,
        scene,
        summary,
    }))
}

fn properties(project: &Value) -> Vec<Value> {
    project.pointer("/general/properties").and_then(Value::as_object).into_iter().flatten().take(256)
        .filter_map(|(key,property)| {
            let kind = text(&property["type"]);
            if key.starts_with('_') || kind.is_empty() || key.len() > 128 { return None; }
            let mut label = text(&property["text"]);
            if label.is_empty() { label = key.clone(); }
            let audio = ["volume","mute","music","audio","sound","音量","静音"].iter()
                .any(|term|format!("{key} {label}").to_lowercase().contains(term));
            let options = property["options"].as_array().into_iter().flatten().take(64)
                .map(|item| json!({"label":text(item.get("label").unwrap_or(&item["text"])),"value":item["value"]})).collect::<Vec<_>>();
            Some(json!({"key":key,"label":label,"type":kind,"value":property["value"],"audio":audio,"audioControl":audio,
                "min":property["min"],"max":property["max"],"step":property["step"],"options":options}))
        }).collect()
}
