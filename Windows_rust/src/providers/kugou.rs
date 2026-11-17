use super::{
    Quality, ResolvedTrack, code, first_text, lrc_line, object_rows, request_json, search_result,
    text, uint,
};
use crate::accounts::{Account, Provider};
use crate::media::parse_platform_media;
use anyhow::{Context, Result, ensure};
use base64::{Engine, engine::general_purpose::STANDARD};
use flate2::read::ZlibDecoder;
use md5::{Digest, Md5};
use reqwest::header::{COOKIE, REFERER};
use serde_json::{Value, json};
use std::collections::{BTreeMap, HashMap};
use std::io::Read;
use std::time::{SystemTime, UNIX_EPOCH};

pub mod catalogue;
pub mod comments;
pub mod library;

const SALT: &str = "NVPh5oo715z5DIWAeQlhMDsWXXQV4hwt";
fn hex_md5(data: impl AsRef<[u8]>) -> String {
    hex::encode(Md5::digest(data))
}
const LADDER: [(&str, &str, u64); 4] = [
    ("sq", "SQ（无损）", 0),
    ("320", "320k", 320),
    ("high", "高品", 192),
    ("128", "128k", 128),
];

fn signed(query: BTreeMap<&str, String>) -> BTreeMap<&str, String> {
    sign_body(query, b"")
}

fn sign_body<'a>(mut query: BTreeMap<&'a str, String>, body: &[u8]) -> BTreeMap<&'a str, String> {
    let mut hash = Md5::new();
    hash.update(SALT);
    for (key, value) in &query {
        hash.update(key);
        hash.update(b"=");
        hash.update(value);
    }
    hash.update(body);
    hash.update(SALT);
    query.insert("signature", hex::encode(hash.finalize()));
    query
}

pub(crate) fn get(
    client: &reqwest::Client,
    url: &str,
    account: &Account,
) -> reqwest::RequestBuilder {
    let request = client.get(url).header(REFERER, "https://www.kugou.com/");
    if account.cookie.is_empty() {
        request
    } else {
        request.header(COOKIE, &account.cookie)
    }
}

fn valid_hash(value: &str) -> bool {
    value.len() == 32 && value.bytes().all(|character| character.is_ascii_hexdigit())
}

pub async fn music_video(
    client: &reqwest::Client,
    key: &str,
    resolution: u32,
    account: &Account,
) -> Result<String> {
    let data = if valid_hash(key) {
        request_json(
            get(
                client,
                "https://mobiles.kugou.com/api/v3/song/info",
                account,
            )
            .query(&[("hash", key)]),
        )
        .await?
    } else {
        signed_song_info(client, key, "", account).await?
    };
    let hash = first_text(&[
        &data["data"]["mvhash"],
        &data["data"]["mv_hash"],
        &data["mvhash"],
        &data["mv_hash"],
    ]);
    if !valid_hash(&hash) {
        return Ok(String::new());
    }
    let result = request_json(
        get(client, "https://m.kugou.com/app/i/mv.php", account).query(&[
            ("cmd", "100"),
            ("hash", &hash),
            ("ismp3", "0"),
            ("ext", "mp4"),
        ]),
    )
    .await?;
    let native = result.get("mvdata").unwrap_or(&result["data"]["mvdata"]);
    let preferred = if resolution >= 720 {
        ["hd", "hq", "le", "sq", "rq"]
    } else {
        ["hq", "le", "hd", "sq", "rq"]
    };
    Ok(preferred
        .into_iter()
        .filter_map(|tier| native[tier]["downurl"].as_str())
        .find(|url| crate::media::parse_platform_media(url).is_some())
        .unwrap_or_default()
        .to_owned())
}

fn https(value: String) -> String {
    if let Some(suffix) = value.strip_prefix("http://") {
        format!("https://{suffix}")
    } else {
        value
    }
}

fn song(row: &Value) -> Value {
    let hash = text(&row["FileHash"]);
    let image = https(first_text(&[
        &row["Image"],
        &row["AlbumImage"],
        &row["trans_param"]["union_cover"],
    ]));
    let artists: Vec<_> = object_rows(row.get("Singers").unwrap_or(&row["singerinfo"]))
        .filter_map(|singer| {
            let name = first_text(&[&singer["name"], &singer["Name"], &singer["SingerName"]]);
            (!name.is_empty()).then(|| json!({"id":first_text(&[&singer["id"],&singer["ID"],&singer["SingerId"]]),"name":name}))
        }).collect();
    json!({"id":hash,"hash":hash,"audioHash":hash,"name":row["SongName"],"artist":row["SingerName"],
        "artists":artists,"artistId":artists.first().map(|artist| &artist["id"]),"album":row["AlbumName"],
        "albumId":text(&row["AlbumID"]),"albumAudioId":first_text(&[&row["MixSongID"],&row["AlbumAudioID"]]),
        "hqHash":text(&row["HQFileHash"]),"sqHash":text(&row["SQFileHash"]),
        "cover":image.replace("{size}","480"),"cover_hd":image.replace("{size}","1080"),
        "duration":uint(&row["Duration"]),"provider":"kugou","source":"kugou","type":"song","privilege":row["Privilege"]})
}

