use crate::profile::{Profile, read_json, write_json};
use crate::providers::{text, uint};
use anyhow::{Context, Result, bail, ensure};
use serde_json::{Map, Value, json};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

const TRACK_FIELDS: &[&str] = &[
    "id",
    "source",
    "provider",
    "type",
    "mid",
    "songmid",
    "mediaMid",
    "qqId",
    "hash",
    "audioHash",
    "fileHash",
    "providerSongId",
    "albumId",
    "albumMid",
    "albumAudioId",
    "mixSongId",
    "hqHash",
    "sqHash",
    "resHash",
    "name",
    "title",
    "artist",
    "artists",
    "artistId",
    "artistMid",
    "album",
    "cover",
    "duration",
    "durationMs",
    "dt",
    "localKey",
    "localFileId",
    "localUrl",
    "localPath",
    "localMissing",
    "hasLyric",
    "lyricSource",
    "nativeMediaType",
    "fee",
    "playable",
    "vipRequired",
    "onlyVipPlayable",
    "privilege",
];

pub struct Library {
    profile: Profile,
    writes: Mutex<()>,
}

impl Library {
    pub fn new(profile: Profile) -> Self {
        Self {
            profile,
            writes: Mutex::new(()),
        }
    }

    pub fn visual_settings(&self, update: Option<&Value>) -> Result<Value> {
        const MAX_VISUAL_BYTES: u64 = 12 * 1024 * 1024;
        let path = self.profile.visual_settings();
        if let Some(values) = update {
            ensure!(
                values.is_object() && serde_json::to_vec(values)?.len() as u64 <= MAX_VISUAL_BYTES,
                "视觉设置资料无效或过大"
            );
            let _guard = self.writes.lock().expect("library mutation poisoned");
            write_json(&path, values)?;
            return Ok(json!({"ok":true}));
        }
        let saved = std::fs::metadata(&path)
            .ok()
            .filter(|entry| entry.len() <= MAX_VISUAL_BYTES + 512 * 1024)
            .and_then(|_| read_json::<Value>(&path).ok().flatten())
            .filter(Value::is_object);
        Ok(json!({"ok":true,"payload":saved}))
    }

    fn local_index(&self) -> Result<Value> {
        let data: Value = read_json(&self.profile.root.join("local-music-library.json"))?
            .unwrap_or_else(|| json!({"version":1,"records":[]}));
        ensure!(
            data["version"] == 1 && data["records"].is_array(),
            "本机曲库数据格式无效"
        );
        Ok(data)
    }

    pub fn local_tracks(&self) -> Result<Value> {
        let data = self.local_index()?;
        let tracks: Vec<_> = data["records"]
            .as_array()
            .into_iter()
            .flatten()
            .take(50_000)
            .filter_map(|row| self.local_song(row))
            .collect();
        Ok(json!({"ok":true,"version":1,"count":tracks.len(),"tracks":tracks}))
    }

    fn local_song(&self, record: &Value) -> Option<Value> {
        let id = record["id"].as_str()?;
        let audio = trusted_audio(record)?;
        let path = record["relativePath"]
            .as_str()
            .filter(|name| !name.is_empty())
            .unwrap_or_else(|| {
                audio
                    .file_name()
                    .and_then(|value| value.to_str())
                    .unwrap_or_default()
            });
        let cover = self
            .cover_path(record)
            .is_some()
            .then(|| format!("/api/native/cover/{id}"))
            .unwrap_or_default();
        let title = record["name"].as_str().unwrap_or_default();
        Some(json!({
            "type":"local","provider":"local","source":"local","id":format!("local:{id}"),
            "localKey":id,"localFileId":id,"localUrl":format!("/api/native/audio/{id}"),"localPath":path,
            "localMissing":!audio.is_file(),"name":title,"title":title,"artist":record["artist"],
            "album":record["album"],"duration":record["duration"].as_f64().unwrap_or(0.0).max(0.0),"cover":cover,
            "hasLyric":record["lyric"].as_str().is_some_and(|lyric| !lyric.is_empty()),"lyricSource":text(&record["lyricSource"]),
        }))
    }

