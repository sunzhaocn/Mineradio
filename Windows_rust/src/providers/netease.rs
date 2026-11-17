use super::{Quality, ResolvedTrack, code, numeric_id, object_rows, text, uint};
use crate::accounts::{Account, Provider};
use anyhow::{Context, Result, ensure};
use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use cbc::cipher::{BlockEncryptMut, KeyIvInit, block_padding::Pkcs7};
use num_bigint::BigUint;
use reqwest::header::{ACCEPT, COOKIE, ORIGIN, REFERER};
use serde_json::{Value, json};
use std::collections::{HashMap, HashSet};
use std::sync::LazyLock;

const BASE: &str = "https://music.163.com";
const WE_KEY: &[u8; 16] = b"0CoJUm6Qyw8W8jud";
const WE_IV: &[u8; 16] = b"0102030405060708";
const PLAY: &str = "/weapi/song/enhance/player/url/v1";
const DETAIL: &str = "/weapi/v3/song/detail";
const ACCOUNT: &str = "/weapi/w/nuser/account/get";
const QUALITY: [(&str, &str, u64); 4] = [
    ("lossless", "SQ(无损)", 999_000),
    ("exhigh", "320k", 320_000),
    ("higher", "192k", 192_000),
    ("standard", "128k", 128_000),
];
static RSA_MODULUS: LazyLock<BigUint> = LazyLock::new(|| {
    BigUint::parse_bytes(concat!("e0b509f6259df8642dbc35662901477df22677ec152b5ff68ace615bb7b725152b",
        "3ab17a876aea8a5aa76d2e417629ec4ee341f56135fccf695280104e0312ecbda92557c93870114af6c9d",
        "05c4f7f0c3685b7a46bee255932575cce10b424d813cfe4875d3e82047b97ddef52741d546b8e289dc6935b",
        "3ece0462db0a22b8e7").as_bytes(), 16).expect("NetEase public key")
});

fn encrypt(body: &[u8], key: &[u8; 16]) -> String {
    let encrypted = cbc::Encryptor::<aes::Aes128>::new(key.into(), WE_IV.into())
        .encrypt_padded_vec_mut::<Pkcs7>(body);
    STANDARD.encode(encrypted)
}

fn we_form(data: &Value, key: &[u8; 16]) -> [(&'static str, String); 2] {
    let encrypted = encrypt(data.to_string().as_bytes(), WE_KEY);
    let mut reversed = *key;
    reversed.reverse();
    let cipher = BigUint::from_bytes_be(&reversed).modpow(&BigUint::from(65537u32), &RSA_MODULUS);
    [
        ("params", encrypt(encrypted.as_bytes(), key)),
        ("encSecKey", format!("{cipher:0>256x}")),
    ]
}

pub fn headers(request: reqwest::RequestBuilder, account: &Account) -> reqwest::RequestBuilder {
    let request = request
        .header(REFERER, format!("{BASE}/"))
        .header(ORIGIN, BASE)
        .header(ACCEPT, "*/*");
    let cookie = account.cookie.trim_matches(['"', '\'']);
    if cookie.len() >= 60 && cookie.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        request.header(COOKIE, format!("MUSIC_U={cookie}"))
    } else if !cookie.is_empty() {
        request.header(COOKIE, cookie)
    } else {
        request
    }
}

pub async fn weapi(
    client: &reqwest::Client,
    path: &str,
    account: &Account,
    data: Value,
) -> Result<Value> {
    super::request_json(we_request(client, path, account, data)).await
}

pub fn we_request(
    client: &reqwest::Client,
    path: &str,
    account: &Account,
    mut data: Value,
) -> reqwest::RequestBuilder {
    if let Some(object) = data.as_object_mut() {
        object
            .entry("csrf_token")
            .or_insert_with(|| json!(account.field("__csrf").unwrap_or_default()));
    }
    let random = uuid::Uuid::new_v4().simple().to_string();
    let key: &[u8; 16] = random.as_bytes()[..16].try_into().expect("UUID length");
    headers(client.post(format!("{BASE}{path}")), account).form(&we_form(&data, key))
}

pub(crate) async fn web_get(
    client: &reqwest::Client,
    path: &str,
    query: &[(&str, String)],
    account: &Account,
) -> Result<Value> {
    Ok(headers(client.get(format!("{BASE}{path}")), account)
        .query(query)
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?)
}