pub async fn search(
    client: &reqwest::Client,
    keyword: &str,
    limit: usize,
    offset: usize,
    account: &Account,
) -> Result<Value> {
    if keyword.trim().is_empty() {
        return Ok(search_result(
            Provider::Kugou,
            vec![],
            limit,
            offset,
            Some(0),
        ));
    }
    let query = signed(BTreeMap::from([
        ("srcappid", "2919".into()),
        ("clientver", "1000".into()),
        ("clienttime", "1".into()),
        ("mid", "1".into()),
        ("dfid", "-".into()),
        ("keyword", keyword.into()),
        ("page", (offset / limit + 1).to_string()),
        ("pagesize", limit.to_string()),
        ("appid", "1014".into()),
        ("platform", "WebFilter".into()),
    ]));
    let body = request_json(
        get(
            client,
            "https://complexsearch.kugou.com/v2/search/song",
            account,
        )
        .query(&query),
    )
    .await?;
    ensure!(
        code(&body["error_code"], 0) || code(&body["status"], 1),
        "酷狗搜索请求失败"
    );
    let songs = object_rows(&body["data"]["lists"])
        .filter(|row| valid_hash(row["FileHash"].as_str().unwrap_or_default()))
        .map(song)
        .collect();
    let total = body["data"]
        .get("total")
        .filter(|row| !row.is_null())
        .map(uint);
    Ok(search_result(Provider::Kugou, songs, limit, offset, total))
}

fn unquote(value: &str) -> &str {
    value.trim().trim_matches(['"', '\''])
}

pub(crate) fn login_fields(account: &Account) -> (String, String) {
    let first = |names: &[&str]| {
        names
            .iter()
            .find_map(|name| account.field(name))
            .map(unquote)
            .unwrap_or_default()
    };
    let token_names = ["t", "Token", "token", "T"];
    let user_names = ["KugooID", "UserId", "userid", "uin", "kugouID", "uid"];
    let mut token = first(&token_names).to_owned();
    let mut user = first(&user_names).to_owned();
    if !token.is_empty() && !user.is_empty() {
        return (token, user);
    }
    let mut nested = first(&["KuGoo", "kugou"]).to_owned();
    for _ in 0..3 {
        let fields: HashMap<_, _> = url::form_urlencoded::parse(nested.as_bytes())
            .into_owned()
            .collect();
        if token.is_empty() {
            token = token_names
                .iter()
                .find_map(|name| fields.get(*name))
                .map(|value| unquote(value).to_owned())
                .unwrap_or_default();
        }
        if user.is_empty() {
            user = user_names
                .iter()
                .find_map(|name| fields.get(*name))
                .map(|value| unquote(value).to_owned())
                .unwrap_or_default();
        }
        if fields
            .keys()
            .any(|key| token_names.contains(&key.as_str()) || user_names.contains(&key.as_str()))
        {
            break;
        }
        let decoded = url::form_urlencoded::parse(nested.as_bytes()).next();
        let Some((value, _)) = decoded else { break };
        if value == nested {
            break;
        }
        nested = unquote(&value).to_owned();
    }
    (token, user)
}

async fn signed_song_info(
    client: &reqwest::Client,
    hash: &str,
    album_id: &str,
    account: &Account,
) -> Result<Value> {
    let (token, user) = login_fields(account);
    ensure!(!token.is_empty() && !user.is_empty(), "酷狗账号尚未登录");
    let mid = ["kg_mid", "KG_MID", "mid"]
        .into_iter()
        .find_map(|key| account.field(key))
        .unwrap_or_default();
    let dfid = ["kg_dfid", "KG_DFID", "dfid"]
        .into_iter()
        .find_map(|key| account.field(key))
        .unwrap_or("-");
    let mut query = BTreeMap::from([
        ("srcappid", "2919".into()),
        ("clientver", "20000".into()),
        (
            "clienttime",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)?
                .as_millis()
                .to_string(),
        ),
        ("mid", mid.into()),
        ("uuid", mid.into()),
        ("dfid", dfid.into()),
        ("appid", "1014".into()),
        ("platid", "4".into()),
        ("token", token),
        ("userid", user),
        ("hash", hash.into()),
    ]);
    if !album_id.is_empty() {
        query.insert("album_id", album_id.into());
    }
    let response = request_json(
        get(client, "https://wwwapi.kugou.com/play/songinfo", account).query(&signed(query)),
    )
    .await?;
    let data = &response["data"];
    ensure!(
        data.is_object() && text(&data["hash"]).eq_ignore_ascii_case(hash),
        "酷狗播放资源不匹配"
    );
    Ok(data.clone())
}

