use crate::accounts::{Account, Accounts, Provider};
use crate::providers::{
    first_text, kugou, netease, numeric_id, object_rows, qishui, qq, text, uint,
};
use anyhow::{Context, Result, ensure};
use futures_util::{StreamExt, stream};
use serde_json::{Map, Value, json};
use sha2::{Digest, Sha256};
use std::collections::VecDeque;
use std::time::{Duration, Instant};
use tokio::sync::Mutex;

pub struct Cloud {
    writes: [Mutex<()>; 32],
    replies: Mutex<VecDeque<WriteResult>>,
}

struct WriteResult {
    scope: [u8; 32],
    request: String,
    payload: [u8; 32],
    response: Value,
    recorded: Instant,
}

impl Default for Cloud {
    fn default() -> Self {
        Self {
            writes: std::array::from_fn(|_| Mutex::new(())),
            replies: Mutex::default(),
        }
    }
}

async fn playlists(
    client: &reqwest::Client,
    provider: Provider,
    account: &Account,
) -> Result<Vec<Value>> {
    if !account.configured() {
        return Ok(Vec::new());
    }
    let result = match provider {
        Provider::Netease => netease::playlists(client, account).await?,
        Provider::Qq => qq::playlists(client, account).await?,
        Provider::Kugou => kugou::library::playlists(client, account).await?,
        Provider::Qishui => qishui::library::playlists(client, account).await?,
    };
    Ok(object_rows(&result["playlists"])
        .map(|row| {
            let mut row = row.clone();
            row["readonly"] = json!(true);
            row["source"] = json!(provider.name());
            row["shelfPane"] = json!("mine");
            row
        })
        .collect())
}

pub async fn catalogue(
    client: &reqwest::Client,
    provider: Option<Provider>,
    accounts: &Accounts,
) -> Value {
    let selected: Vec<_> =
        provider.map_or_else(|| Provider::ALL.to_vec(), |platform| vec![platform]);
    let results = stream::iter(selected.into_iter().map(|key| async move {
        let account = accounts.account(key);
        let configured = account.configured();
        let result = playlists(client, key, &account).await;
        (key, configured, result)
    }))
    .buffered(4)
    .collect::<Vec<_>>()
    .await;
    let (mut summaries, mut all, mut partial) = (Map::new(), Vec::new(), false);
    for (platform, configured, result) in results {
        let (rows, ok) = match result {
            Ok(rows) => (rows, true),
            Err(_) => (Vec::new(), false),
        };
        partial |= configured && !ok;
        summaries.insert(platform.name().into(), json!({"provider":platform.name(),
            "configured":configured,"loggedIn":configured,"ok":ok,"libraryVerified":configured && ok,
            "message":if ok {""} else {"平台歌单暂不可读取"},"playlistCount":rows.len()}));
        all.extend(rows);
    }
    json!({"ok":true,"playlists":all,"providers":summaries,"partial":partial,
        "nextOffset":all.len(),"total":all.len(),"hasMore":false})
}

pub async fn tracks(
    client: &reqwest::Client,
    provider: Provider,
    identifier: &str,
    limit: usize,
    offset: usize,
    liked: bool,
    account: &Account,
) -> Result<Value> {
    let id = if liked {
        let lists = playlists(client, provider, account).await?;
        lists
            .iter()
            .find(|row| row["isLiked"] == true)
            .map(|row| text(&row["id"]))
            .context("平台未返回我的喜欢歌单")?
    } else {
        identifier.to_owned()
    };
    let mut result = match provider {
        Provider::Netease => netease::playlist_tracks(client, &id, offset, limit, account).await?,
        Provider::Qq => qq::playlist_tracks(client, &id, offset, limit, account).await?,
        Provider::Kugou => kugou::library::tracks(client, &id, offset, limit, account).await?,
        Provider::Qishui => qishui::library::tracks(client, &id, offset, limit, account).await?,
    };
    result["ok"] = json!(true);
    result["provider"] = json!(provider.name());
    Ok(result)
}