pub fn song(raw: &Value) -> Value {
    let album = raw
        .get("al")
        .or_else(|| raw.get("album"))
        .unwrap_or(&Value::Null);
    let artist = raw
        .get("ar")
        .or_else(|| raw.get("artists"))
        .unwrap_or(&Value::Null);
    let artist_rows: Vec<_> = object_rows(artist)
        .filter_map(|row| {
            let name = row["name"].as_str()?.trim();
            (!name.is_empty()).then(|| json!({"id": text(&row["id"]), "name": name}))
        })
        .collect();
    let joined = artist_rows
        .iter()
        .filter_map(|row| row["name"].as_str())
        .collect::<Vec<_>>()
        .join(" / ");
    let image = text(&album["picUrl"]).replacen("http://", "https://", 1);
    let cover = if image.is_empty() {
        image
    } else {
        format!(
            "{}?param=480y480",
            image.split('?').next().unwrap_or_default()
        )
    };
    let fee = uint(&raw["fee"]);
    let duration = uint(
        raw.get("dt")
            .or_else(|| raw.get("duration"))
            .unwrap_or(&Value::Null),
    ) as f64
        / 1000.0;
    json!({
        "id": text(&raw["id"]), "type": "song", "name": text(&raw["name"]), "artist": joined,
        "artistId": artist_rows.first().map(|row| text(&row["id"])).unwrap_or_default(),
        "artists": artist_rows, "album": text(&album["name"]), "albumId": text(&album["id"]),
        "albumMid": "", "cover": cover, "duration": duration, "provider": "netease", "source": "netease",
        "fee": fee, "vipRequired": fee == 1, "paid": fee == 4,
    })
}

pub async fn search(
    client: &reqwest::Client,
    query: &str,
    limit: usize,
    offset: usize,
    account: &Account,
) -> Result<Value> {
    if query.trim().is_empty() {
        return Ok(super::search_result(
            Provider::Netease,
            vec![],
            limit,
            offset,
            Some(0),
        ));
    }
    let fields = [
        ("s", query.to_owned()),
        ("type", "1".into()),
        ("limit", limit.to_string()),
        ("offset", offset.to_string()),
    ];
    let preferred = headers(client.post(format!("{BASE}/api/cloudsearch/pc")), account)
        .form(&fields)
        .send()
        .await;
    let result = match preferred {
        Ok(response) if response.status().is_success() => response
            .json::<Value>()
            .await
            .ok()
            .filter(|data| code(&data["code"], 200)),
        _ => None,
    };
    let data = match result {
        Some(data) => data,
        None => web_get(client, "/api/search/get/", &fields, account).await?,
    };
    ensure!(code(&data["code"], 200), "网易云搜索暂不可用");
    let rows = object_rows(&data["result"]["songs"])
        .map(song)
        .filter(|row| row["id"] != "")
        .collect::<Vec<_>>();
    let count = data["result"].get("songCount").map(uint);
    Ok(super::search_result(
        Provider::Netease,
        rows,
        limit,
        offset,
        count,
    ))
}

pub(crate) async fn detail(
    client: &reqwest::Client,
    ids: &[u64],
    account: &Account,
) -> Result<Value> {
    let selection: Vec<_> = ids.iter().map(|id| json!({"id": id})).collect();
    match weapi(
        client,
        DETAIL,
        account,
        json!({"c": json!(selection).to_string(), "ids": json!(ids).to_string()}),
    )
    .await
    {
        Ok(value) if code(&value["code"], 200) => Ok(value),
        _ => {
            web_get(
                client,
                "/api/song/detail",
                &[("ids", json!(ids).to_string())],
                account,
            )
            .await
        }
    }
}

pub async fn music_video(
    client: &reqwest::Client,
    key: &str,
    resolution: u32,
    account: &Account,
) -> Result<String> {
    let result = detail(client, &[numeric_id(key)?], account).await?;
    let video = uint(&result["songs"][0]["mv"]);
    if video == 0 {
        return Ok(String::new());
    }
    let data = weapi(
        client,
        "/weapi/song/enhance/play/mv/url",
        account,
        json!({"id":video.to_string(),"r":resolution}),
    )
    .await?;
    Ok(text(&data["data"]["url"]))
}