    fn cover_path(&self, record: &Value) -> Option<PathBuf> {
        let path = absolute_local(record["coverPath"].as_str()?)?
            .canonicalize()
            .ok()?;
        let root = self
            .profile
            .root
            .join("local-music-library/covers")
            .canonicalize()
            .ok()?;
        (path.starts_with(root) && path.is_file()).then_some(path)
    }

    pub fn local_media(&self, id: &str, image: bool) -> Result<Option<PathBuf>> {
        if !valid_id(id) {
            return Ok(None);
        }
        let index = self.local_index()?;
        let record = index["records"]
            .as_array()
            .into_iter()
            .flatten()
            .find(|row| row["id"] == id);
        Ok(record.and_then(|entry| {
            if image {
                self.cover_path(entry)
            } else {
                trusted_audio(entry)
            }
        }))
    }

    pub fn local_lyric(&self, id: &str) -> Result<Value> {
        let id = id.strip_prefix("local:").unwrap_or(id);
        let index = self.local_index()?;
        let record = index["records"]
            .as_array()
            .into_iter()
            .flatten()
            .find(|row| row["id"] == id && trusted_audio(row).is_some());
        Ok(match record {
            Some(row) => {
                json!({"ok":true,"localFileId":id,"lyric":text(&row["lyric"]),"lyricSource":text(&row["lyricSource"])})
            }
            None => {
                json!({"ok":false,"localFileId":id,"lyric":"","missing":true,"error":"LOCAL_TRACK_MISSING"})
            }
        })
    }

    pub fn command(&self, operation: &str, args: &[Value]) -> Result<Value> {
        let argument = |index: usize| args.get(index).unwrap_or(&Value::Null);
        match operation {
            "listLocalMusicLibrary" => return self.local_tracks(),
            "readLocalMusicLyric" => {
                return self.local_lyric(argument(0).as_str().unwrap_or_default());
            }
            "readLyricCache" => return self.read_lyric_cache(argument(0)),
            "writeLyricCache" => return self.write_lyric_cache(argument(0), argument(1)),
            _ => {}
        }
        let _guard = self.writes.lock().expect("library mutation poisoned");
        let path = self.profile.root.join("built-in-playlists.json");
        let mut index: Value =
            read_json(&path)?.unwrap_or_else(|| json!({"version":1,"playlists":[]}));
        ensure!(
            index["version"] == 1 && index["playlists"].is_array(),
            "本机歌单数据格式无效"
        );
        let rows = index["playlists"].as_array_mut().expect("validated above");
        if operation == "listBuiltInPlaylists" {
            return Ok(playlists(rows));
        }
        if operation == "createBuiltInPlaylist" {
            ensure!(rows.len() < 100, "本机歌单数量已达上限");
            let id: String = uuid::Uuid::new_v4()
                .simple()
                .to_string()
                .chars()
                .take(24)
                .collect();
            let now = epoch_ms();
            let row = json!({"id":id,"name":name(argument(0),"我的歌单"),"createdAt":now,"updatedAt":now,"tracks":[]});
            let created = summary(&row);
            rows.insert(0, row);
            let result = mutation_result(rows, json!({"playlist":created}));
            index["updatedAt"] = json!(now);
            write_json(&path, &index)?;
            return Ok(result);
        }

        let id = argument(0).as_str().unwrap_or_default();
        ensure!(valid_id(id), "本机歌单标识无效");
        let position = rows
            .iter()
            .position(|row| row["id"] == id)
            .context("本机歌单不存在")?;
        if operation == "readBuiltInPlaylist" {
            let row = &rows[position];
            let tracks = row["tracks"].as_array().context("本机歌单曲目无效")?;
            let options = argument(1);
            let offset = uint(&options["offset"]).min(tracks.len() as u64) as usize;
            let limit = options["limit"].as_u64().unwrap_or(96).clamp(1, 500) as usize;
            let page: Vec<_> = tracks
                .iter()
                .skip(offset)
                .take(limit)
                .map(native_track_view)
                .collect();
            let next = offset.saturating_add(page.len());
            return Ok(
                json!({"ok":true,"playlist":summary(row),"tracks":page,"total":tracks.len(),
                "nextOffset":next,"hasMore":next < tracks.len()}),
            );
        }
        let now = epoch_ms();
        let extra = if operation == "deleteBuiltInPlaylist" {
            rows.remove(position);
            json!({"deletedId":id})
        } else {
            let row = &mut rows[position];
            if operation == "renameBuiltInPlaylist" {
                row["name"] = json!(name(
                    argument(1),
                    row["name"].as_str().unwrap_or("未命名歌单")
                ));
            } else {
                let tracks = row["tracks"].as_array_mut().context("本机歌单曲目无效")?;
                match operation {
                    "addBuiltInPlaylistTrack" => {
                        let entry = sanitize_track(argument(1))?;
                        let id = &entry["builtInIdentity"];
                        if tracks.iter().any(|row| row["builtInIdentity"] == *id) {
                            return Ok(mutation_result(
                                rows,
                                json!({"duplicate":true,"playlist":summary(&rows[position])}),
                            ));
                        }
                        ensure!(tracks.len() < 5000, "本机歌单曲目数量已达上限");
                        tracks.push(entry);
                    }
                    "removeBuiltInPlaylistTrack" => {
                        let index = track_index(argument(1), tracks.len())?;
                        tracks.remove(index);
                    }
                    "reorderBuiltInPlaylistTrack" => {
                        let from = track_index(argument(1), tracks.len())?;
                        let to = track_index(argument(2), tracks.len())?;
                        let item = tracks.remove(from);
                        tracks.insert(to, item);
                    }
                    _ => bail!("本机曲库操作无效"),
                }
            }
            row["updatedAt"] = json!(now);
            json!({"playlist":summary(row)})
        };
        let result = mutation_result(rows, extra);
        index["updatedAt"] = json!(now);
        write_json(&path, &index)?;
        Ok(result)
    }