fn song(raw: &Value, fallback: Option<Provider>) -> Result<(Provider, Value)> {
    let name = first_text(&[&raw["provider"], &raw["source"]]);
    let platform = if name.is_empty() {
        fallback
    } else {
        Provider::parse(&name)
    }
    .context("请选择歌曲的平台音源")?;
    ensure!(
        fallback.is_none_or(|expected| expected == platform),
        "歌曲音源与歌单的平台不一致"
    );
    let key = match platform {
        Provider::Qq => first_text(&[&raw["mid"], &raw["id"]]),
        Provider::Kugou => first_text(&[&raw["hash"], &raw["id"]]),
        _ => text(&raw["id"]),
    };
    ensure!(
        !key.is_empty() && key.len() <= 64 && key.bytes().all(|byte| byte.is_ascii_alphanumeric()),
        "歌曲缺少有效的平台原始编号"
    );
    let mut projected = json!({"id":key,"provider":platform.name(),"source":platform.name()});
    for field in [
        "name",
        "artist",
        "album",
        "albumId",
        "albumMid",
        "mediaMid",
        "qqId",
        "nativeMediaType",
        "mixSongId",
        "albumAudioId",
        "duration",
    ] {
        let value = &raw[field];
        ensure!(
            value.is_null()
                || value.is_number()
                || value.as_str().is_some_and(
                    |value| value.len() <= 2048 && !value.chars().any(char::is_control)
                ),
            "歌曲资料格式无效"
        );
        if !value.is_null() {
            projected[field] = value.clone();
        }
    }
    if platform == Provider::Qq {
        projected["mid"] = json!(key);
    }
    if platform == Provider::Kugou {
        projected["hash"] = json!(key);
    }
    Ok((platform, projected))
}

async fn member(
    client: &reqwest::Client,
    provider: Provider,
    list: &str,
    key: &str,
    account: &Account,
) -> Result<Option<Value>> {
    if provider == Provider::Netease {
        let id = numeric_id(key)?;
        return Ok(netease::playlist_index(client, list, account)
            .await?
            .contains(&id)
            .then(|| json!({"id":key})));
    }
    let mut offset = 0;
    for _ in 0..1000 {
        let page = tracks(client, provider, list, 100, offset, false, account).await?;
        if let Some(found) =
            object_rows(&page["tracks"]).find(|row| text(&row["id"]).eq_ignore_ascii_case(key))
        {
            return Ok(Some(found.clone()));
        }
        if page["hasMore"] != true {
            return Ok(None);
        }
        let next = uint(&page["nextOffset"]) as usize;
        ensure!(next > offset, "歌单分页未前进，请稍后重试");
        offset = next;
    }
    anyhow::bail!("歌单曲目过多，暂时无法核对");
}

impl Cloud {
    pub async fn membership(
        &self,
        client: &reqwest::Client,
        payload: &Value,
        accounts: &Accounts,
    ) -> Result<Value> {
        const MAX_MATCHES: usize = 16;
        let base = &payload["song"];
        let (platform, track) = song(base, None)?;
        let mut sources = std::collections::HashMap::from([(platform, track)]);
        for raw in payload["sources"]
            .as_array()
            .into_iter()
            .flatten()
            .chain(base["_webFavoriteSources"].as_array().into_iter().flatten())
            .chain(base["_webSearchSources"].as_array().into_iter().flatten())
            .take(MAX_MATCHES * 3)
        {
            let (platform, track) = song(raw, None)?;
            sources.entry(platform).or_insert(track);
        }
        let results = stream::iter(Provider::ALL.into_iter().map(|platform| {
            let matched = sources.get(&platform);
            async move {
                let account = accounts.account(platform);
                let configured = account.configured();
                let result = async {
                    if !configured {
                        return Ok(Vec::new());
                    }
                    let matched = matched.context("尚未匹配到该平台的同一首歌")?;
                    let mut rows = Vec::new();
                    for mut list in playlists(client, platform, &account)
                        .await?
                        .into_iter()
                        .filter(|row| row["editable"] == true)
                    {
                        if member(
                            client,
                            platform,
                            &text(&list["id"]),
                            &text(&matched["id"]),
                            &account,
                        )
                        .await?
                        .is_some()
                        {
                            list["matchedSong"] = matched.clone();
                            rows.push(list);
                        }
                    }
                    Ok::<_, anyhow::Error>(rows)
                }
                .await;
                (platform, configured, result)
            }
        }))
        .buffered(4)
        .collect::<Vec<_>>()
        .await;
        let (mut summaries, mut all, mut partial) = (Map::new(), Vec::new(), false);
        for (platform, configured, result) in results {
            let ok = result.is_ok();
            partial |= !ok;
            let rows = result.unwrap_or_default();
            summaries.insert(
                platform.name().into(),
                json!({"provider":platform.name(),"configured":configured,
                "ok":ok,"playlists":rows,"message":if ok {""} else {"平台歌曲归属暂不可确认"}}),
            );
            all.extend(rows);
        }
        Ok(json!({"ok":true,"providers":summaries,"playlists":all,"partial":partial}))
    }