pub async fn lyric(client: &reqwest::Client, key: &str, account: &Account) -> Result<Value> {
    let id = numeric_id(key)?;
    let data = web_get(
        client,
        "/api/song/lyric",
        &[
            ("id", id.to_string()),
            ("lv", "-1".into()),
            ("tv", "-1".into()),
            ("kv", "-1".into()),
            ("rv", "-1".into()),
        ],
        account,
    )
    .await?;
    ensure!(code(&data["code"], 200), "网易云歌词暂不可用");
    let text_at = |key: &str| text(&data[key]["lyric"]);
    let empty = data["nolyric"] == true || data["uncollected"] == true;
    ensure!(
        empty
            || ["lrc", "tlyric", "klyric", "romalrc"]
                .into_iter()
                .any(|key| data[key]["lyric"].is_string()),
        "网易云歌词响应不完整"
    );
    Ok(
        json!({"ok":true,"lyric":text_at("lrc"), "tlyric":text_at("tlyric"), "klyric":text_at("klyric"),
        "romalrc":text_at("romalrc"), "provider":"netease","source":"网易云音乐",
        "nolyric":data["nolyric"] == true, "uncollected":data["uncollected"] == true}),
    )
}

async fn quality(
    client: &reqwest::Client,
    id: u64,
    account: &Account,
    (key, label, br): (&str, &str, u64),
) -> Quality {
    let mut result = Quality::unavailable(key, label);
    if let Ok(data) = weapi(
        client,
        PLAY,
        account,
        json!({
            "ids": json!([id]).to_string(), "br":br, "level":key,
            "encodeType":if key == "lossless" { "flac" } else { "mp3" },
        }),
    )
    .await
    {
        if let Some(row) = data["data"].as_array().and_then(|rows| rows.first()) {
            let raw = row["url"].as_str().unwrap_or_default();
            let level = row["level"].as_str();
            let bitrate = uint(&row["br"]);
            let matches_quality =
                level.map_or(bitrate >= br || key == "standard", |level| level == key);
            if !raw.is_empty() && matches_quality {
                result.url = raw.split('?').next().unwrap_or_default().to_owned();
                result.available = !result.url.is_empty();
                result.source_available = result.available;
                result.downloadable = result.available && row["freeTrialInfo"].is_null();
                result.filesize = uint(&row["size"]);
                result.bitrate = bitrate / 1000;
                result.encode = text(
                    row.get("type")
                        .or_else(|| row.get("encodeType"))
                        .unwrap_or(&Value::Null),
                );
                if !row["freeTrialInfo"].is_null() {
                    result.kind = "试听".into();
                }
            }
        }
    }
    result
}

pub async fn resolve(
    client: &reqwest::Client,
    key: &str,
    requested: &str,
    playback: bool,
    fallback: bool,
    account: &Account,
) -> Result<ResolvedTrack> {
    let id = numeric_id(key)?;
    let ids = [id];
    let info = detail(client, &ids, account);
    let qualities = async {
        let mut results = Vec::new();
        let start = if !playback || requested == "auto" {
            Some(0)
        } else {
            QUALITY.iter().position(|entry| entry.0 == requested)
        };
        if let Some(start) = start {
            let until = if playback && requested != "auto" && !fallback {
                start + 1
            } else {
                QUALITY.len()
            };
            for option in &QUALITY[start..until] {
                let row = quality(client, id, account, *option).await;
                let ready = playback && row.available;
                results.push(row);
                if ready {
                    break;
                }
            }
        }
        results
    };
    let (details, qualities) = tokio::join!(info, qualities);
    let song = details
        .ok()
        .and_then(|data| data["songs"].as_array()?.first().map(song))
        .unwrap_or_else(|| json!({"id": key}));
    Ok(ResolvedTrack { song, qualities })
}