    fn read_lyric_cache(&self, key: &Value) -> Result<Value> {
        let path = self.lyric_cache_path(key)?;
        let record: Option<Value> = read_json(&path)?;
        let hit = record.filter(|row| row["version"] == 1 && row["payload"].is_object());
        Ok(match hit {
            Some(row) => {
                json!({"ok":true,"hit":true,"payload":row["payload"],"cachedAt":row["cachedAt"]})
            }
            None => json!({"ok":true,"hit":false}),
        })
    }

    fn write_lyric_cache(&self, key: &Value, payload: &Value) -> Result<Value> {
        let path = self.lyric_cache_path(key)?;
        ensure!(
            payload.is_object() && serde_json::to_vec(payload)?.len() < 1024 * 1024,
            "歌词缓存数据无效"
        );
        write_json(
            &path,
            &json!({"version":1,"cachedAt":epoch_ms(),"payload":payload}),
        )?;
        Ok(json!({"ok":true}))
    }

    fn lyric_cache_path(&self, key: &Value) -> Result<PathBuf> {
        let key = key.as_str().context("歌词缓存标识无效")?;
        ensure!(!key.is_empty() && key.len() <= 1024, "歌词缓存标识无效");
        let digest = hex::encode(Sha256::digest(key.as_bytes()));
        Ok(self
            .profile
            .cache_root()?
            .join("lyrics")
            .join(format!("{digest}.json")))
    }
}

fn absolute_local(raw: &str) -> Option<PathBuf> {
    let path = Path::new(raw);
    (path.is_absolute() && !raw.starts_with("\\\\") && !raw.starts_with("//"))
        .then(|| std::path::absolute(path).ok())
        .flatten()
}

fn trusted_audio(record: &Value) -> Option<PathBuf> {
    let path = absolute_local(record["audioPath"].as_str()?)?;
    let ext = path.extension()?.to_str()?.to_ascii_lowercase();
    if !matches!(
        ext.as_str(),
        "mp3" | "flac" | "wav" | "ogg" | "m4a" | "aac" | "opus"
    ) {
        return None;
    }
    let id = record["id"].as_str()?;
    let normalized = path.to_string_lossy().to_lowercase();
    let digest = hex::encode(Sha256::digest(normalized.as_bytes()));
    (valid_id(id) && id == &digest[..24]).then_some(path)
}

