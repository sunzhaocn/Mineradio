use super::{
    Account, accepted, code, details, first_text, id, normalized_track, signed_read, text, uint,
};
use anyhow::{Context, Result, ensure};
use serde_json::{Value, json};
use std::collections::HashSet;

const PAGE_LIMIT: usize = 100;
const MAX_PAGES: usize = 1000;

fn valid_list(value: &str) -> bool {
    (1..=128).contains(&value.len())
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
}

fn count(data: &Value, fields: &[&str]) -> Option<usize> {
    fields
        .iter()
        .find_map(|field| text(&data[*field]).parse::<usize>().ok())
}

fn card_track_count(data: &Value) -> Option<usize> {
    count(
        data,
        &[
            "count_tracks",
            "track_count",
            "media_count",
            "count",
            "total",
            "song_count",
        ],
    )
    .or_else(|| count(&data["resource_cnt"], &["track_cnt"]))
}

fn data(value: &Value) -> Result<&Value> {
    let body = value.get("data").unwrap_or(value);
    ensure!(body.is_object(), "汽水歌单数据格式无效");
    Ok(body)
}

fn cover(value: &Value, depth: usize) -> String {
    if depth >= 4 {
        return String::new();
    }
    if let Some(value) = value.as_str() {
        return value
            .starts_with("https://")
            .then_some(value.to_owned())
            .unwrap_or_default();
    }
    if let Some(rows) = value.as_array() {
        return rows
            .iter()
            .take(8)
            .map(|row| cover(row, depth + 1))
            .find(|value| !value.is_empty())
            .unwrap_or_default();
    }
    let mut root = cover(value.get("urls").unwrap_or(&value["url_list"]), depth + 1);
    let uri = text(&value["uri"]);
    if !uri.is_empty() && root.ends_with('/') {
        let template = value["template_prefix"]
            .as_str()
            .unwrap_or("tplv-b829550vbb");
        root.push_str(&format!("{uri}~{template}-crop-center:400:400.jpg"));
    }
    if root.is_empty() {
        return cover(&value["url"], depth + 1);
    }
    root
}

fn card(item: &Value, created: bool) -> Result<Value> {
    let id = first_text(&[&item["playlist_id"], &item["collection_id"], &item["id"]]);
    let name = first_text(&[
        &item["title"],
        &item["public_title"],
        &item["name"],
        &item["playlist_name"],
    ]);
    ensure!(
        valid_list(&id) && !name.trim().is_empty(),
        "汽水歌单资料不完整"
    );
    let liked = created
        && (code(&item["type"], 1)
            || item["is_liked"] == true
            || ["我喜欢", "我的喜欢", "liked music", "my favorite"]
                .iter()
                .any(|part| name.to_lowercase().contains(part)));
    let cover = cover(
        item.get("url_cover")
            .or_else(|| item.get("cover_url"))
            .unwrap_or(&item["cover"]),
        0,
    );
    Ok(
        json!({"id":id,"name":name,"cover":cover,"type":"playlist","source":"qishui","provider":"qishui",
        "isLiked":liked,"kind":if liked {"liked"} else if created {"created"} else {"collected"},
        "trackCount":card_track_count(item).unwrap_or_default(),"editable":created,"canAdd":created,"canRemove":created}),
    )
}

fn collect(
    node: &Value,
    direct: bool,
    created: bool,
    depth: usize,
    ids: &mut HashSet<String>,
    rows: &mut Vec<Value>,
) -> Result<()> {
    ensure!(depth <= 8, "汽水歌单资料层级无效");
    if let Some(list) = node.as_array() {
        for item in list {
            collect(item, direct, created, depth + 1, ids, rows)?;
        }
        return Ok(());
    }
    let Some(object) = node.as_object() else {
        return Ok(());
    };
    if direct
        && ["id", "playlist_id", "collection_id"]
            .iter()
            .any(|field| object.contains_key(*field))
    {
        let item = card(node, created)?;
        if ids.insert(text(&item["id"])) {
            rows.push(item);
        }
        return Ok(());
    }
    for (key, value) in object {
        let item = matches!(
            key.as_str(),
            "playlist"
                | "playlist_info"
                | "playlists"
                | "playlist_list"
                | "collect_playlist"
                | "fav_playlist"
        );
        if item
            || matches!(
                key.as_str(),
                "entity"
                    | "resource"
                    | "resources"
                    | "media_resources"
                    | "collection"
                    | "collections"
                    | "items"
                    | "list"
                    | "playlist_wrapper"
                    | "mixed_resources"
            )
        {
            collect(value, item, created, depth + 1, ids, rows)?;
        }
    }
    Ok(())
}