async fn public_stream(client: &reqwest::Client, hash: &str) -> Result<(String, String)> {
    let key = hex::encode(Md5::digest(format!("{hash}kgcloudv2")));
    let body = request_json(client.get("https://trackercdn.kugou.com/i/v2/").query(&[
        ("key", key.as_str()),
        ("hash", hash),
        ("appid", "1014"),
        ("pid", "2"),
        ("cmd", "25"),
        ("behavior", "play"),
    ]))
    .await?;
    let link = https(text(&body["url"][0]));
    ensure!(parse_platform_media(&link).is_some(), "酷狗未提供该音质");
    Ok((link, text(&body["extName"])))
}

async fn resolve_quality(
    client: &reqwest::Client,
    mut quality: Quality,
    hash: &str,
    album_id: &str,
    account: &Account,
) -> Quality {
    if let Ok(data) = signed_song_info(client, hash, album_id, account).await {
        quality.url = https(text(&data["play_url"]));
        quality.filesize = uint(&data["filesize"]).max(quality.filesize);
        quality.bitrate = uint(&data["bitrate"]).max(quality.bitrate);
    }
    if quality.url.is_empty() {
        if let Ok((url, extension)) = public_stream(client, hash).await {
            quality.url = url;
            quality.encode = extension;
        }
    }
    quality.available = parse_platform_media(&quality.url).is_some();
    if !quality.available {
        quality.url.clear();
        return quality;
    }
    let trial = quality.url.contains("/yp/p_");
    quality.kind = if trial { "试听" } else { "完整版" }.into();
    quality.downloadable = !trial;
    if quality.encode.is_empty() {
        quality.encode = if quality.key == "sq" { "flac" } else { "mp3" }.into();
    }
    quality
}

pub async fn resolve(
    client: &reqwest::Client,
    hash: &str,
    album_id: &str,
    wanted: &str,
    playback: bool,
    fallback: bool,
    account: &Account,
) -> Result<ResolvedTrack> {
    ensure!(valid_hash(hash), "酷狗歌曲标识无效");
    let response = request_json(
        get(
            client,
            "https://mobiles.kugou.com/api/v3/song/info",
            account,
        )
        .query(&[("hash", hash)]),
    )
    .await?;
    let data = &response["data"];
    let extra = &data["extra"];
    let album_id = if album_id.is_empty() {
        text(&data["album_id"])
    } else {
        album_id.to_owned()
    };
    let filename = text(&data["filename"]);
    let (artist, title) = filename.split_once(" - ").unwrap_or_default();
    let title = data["songname"]
        .as_str()
        .filter(|name| !name.is_empty())
        .unwrap_or(title);
    let artist = data["singername"]
        .as_str()
        .filter(|name| !name.is_empty())
        .unwrap_or(artist);
    let cover = https(first_text(&[
        &data["img"],
        &data["album_img"],
        &data["trans_param"]["union_cover"],
    ]));
    let song = json!({"id":hash,"hash":hash,"name":title,"artist":artist,"album":data["album_name"],
        "albumId":album_id,"duration":uint(&data["duration"]),"cover":cover.replace("{size}","480")});
    let requested = LADDER.iter().position(|(key, _, _)| *key == wanted);
    let mut qualities = Vec::new();
    for (index, (key, label, bit_rate)) in LADDER.into_iter().enumerate() {
        let mut row = Quality::unavailable(key, label);
        let mut variant = text(&extra[format!("{key}hash")]);
        if !valid_hash(&variant) && key == "128" {
            variant = hash.to_owned();
        }
        row.source_available = valid_hash(&variant);
        row.bitrate = bit_rate;
        row.filesize = uint(&extra[format!("{key}filesize")]);
        let should_probe = !playback
            || wanted == "auto"
            || requested.is_some_and(|selected| index == selected || fallback && index > selected);
        if row.source_available && should_probe {
            row = resolve_quality(client, row, &variant, &album_id, account).await;
        }
        let found = row.available;
        qualities.push(row);
        if playback && found {
            break;
        }
    }
    Ok(ResolvedTrack { song, qualities })
}