fn valid_id(value: &str) -> bool {
    value.len() == 24 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn native_track_view(track: &Value) -> Value {
    let mut view = track.clone();
    if track["provider"] == "local" {
        let raw = track["localFileId"]
            .as_str()
            .or_else(|| track["localKey"].as_str())
            .or_else(|| {
                track["id"]
                    .as_str()
                    .and_then(|id| id.strip_prefix("local:"))
            });
        if let Some(id) = raw.filter(|id| valid_id(id)) {
            view["localUrl"] = json!(format!("/api/native/audio/{id}"));
            if track["cover"]
                .as_str()
                .is_some_and(|url| url.starts_with("mineradio-local:"))
            {
                view["cover"] = json!(format!("/api/native/cover/{id}"));
            }
        }
    }
    view
}

fn summary(row: &Value) -> Value {
    let cover = row["tracks"]
        .get(0)
        .map(native_track_view)
        .map(|track| text(&track["cover"]))
        .unwrap_or_default();
    json!({"id":row["id"],"provider":"mineradio","source":"mineradio","builtin":true,"name":row["name"],
        "creator":"Mineradio","trackCount":row["tracks"].as_array().map_or(0,Vec::len),"cover":cover,
        "createdAt":row["createdAt"],"updatedAt":row["updatedAt"],"shelfPane":"mine","subscribed":false})
}

fn playlists(rows: &[Value]) -> Value {
    json!({"ok":true,"version":1,"count":rows.len(),"playlists":rows.iter().map(summary).collect::<Vec<_>>()})
}

fn mutation_result(rows: &[Value], extra: Value) -> Value {
    let mut result = playlists(rows);
    if let Some(values) = extra.as_object() {
        result
            .as_object_mut()
            .expect("playlist result object")
            .extend(values.clone());
    }
    result
}

fn name(value: &Value, fallback: &str) -> String {
    let raw = value.as_str().unwrap_or_default().trim();
    if raw.is_empty() {
        return fallback.to_owned();
    }
    raw.chars()
        .filter(|letter| !letter.is_control())
        .take(80)
        .collect()
}

fn track_index(value: &Value, size: usize) -> Result<usize> {
    value
        .as_u64()
        .and_then(|value| usize::try_from(value).ok())
        .filter(|value| *value < size)
        .context("曲目位置无效")
}

fn sanitize_track(value: &Value) -> Result<Value> {
    let provider = value["provider"]
        .as_str()
        .or_else(|| value["source"].as_str())
        .unwrap_or_default();
    let key_fields: &[&str] = match provider {
        "local" => &["localFileId", "localKey", "id"],
        "netease" | "qishui" => &["id", "providerSongId"],
        "qq" => &["mid", "songmid", "id"],
        "kugou" => &["hash", "fileHash", "audioHash", "id"],
        _ => bail!("歌曲平台无效"),
    };
    let key = key_fields
        .iter()
        .map(|field| text(&value[*field]))
        .find(|key| !key.is_empty())
        .context("歌曲缺少标识")?;
    let key = match provider {
        "local" => key.strip_prefix("local:").unwrap_or(&key).to_owned(),
        "kugou" => key.to_ascii_lowercase(),
        _ => key,
    };
    let mut track: Map<String, Value> = TRACK_FIELDS
        .iter()
        .filter_map(|field| {
            value
                .get(*field)
                .map(|item| ((*field).into(), item.clone()))
        })
        .collect();
    track.insert("builtInIdentity".into(), json!(format!("{provider}:{key}")));
    track.insert("provider".into(), json!(provider));
    track.insert("source".into(), json!(provider));
    ensure!(
        serde_json::to_vec(&track)?.len() <= 48 * 1024,
        "歌曲资料过长"
    );
    Ok(Value::Object(track))
}

fn epoch_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}