fn cursor(body: &Value, total: Option<usize>, loaded: usize) -> (bool, String) {
    let mut next = first_text(&[&body["next_cursor"], &body["nextCursor"]]);
    if next == "0" {
        next.clear();
    }
    let more = body
        .get("has_more")
        .or_else(|| body.get("hasMore"))
        .filter(|item| !item.is_null())
        .map(|value| *value == true || code(value, 1))
        .unwrap_or_else(|| total.map_or(!next.is_empty(), |total| loaded < total));
    (more, next)
}

async fn group(
    client: &reqwest::Client,
    user: &str,
    created: bool,
    account: &Account,
) -> Result<Vec<Value>> {
    let mut after = String::new();
    let mut rows = Vec::new();
    let mut seen = HashSet::new();
    let mut cursors = HashSet::new();
    let mut received = 0;
    for _ in 0..MAX_PAGES {
        let mut query = vec![("cursor", after.clone()), ("count", PAGE_LIMIT.to_string())];
        if created {
            query.push(("user_id", user.to_owned()));
        }
        let route = if created {
            "user/playlist"
        } else {
            "me/collection/mixed"
        };
        let response = accepted(signed_read(client, route, &query, None, account).await?)?;
        let body = data(&response)?;
        let before = rows.len();
        collect(body, false, created, 0, &mut seen, &mut rows)?;
        let containers = [
            "playlists",
            "playlist_list",
            "media_resources",
            "resources",
            "mixed_resources",
            "items",
            "list",
            "collections",
        ];
        let raw = containers
            .iter()
            .find_map(|key| body[*key].as_array())
            .map_or(rows.len() - before, Vec::len);
        let total = count(body, &["total_num", "total", "total_count"]);
        ensure!(
            rows.len() > before
                || total.is_some()
                || body.get("status_info").is_some()
                || containers.iter().any(|key| body.get(*key).is_some()),
            "汽水未返回歌单目录"
        );
        received += raw;
        let (more, next) = cursor(body, total, received);
        if !more {
            ensure!(
                total.is_none_or(|total| received >= total),
                "汽水歌单目录提前结束"
            );
            return Ok(rows);
        }
        ensure!(
            raw > 0 && !next.is_empty() && cursors.insert(next.clone()),
            "汽水歌单目录分页未推进"
        );
        after = next;
    }
    anyhow::bail!("汽水歌单目录过大")
}

pub async fn playlists(client: &reqwest::Client, account: &Account) -> Result<Value> {
    let body = accepted(signed_read(client, "me", &[], None, account).await?)?;
    let account_info = data(&body)?;
    let user = ["my_info", "user", "user_info", "account", "me"]
        .into_iter()
        .find_map(|key| account_info.get(key).filter(|value| value.is_object()))
        .unwrap_or(account_info);
    let user = first_text(&[&user["id"], &user["user_id"], &user["uid"]]);
    ensure!(id(&user), "汽水账号资料暂不可读");
    let (mut created, collected) = tokio::try_join!(
        group(client, &user, true, account),
        group(client, &user, false, account)
    )?;
    ensure!(
        created.iter().any(|value| value["isLiked"] == true),
        "汽水未返回我的喜欢歌单"
    );
    let mut ids: HashSet<_> = created.iter().map(|value| text(&value["id"])).collect();
    created.extend(
        collected
            .into_iter()
            .filter(|value| ids.insert(text(&value["id"]))),
    );
    Ok(json!({"playlists":created}))
}

fn track(row: &Value) -> Result<Value> {
    let entity = row.get("entity").unwrap_or(row);
    let media = entity.get("media").unwrap_or(entity);
    let wrapper = entity
        .get("track_wrapper")
        .or_else(|| media.get("track_wrapper"))
        .unwrap_or(&row["track_wrapper"]);
    let raw = wrapper
        .get("track")
        .or_else(|| media.get("track_entity"))
        .or_else(|| row.get("track_entity"))
        .or_else(|| media.get("track"))
        .or_else(|| row.get("track"))
        .unwrap_or(media);
    let base = raw.get("base_info").unwrap_or(raw);
    let related = &raw["related_info"];
    let album = related
        .get("album_link")
        .or_else(|| raw.get("album"))
        .unwrap_or(&base["album"]);
    let artists = related
        .get("artist_links")
        .or_else(|| base.get("artists"))
        .unwrap_or(&raw["artists"]);
    let normalized = json!({"id":first_text(&[&base["id"],&raw["id"]]),"name":first_text(&[&base["name"],&base["title"]]),
        "album":album,"artists":artists,"media_type":raw["media_type"],
        "duration":uint(&base["duration_ms"]).max(uint(&base["duration"])).max(uint(&raw["duration"])),
        "label_info":raw["label_info"]});
    let mut song = normalized_track(&normalized).context("汽水歌单曲目资料无效")?;
    if text(&song["cover"]).is_empty() {
        let cover = [
            &raw["display_info"]["cover_url"],
            &raw["display_info"]["url_cover"],
            &base["cover_url"],
            &base["url_cover"],
            &album["url_cover"],
            &album["cover_url"],
        ]
        .into_iter()
        .map(|item| cover(item, 0))
        .find(|value| !value.is_empty())
        .unwrap_or_default();
        song["cover"] = json!(cover);
    }
    Ok(song)
}

