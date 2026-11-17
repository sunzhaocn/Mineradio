use super::{accepted, normalized_track, signed_read};
use crate::accounts::Account;
use crate::providers::{numeric_id, object_rows, text, uint};
use anyhow::{Context, Result, ensure};
use serde_json::{Value, json};
use std::collections::HashSet;

fn cover(raw: &Value) -> String {
    let base = text(&raw["urls"][0]);
    let asset = text(&raw["uri"]);
    let variant = raw["template_prefix"]
        .as_str()
        .filter(|value| !value.is_empty())
        .unwrap_or("tplv-b829550vbb");
    if !base.is_empty() && !asset.is_empty() {
        format!("{base}{asset}~{variant}-crop-center:400:400.jpg")
    } else {
        String::new()
    }
}

pub async fn album(
    client: &reqwest::Client,
    id: &str,
    offset: usize,
    limit: usize,
    account: &Account,
) -> Result<Value> {
    numeric_id(id)?;
    let data = accepted(
        signed_read(
            client,
            &format!("albums/{id}"),
            &[("ignore_tracks", "false".into())],
            None,
            account,
        )
        .await?,
    )?;
    let raw = &data["album_info"];
    ensure!(
        text(&raw["id"]) == id && !text(&raw["name"]).is_empty(),
        "汽水专辑资料不完整"
    );
    let rows = data["tracks"].as_array().context("汽水专辑未返回曲目")?;
    let total = rows.len();
    ensure!(
        uint(&raw["count_tracks"]) <= total as u64,
        "汽水专辑曲目尚未读取完整"
    );
    let mut identifiers = HashSet::new();
    let mut tracks = Vec::new();
    for (index, row) in rows.iter().enumerate() {
        let song_id = text(&row["id"]);
        ensure!(
            numeric_id(&song_id).is_ok() && identifiers.insert(song_id),
            "汽水专辑含重复或无效曲目"
        );
        if !(offset..offset + limit).contains(&index) {
            continue;
        }
        let mut row = row.clone();
        if !row["album"].is_object() || text(&row["album"]["id"]) != id {
            row["album"] = raw.clone();
        }
        let mut track = normalized_track(&row).context("汽水专辑包含无效曲目")?;
        track["track_number"] = json!(index + 1);
        tracks.push(track);
    }
    let artists = object_rows(&raw["artists"])
        .filter_map(|row| row["name"].as_str())
        .collect::<Vec<_>>();
    let date = text(&raw["release_date"])
        .parse::<i64>()
        .ok()
        .and_then(|value| time::OffsetDateTime::from_unix_timestamp(value).ok())
        .map_or_else(String::new, |value| {
            (value + time::Duration::hours(8)).date().to_string()
        });
    let next = offset + tracks.len();
    Ok(
        json!({"ok":true,"provider":"qishui","album":{"id":id,"albumId":id,"name":text(&raw["name"]),
        "artist":artists.join(" / "),"artists":artists,"cover":cover(&raw["url_cover"]),"description":text(&raw["intro"]),
        "publish_time":date,"company":text(&raw["company"]),"type":text(&raw["type"]),"total":total},
        "songs":tracks,"total":total,"nextOffset":next,"hasMore":next<total}),
    )
}

pub async fn artist(
    client: &reqwest::Client,
    id: &str,
    offset: usize,
    limit: usize,
    account: &Account,
) -> Result<Value> {
    numeric_id(id)?;
    let address = format!("artists/{id}");
    let detail = accepted(
        signed_read(
            client,
            &address,
            &[("locate_item_id", String::new())],
            None,
            account,
        )
        .await?,
    )?;
    let raw = &detail["artist_info"];
    let name = text(&raw["name"]);
    ensure!(
        text(&raw["id"]) == id && !name.is_empty(),
        "汽水歌手资料不完整"
    );
    let count = uint(&raw["count_tracks"]) as usize;
    let aliases = raw
        .get("aliases")
        .or_else(|| raw.get("alias"))
        .unwrap_or(&raw["artist_profile"]["aliases"]);
    let alias = if let Some(alias) = aliases.as_str() {
        vec![alias.to_owned()]
    } else {
        aliases
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
            .map(str::to_owned)
            .collect()
    };
    let address = format!("{address}/tracks");
    let mut cursor = String::new();
    let mut seen_cursors = HashSet::new();
    let mut songs = HashSet::new();
    let mut tracks = Vec::new();
    let mut observed = 0usize;
    let mut more = true;
    for _ in 0..200 {
        let page = accepted(
            signed_read(
                client,
                &address,
                &[
                    ("cursor", cursor.clone()),
                    ("count", "50".into()),
                    ("sort_type", "0".into()),
                ],
                None,
                account,
            )
            .await?,
        )?;
        let empty = Vec::new();
        let rows = if count == 0 && page["tracks"].is_null() {
            &empty
        } else {
            page["tracks"]
                .as_array()
                .context("汽水歌手曲目响应不完整")?
        };
        for track in rows {
            let track = normalized_track(track).context("汽水歌手包含无效曲目")?;
            ensure!(
                songs.insert(text(&track["id"])),
                "汽水歌手曲目分页返回重复内容"
            );
            if (offset..offset + limit).contains(&observed) {
                tracks.push(track);
            }
            observed += 1;
        }
        more = page["has_more"] == true || super::code(&page["has_more"], 1);
        if !more || observed >= offset + limit {
            break;
        }
        let next = text(&page["next_cursor"]);
        ensure!(
            !rows.is_empty()
                && !next.is_empty()
                && next.len() <= 512
                && seen_cursors.insert(next.clone()),
            "汽水歌手曲目分页停止推进"
        );
        cursor = next;
    }
    ensure!(
        !more || observed >= offset + limit,
        "汽水歌手歌曲数量已超出本次读取范围"
    );
    let next = offset + tracks.len();
    let total = if more { count.max(observed) } else { observed };
    Ok(
        json!({"ok":true,"provider":"qishui","artist":{"id":id,"name":name,"avatar":cover(&raw["url_avatar"]),
        "description":text(&raw["artist_profile"]["intro"]),"alias":alias,"song_count":total},
        "songs":tracks,"total":total,"totalEstimated":more,"hasMore":more||next<total,"nextOffset":next,"scope":"hot"}),
    )
}