    pub async fn mutate(
        &self,
        client: &reqwest::Client,
        payload: &Value,
        accounts: &Accounts,
    ) -> Result<Value> {
        let provider = payload["provider"]
            .as_str()
            .and_then(Provider::parse)
            .context("请选择有效的音乐平台")?;
        let operation = payload["operation"]
            .as_str()
            .filter(|value| matches!(*value, "add" | "remove"))
            .context("选择有效的歌单操作")?;
        let identifier = payload["id"]
            .as_str()
            .filter(|value| !value.is_empty() && value.len() <= 128)
            .context("请先选择有效的歌单")?;
        let request = payload["requestId"]
            .as_str()
            .filter(|value| {
                (8..=128).contains(&value.len())
                    && value
                        .bytes()
                        .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
            })
            .context("操作标识已过期，请重新选择歌单")?;
        let (_, track) = song(&payload["song"], Some(provider))?;
        let account = accounts.account(provider);
        ensure!(account.configured(), "请先登录所选平台");
        let scope = accounts.scope(provider);
        let digest: [u8; 32] =
            Sha256::digest(json!([identifier, operation, track]).to_string()).into();
        let _serial = self.writes[scope[0] as usize % self.writes.len()]
            .lock()
            .await;
        {
            let mut replies = self.replies.lock().await;
            replies.retain(|entry| entry.recorded.elapsed() < Duration::from_secs(3600));
            if let Some(previous) = replies
                .iter()
                .find(|entry| entry.scope == scope && entry.request == request)
            {
                ensure!(previous.payload == digest, "该操作标识已在另一笔同步中使用");
                return Ok(previous.response.clone());
            }
        }
        // The client may disconnect after the platform accepted a write. The HTTP
        // dispatch runs this method in an owned task through verification.
        let exact = match change(
            client,
            provider,
            &account,
            identifier,
            &track,
            operation == "add",
        )
        .await
        {
            Ok(changed) => {
                json!({"ok":true,"verified":true,"changed":changed,"provider":provider.name(),
                "playlistId":identifier,"operation":operation,"message":"平台已确认歌单同步"})
            }
            Err(error) if error.is::<qq::WriteRequiresLogin>() => {
                json!({"ok":false,"provider":provider.name(),"error":"library_login_required",
                "message":error.to_string()})
            }
            Err(_) => {
                json!({"ok":false,"provider":provider.name(),"error":"library_sync_unconfirmed",
                "message":"平台未确认歌单同步，请刷新歌单核对"})
            }
        };
        let mut replies = self.replies.lock().await;
        replies.push_front(WriteResult {
            scope,
            request: request.into(),
            payload: digest,
            response: exact.clone(),
            recorded: Instant::now(),
        });
        replies.truncate(512);
        Ok(exact)
    }
}

async fn change(
    client: &reqwest::Client,
    provider: Provider,
    account: &Account,
    identifier: &str,
    track: &Value,
    add: bool,
) -> Result<bool> {
    let catalog = playlists(client, provider, account).await?;
    let field = if add { "canAdd" } else { "canRemove" };
    let target = catalog
        .iter()
        .find(|row| row["id"] == identifier && row["editable"] == true && row[field] == true)
        .context("歌单不属于当前账号或无法编辑")?;
    let key = text(&track["id"]);
    let existing = member(client, provider, identifier, &key, account).await?;
    if existing.is_some() == add {
        return Ok(false);
    }
    let write_result = match provider {
        Provider::Netease => netease::write_playlist(client, identifier, &key, add, account).await,
        Provider::Kugou => {
            kugou::library::write(client, identifier, track, add, existing.as_ref(), account).await
        }
        Provider::Qishui => qishui::library::write(client, target, track, add, account).await,
        Provider::Qq => qq::write_playlist(client, target, &key, add, account).await,
    };
    for delay in [0, 400, 1000] {
        if delay > 0 {
            tokio::time::sleep(Duration::from_millis(delay)).await;
        }
        if member(client, provider, identifier, &key, account)
            .await
            .is_ok_and(|value| value.is_some() == add)
        {
            return Ok(true);
        }
    }
    write_result?;
    anyhow::bail!("平台未确认歌单同步")
}