async fn lyric_content(
    client: &reqwest::Client,
    candidate: &Value,
    format: &str,
    account: &Account,
) -> Result<Vec<u8>> {
    let id = text(&candidate["id"]);
    let key = text(&candidate["accesskey"]);
    let data = request_json(
        get(client, "https://lyrics.kugou.com/download", account).query(&[
            ("ver", "1"),
            ("client", "pc"),
            ("id", id.as_str()),
            ("accesskey", key.as_str()),
            ("fmt", format),
            ("charset", "utf8"),
        ]),
    )
    .await?;
    Ok(STANDARD.decode(text(&data["content"]))?)
}

fn decode_krc(data: &[u8]) -> String {
    const KEY: [u8; 16] = [
        64, 71, 97, 119, 94, 50, 116, 71, 81, 54, 49, 45, 206, 210, 110, 105,
    ];
    let Some(data) = data.strip_prefix(b"krc1") else {
        return String::new();
    };
    let payload: Vec<_> = data
        .iter()
        .zip(KEY.iter().cycle())
        .map(|(byte, key)| byte ^ key)
        .collect();
    let mut result = String::new();
    if ZlibDecoder::new(payload.as_slice())
        .take(1024 * 1024)
        .read_to_string(&mut result)
        .is_err()
    {
        return String::new();
    }
    result
}

fn separate_lyrics(krc: &str) -> (String, String) {
    let language = krc
        .lines()
        .find_map(|line| line.trim().strip_prefix("[language:")?.strip_suffix(']'));
    let Some(language) = language else {
        return Default::default();
    };
    let Ok(data) = STANDARD.decode(language) else {
        return Default::default();
    };
    let Ok(doc) = serde_json::from_slice::<Value>(&data) else {
        return Default::default();
    };
    let times: Vec<_> = krc
        .lines()
        .filter_map(|line| {
            line.strip_prefix('[')?
                .split_once(',')?
                .0
                .parse::<u64>()
                .ok()
        })
        .collect();
    let track = |kind: u64| {
        object_rows(&doc["content"])
            .find(|row| code(&row["type"], kind))
            .and_then(|row| row["lyricContent"].as_array())
            .into_iter()
            .flatten()
            .zip(&times)
            .filter_map(|(row, time)| {
                let content: String = row.as_array()?.iter().filter_map(Value::as_str).collect();
                (!content.trim().is_empty()).then(|| lrc_line(*time, &content))
            })
            .collect::<Vec<_>>()
            .join("\n")
    };
    (track(1), track(0))
}

pub async fn lyric(
    client: &reqwest::Client,
    hash: &str,
    duration: &str,
    keyword: &str,
    account: &Account,
) -> Result<Value> {
    ensure!(valid_hash(hash), "酷狗歌曲标识无效");
    let response = request_json(
        get(client, "https://krcs.kugou.com/search", account).query(&[
            ("ver", "1"),
            ("man", "yes"),
            ("client", "mobi"),
            ("keyword", keyword),
            ("duration", duration),
            ("hash", hash),
        ]),
    )
    .await?;
    let mut candidates: Vec<_> = object_rows(&response["candidates"]).collect();
    candidates.sort_by_key(|row| {
        let official = code(&row["krctype"], 1)
            || row["product_from"]
                .as_str()
                .is_some_and(|value| value.contains("官方"));
        (!official, std::cmp::Reverse(uint(&row["score"])))
    });
    let Some(first) = candidates.first().copied() else {
        return Ok(json!({"provider":"kugou","lyric":"","tlyric":"","romalrc":"","klyric":""}));
    };
    let (lrc, encoded) = tokio::join!(
        async {
            for candidate in candidates.into_iter().take(3) {
                if let Ok(raw) = lyric_content(client, candidate, "lrc", account).await {
                    if !raw.is_empty() {
                        return String::from_utf8_lossy(&raw).into_owned();
                    }
                }
            }
            String::new()
        },
        lyric_content(client, first, "krc", account),
    );
    let krc = decode_krc(&encoded.unwrap_or_default());
    let (translation, romanized) = separate_lyrics(&krc);
    Ok(
        json!({"provider":"kugou","lyric":lrc,"tlyric":translation,"romalrc":romanized,
        "klyric":krc,"title":text(&first["song"]),"artist":text(&first["singer"])}),
    )
}

pub fn account_info(account: &Account) -> Result<(Option<bool>, Value)> {
    let (token, user) = login_fields(account);
    if !account.configured() {
        return Ok((Some(false), json!({})));
    }
    ensure!(
        user.bytes().all(|byte| byte.is_ascii_digit()),
        "酷狗账号格式无效"
    );
    let user = (!user.is_empty())
        .then_some(user)
        .context("酷狗 Cookie 缺少账号编号")?;
    Ok((
        token.is_empty().then_some(false),
        json!({"id":user,"userId":user}),
    ))
}