pub async fn account_info(
    client: &reqwest::Client,
    account: &Account,
) -> Result<(Option<bool>, Value)> {
    if !account.configured() {
        return Ok((None, json!({})));
    }
    let data = weapi(client, ACCOUNT, account, json!({})).await?;
    let profile = &data["profile"];
    let id = uint(&profile["userId"]).max(uint(&data["account"]["id"]));
    let valid = if code(&data["code"], 301)
        || (code(&data["code"], 200)
            && data.get("profile") == Some(&Value::Null)
            && data.get("account") == Some(&Value::Null))
    {
        Some(false)
    } else if code(&data["code"], 200) && id > 0 {
        Some(true)
    } else {
        None
    };
    let sanitized = if valid == Some(true) {
        json!({"id":id.to_string(), "name":text(&profile["nickname"]), "avatar":text(&profile["avatarUrl"])})
    } else {
        json!({})
    };
    Ok((valid, sanitized))
}

pub async fn playlists(client: &reqwest::Client, account: &Account) -> Result<Value> {
    if !account.configured() {
        return Ok(json!({"playlists": [], "total": 0, "hasMore": false, "nextOffset": 0}));
    }
    let (valid, profile) = account_info(client, account).await?;
    ensure!(valid == Some(true), "网易云账号需要重新登录");
    let uid = numeric_id(profile["id"].as_str().context("网易云账号未返回标识")?)?;
    let mut offset = 0usize;
    let mut all = Vec::new();
    let mut seen = HashSet::new();
    loop {
        let data = weapi(
            client,
            "/weapi/user/playlist",
            account,
            json!({
                "uid": uid, "limit": 500, "offset": offset, "includeVideo": true,
            }),
        )
        .await?;
        ensure!(code(&data["code"], 200), "网易云歌单目录暂不可用");
        let records = data["playlist"]
            .as_array()
            .context("网易云歌单目录不完整")?;
        let previous = all.len();
        for item in records {
            let id = text(&item["id"]);
            ensure!(!id.is_empty(), "网易云歌单缺少标识");
            if seen.insert(id) {
                all.push(item.clone());
            }
        }
        offset += records.len();
        let more = data["more"].as_bool().unwrap_or(records.len() >= 500);
        if !more {
            break;
        }
        ensure!(
            offset < 50_000 && all.len() > previous,
            "网易云歌单目录分页无进展"
        );
    }
    let first_created = all
        .iter()
        .find(|row| {
            row["subscribed"] != true
                && (uint(&row["creator"]["userId"]) == uid || row["creator"].is_null())
        })
        .map(|row| text(&row["id"]));
    let explicit = all
        .iter()
        .find(|row| row["subscribed"] != true && uint(&row["specialType"]) == 5)
        .map(|row| text(&row["id"]));
    let liked_id = explicit.or(first_created);
    let mut playlists: Vec<_> = all.iter().map(|row| {
        let id = text(&row["id"]);
        let liked = liked_id.as_deref() == Some(id.as_str());
        let owner_id = uint(&row["creator"]["userId"]);
        let subscribed = row["subscribed"] == true || (owner_id != 0 && owner_id != uid);
        json!({
            "id":id, "name": text(&row["name"]), "cover":text(&row["coverImgUrl"]),
            "trackCount":uint(&row["trackCount"]), "kind":if liked { "liked" } else if subscribed { "collected" } else { "created" },
            "provider":"netease","source":"netease","isLiked":liked,"subscribed":subscribed,
            "editable":!subscribed,"canAdd":!subscribed,"canRemove":!subscribed,
        })
    }).collect();
    playlists.sort_by_key(|row| row["isLiked"] != true);
    Ok(
        json!({"playlists": playlists, "total":playlists.len(),"hasMore":false,"nextOffset":playlists.len()}),
    )
}

pub async fn playlist_tracks(
    client: &reqwest::Client,
    id: &str,
    offset: usize,
    limit: usize,
    account: &Account,
) -> Result<Value> {
    let indexes = playlist_index(client, id, account).await?;
    let total = indexes.len();
    let ids = indexes
        .iter()
        .skip(offset)
        .take(limit)
        .copied()
        .collect::<Vec<_>>();
    let mut tracks = Vec::new();
    if !ids.is_empty() {
        let data = detail(client, &ids, account).await?;
        let entries: HashMap<_, _> = object_rows(&data["songs"])
            .map(|row| (uint(&row["id"]), row))
            .collect();
        tracks.extend(
            ids.iter()
                .filter_map(|id| entries.get(id).map(|row| song(row))),
        );
    }
    let next = offset.saturating_add(ids.len()).min(total);
    Ok(json!({"tracks":tracks, "total":total, "hasMore":next < total, "nextOffset":next}))
}

