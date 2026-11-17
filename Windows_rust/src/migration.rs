use crate::profile::Profile;
use anyhow::{Context, Result, ensure};
use std::fs::{self, File};
use std::io::ErrorKind;
use std::path::Path;

const DIRECTORIES: [&str; 2] = ["Local Storage", "IndexedDB"];

pub fn prepare(profile: &Profile) -> Result<()> {
    let source = profile.cache_root()?.join("chromium").join("Mineradio");
    let data = profile.webview_directory();
    let destination = data.join("EBWebView").join("Default");
    let marker = data.join("mineradio-chromium-storage-v1");
    if marker.is_file() || !source.is_dir() {
        return Ok(());
    }

    fs::create_dir_all(&destination)?;
    let staged = tempfile::Builder::new()
        .prefix(".mineradio-migrate-")
        .tempdir_in(&data)?;
    let mut locks = Vec::new();
    for name in DIRECTORIES {
        let from = source.join(name);
        if from.is_dir() && !destination.join(name).exists() {
            stage_directory(&from, &staged.path().join(name), &mut locks, 0)?;
        }
    }
    for name in DIRECTORIES {
        let ready = staged.path().join(name);
        if ready.is_dir() {
            fs::rename(ready, destination.join(name)).context("无法迁移 Mineradio 浏览器资料")?;
        }
    }
    File::create(marker)?.sync_all()?;
    Ok(())
}

fn stage_directory(
    source: &Path,
    target: &Path,
    guards: &mut Vec<File>,
    depth: usize,
) -> Result<()> {
    ensure!(depth < 32, "浏览器资料目录层级过深");
    let metadata = fs::symlink_metadata(source)?;
    ensure!(
        metadata.is_dir() && !is_link(&metadata),
        "浏览器资料中的目录链接无法迁移"
    );
    if let Some(lock) = exclusive_lock(&source.join("LOCK"))? {
        guards.push(lock);
    }
    fs::create_dir(target)?;
    for entry in fs::read_dir(source)? {
        let entry = entry?;
        let name = entry.file_name();
        if name == "LOCK" {
            continue;
        }
        let from = entry.path();
        let destination = target.join(name);
        let metadata = fs::symlink_metadata(&from)?;
        ensure!(!is_link(&metadata), "浏览器资料中的文件链接无法迁移");
        if metadata.is_dir() {
            stage_directory(&from, &destination, guards, depth + 1)?;
        } else {
            ensure!(metadata.is_file(), "浏览器资料包含特殊文件");
            fs::copy(&from, &destination)?;
        }
    }
    Ok(())
}

fn is_link(metadata: &fs::Metadata) -> bool {
    if metadata.file_type().is_symlink() {
        return true;
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        return metadata.file_attributes() & 0x400 != 0;
    }
    #[cfg(not(windows))]
    false
}

fn exclusive_lock(path: &Path) -> Result<Option<File>> {
    let mut options = fs::OpenOptions::new();
    options.read(true);
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        options.share_mode(0);
    }
    match options.open(path) {
        Ok(file) => Ok(Some(file)),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error).context("浏览器资料仍在使用，关闭旧版 Mineradio 后可再次迁移"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preserves_chromium_data_and_leaves_other_browser_state_outside_webview() {
        let temporary = tempfile::tempdir().unwrap();
        let profile = Profile::open(Some(temporary.path().to_owned())).unwrap();
        let legacy = profile.cache_root().unwrap().join("chromium/Mineradio");
        let leveldb = legacy.join("Local Storage/leveldb");
        fs::create_dir_all(&leveldb).unwrap();
        fs::write(leveldb.join("000002.log"), b"fixture").unwrap();
        fs::write(leveldb.join("LOCK"), []).unwrap();
        fs::write(legacy.join("Cookies"), b"unrelated browser state").unwrap();
        prepare(&profile).unwrap();
        let new_root = profile.webview_directory().join("EBWebView/Default");
        let file = new_root.join("Local Storage/leveldb/000002.log");
        assert_eq!(fs::read(&file).unwrap(), b"fixture");
        assert!(!new_root.join("Local Storage/leveldb/LOCK").exists());
        assert!(!new_root.join("Cookies").exists());
        fs::write(&file, b"newer").unwrap();
        prepare(&profile).unwrap();
        assert_eq!(fs::read(&file).unwrap(), b"newer");
    }
}