pub async fn tracks(
    client: &reqwest::Client,
    list: &str,
    offset: usize,
    limit: usize,
    account: &Account,
) -> Result<Value> {
    ensure!(valid_list(list), "汽水歌单编号无效");
    let mut after = String::new();
    let mut seen = HashSet::new();
    let mut events = HashSet::new();
    let mut rows = Vec::new();
    for _ in 0..MAX_PAGES {
        let response = accepted(
            signed_read(
                client,
                "playlist/detail",
                &[
                    ("playlist_id", list.to_owned()),
                    ("cursor", after.clone()),
                    ("count", PAGE_LIMIT.to_string()),
                ],
                None,
                account,
            )
            .await?,
        )?;
        let body = data(&response)?;
        let meta = body.get("playlist").unwrap_or(&body["playlist_info"]);
        ensure!(
            first_text(&[&meta["id"], &meta["playlist_id"]]) == list,
            "汽水返回了另一份歌单"
        );
        let total = card_track_count(meta);
        let (more, next) = cursor(body, total, rows.len());
        let empty = Vec::new();
        let batch = [
            "media_resources",
            "media_list",
            "tracks",
            "track_list",
            "songs",
            "items",
            "list",
        ]
        .into_iter()
        .find_map(|key| body[key].as_array())
        .or_else(|| (total == Some(0) && !more).then_some(&empty))
        .context("汽水未返回歌单曲目")?;
        let before = rows.len();
        for item in batch {
            let song = track(item)?;
            if seen.insert(text(&song["id"])) {
                rows.push(song);
            }
        }
        let (more, next) = if body
            .get("has_more")
            .or_else(|| body.get("hasMore"))
            .is_none()
        {
            cursor(body, total, rows.len())
        } else {
            (more, next)
        };
        ensure!(
            !more || rows.len() > before && !next.is_empty() && events.insert(next.clone()),
            "汽水歌单分页未推进"
        );
        if !more || rows.len() >= offset + limit {
            ensure!(
                more || total.is_none_or(|total| rows.len() >= total),
                "汽水歌单曲目分页提前结束"
            );
            let loaded = rows.len();
            let tracks: Vec<_> = rows.into_iter().skip(offset).take(limit).collect();
            let next = offset + tracks.len();
            return Ok(
                json!({"tracks":tracks,"total":total.or_else(|| (!more).then_some(loaded)),
                "hasMore":more || next < loaded,"nextOffset":next}),
            );
        }
        after = next;
    }
    anyhow::bail!("汽水歌单曲目过多")
}

pub async fn write(
    client: &reqwest::Client,
    list: &Value,
    song: &Value,
    add: bool,
    account: &Account,
) -> Result<()> {
    let id = text(&song["id"]);
    let list_id = text(&list["id"]);
    ensure!(
        super::id(&id) && valid_list(&list_id),
        "汽水歌单或歌曲编号无效"
    );
    let native = text(&song["nativeMediaType"]);
    let native = if matches!(native.as_str(), "track" | "ugc_clip") {
        native
    } else {
        text(&details(client, &id, account).await?["track"]["media_type"])
    };
    ensure!(
        matches!(native.as_str(), "track" | "ugc_clip"),
        "汽水音源类型无效"
    );
    let media = json!([{"id":id,"type":native}]);
    let (route, body) = if list["isLiked"] == true {
        if add {
            ("me/collection/media", json!({"media":media,"scene":""}))
        } else {
            ("me/collection/media/delete", json!({"media":media}))
        }
    } else {
        (
            if add {
                "me/playlist/media/append"
            } else {
                "me/playlist/media/delete"
            },
            json!({"media":media,"playlist_id":list_id}),
        )
    };
    accepted(signed_read(client, route, &[], Some(body), account).await?)?;
    Ok(())
}