pub async fn playlist_index(
    client: &reqwest::Client,
    id: &str,
    account: &Account,
) -> Result<Vec<u64>> {
    let id = numeric_id(id)?;
    let response = weapi(
        client,
        "/weapi/v6/playlist/detail",
        account,
        json!({"id": id, "n": 100000, "s": 0}),
    )
    .await?;
    let source = &response["playlist"];
    ensure!(
        code(&response["code"], 200) && source.is_object(),
        "网易云歌单详情暂不可用"
    );
    let indexes = source
        .get("trackIds")
        .and_then(Value::as_array)
        .or_else(|| source["tracks"].as_array())
        .context("网易云未返回曲目索引")?;
    let total = indexes.len().max(uint(&source["trackCount"]) as usize);
    ensure!(indexes.len() == total, "网易云未返回完整曲目索引");
    let ids = indexes
        .iter()
        .map(|row| uint(&row["id"]))
        .collect::<Vec<_>>();
    ensure!(!ids.contains(&0), "网易云曲目索引无效");
    Ok(ids)
}

pub async fn write_playlist(
    client: &reqwest::Client,
    list: &str,
    key: &str,
    add: bool,
    account: &Account,
) -> Result<()> {
    let pid = numeric_id(list)?;
    let track = numeric_id(key)?;
    let reply = weapi(
        client,
        "/weapi/playlist/manipulate/tracks",
        account,
        json!({
            "pid":pid.to_string(),"op":if add { "add" } else { "del" },
            "trackIds":format!("[{track}]"),"imme":"true"
        }),
    )
    .await?;
    ensure!(
        reply["error"].is_null() && (reply["code"].is_null() || code(&reply["code"], 200)),
        "网易云未确认歌单修改"
    );
    Ok(())
}

pub async fn album(
    client: &reqwest::Client,
    key: &str,
    offset: usize,
    limit: usize,
    account: &Account,
) -> Result<Value> {
    let id = numeric_id(key)?;
    let value = web_get(client, &format!("/api/album/{id}"), &[], account).await?;
    ensure!(code(&value["code"], 200), "网易云专辑暂不可用");
    let album = &value["album"];
    let rows = value
        .get("songs")
        .or_else(|| album.get("songs"))
        .and_then(Value::as_array)
        .context("网易云专辑曲目不完整")?;
    let total = rows.len();
    let tracks = rows
        .iter()
        .skip(offset)
        .take(limit)
        .map(song)
        .collect::<Vec<_>>();
    Ok(json!({"ok":true,"provider":"netease","album":{
        "id":id.to_string(),"name":text(&album["name"]),"cover":text(&album["picUrl"]),
        "artist":text(&album["artist"]["name"]),"description":text(&album["description"]),"trackCount":total,
        "publishTime":uint(&album["publishTime"]),
        "publish_time":album["publishTime"].as_i64().and_then(|millis|
            time::OffsetDateTime::from_unix_timestamp(millis/1000).ok()).map(|date|date.date().to_string()).unwrap_or_default(),
    },"songs":tracks,"total":total,"hasMore":offset.saturating_add(tracks.len()) < total,
    "nextOffset":offset.saturating_add(tracks.len()).min(total)}))
}

pub async fn artist(
    client: &reqwest::Client,
    key: &str,
    offset: usize,
    limit: usize,
    account: &Account,
) -> Result<Value> {
    let id = numeric_id(key)?;
    let data = web_get(client, &format!("/api/artist/{id}"), &[], account).await?;
    ensure!(code(&data["code"], 200), "网易云歌手暂不可用");
    let artist = &data["artist"];
    let tracks = object_rows(&data["hotSongs"])
        .skip(offset)
        .take(limit)
        .map(song)
        .collect::<Vec<_>>();
    let total = data["hotSongs"].as_array().map_or(0, Vec::len);
    let next = offset.saturating_add(tracks.len()).min(total);
    Ok(
        json!({"ok":true,"provider":"netease","artist":{"id":id.to_string(),"name":text(&artist["name"]),
        "avatar":text(&artist["picUrl"]),"description":text(&artist["briefDesc"])},
        "songs":tracks,"total":total,"hasMore":next < total,"nextOffset":next}),
    )
}
