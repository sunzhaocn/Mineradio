use super::{
    Quality, ResolvedTrack, code, first_text, numeric_id, object_rows, request_json, search_result,
    text, uint,
};
use crate::accounts::{Account, Provider};
use anyhow::{Context, Result, ensure};
use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use reqwest::header::{COOKIE, REFERER};
use serde_json::{Value, json};
use std::collections::HashSet;
use std::sync::LazyLock;
use std::time::Duration;
use tokio::sync::Mutex;
use tokio::time::Instant;

pub mod catalogue;
mod mobile;

pub use mobile::WriteRequiresLogin;

const LADDER: [(&str, &str, &str, &str, &str, u64); 4] = [
    ("flac", "SQ(无损)", "F000", "flac", "size_flac", 0),
    ("320", "320k", "M800", "mp3", "size_320mp3", 320),
    ("128", "128k", "M500", "mp3", "size_128mp3", 128),
    ("aac", "96k AAC", "C400", "m4a", "size_96aac", 96),
];
static LAST_SEARCH: LazyLock<Mutex<Instant>> = LazyLock::new(|| Mutex::new(Instant::now()));

pub(crate) fn identity(account: &Account) -> &str {
    ["uin", "qqmusic_uin", "p_uin", "wxuin"]
        .into_iter()
        .find_map(|name| account.field(name))
        .unwrap_or("0")
        .trim_matches(['"', '\''])
        .trim_start_matches('o')
}

fn token(account: &Account) -> u32 {
    let key = [
        "qqmusic_key",
        "qm_keyst",
        "qqmusic_key2",
        "wxmusickey",
        "p_skey",
        "skey",
    ]
    .into_iter()
    .find_map(|name| account.field(name))
    .unwrap_or_default();
    key.chars().fold(5381u32, |hash, letter| {
        hash.wrapping_mul(33).wrapping_add(letter as u32)
    }) & 0x7fff_ffff
}

fn headers(
    request: reqwest::RequestBuilder,
    account: &Account,
    referer: &str,
) -> reqwest::RequestBuilder {
    let request = request.header(REFERER, referer);
    if account.cookie.is_empty() {
        request
    } else {
        request.header(COOKIE, &account.cookie)
    }
}

pub(crate) async fn rpc(
    client: &reqwest::Client,
    data: &Value,
    account: &Account,
    timeout: u64,
) -> Result<Value> {
    let query = [
        ("format", "json".to_owned()),
        ("data", data.to_string()),
        ("g_tk", token(account).to_string()),
    ];
    let result = headers(
        client.get("https://u.y.qq.com/cgi-bin/musicu.fcg"),
        account,
        "https://y.qq.com/",
    )
    .query(&query)
    .timeout(Duration::from_secs(timeout))
    .send()
    .await?;
    Ok(result.error_for_status()?.json().await?)
}

fn mid(value: &str) -> Result<&str> {
    ensure!(
        (10..=14).contains(&value.len()) && value.bytes().all(|byte| byte.is_ascii_alphanumeric()),
        "QQ 歌曲标识无效"
    );
    Ok(value)
}

pub fn song(row: &Value) -> Value {
    let raw = row
        .get("musicData")
        .or_else(|| row.get("track_info"))
        .or_else(|| row.get("songInfo"))
        .or_else(|| row.get("songinfo"))
        .or_else(|| row.get("song"))
        .unwrap_or(row);
    let album = &raw["album"];
    let singers: Vec<_> = object_rows(&raw["singer"])
        .filter_map(|row| {
            let name = row["name"].as_str()?;
            (!name.is_empty())
                .then(|| json!({"id":text(&row["id"]),"mid":text(&row["mid"]),"name":name}))
        })
        .collect();
    let artists = singers
        .iter()
        .filter_map(|row| row["name"].as_str())
        .collect::<Vec<_>>()
        .join(" / ");
    let album_mid = first_text(&[&album["mid"], &raw["albummid"]]);
    let cover = if !album_mid.is_empty() {
        format!("https://y.gtimg.cn/music/photo_new/T002R500x500M000{album_mid}.jpg")
    } else {
        String::new()
    };
    let identity = first_text(&[&raw["mid"], &raw["songmid"]]);
    let artist = if artists.is_empty() {
        text(&raw["singername"])
    } else {
        artists
    };
    let media_mid = first_text(&[
        &raw["file"]["media_mid"],
        &raw["strMediaMid"],
        &raw["media_mid"],
    ]);
    json!({"id":identity,"mid":identity,"qqId":first_text(&[&raw["id"],&raw["songid"]]),
        "name":first_text(&[&raw["name"],&raw["songname"]]),"artist":artist,
        "artists":singers,"artistMid":singers.first().map(|row| text(&row["mid"])).unwrap_or_default(),
        "album":first_text(&[&album["name"],&album["title"],&raw["albumname"]]),
        "albumId":first_text(&[&album["id"],&raw["albumid"]]),"albumMid":album_mid,
        "mediaMid":media_mid,"cover":cover,"duration":uint(&raw["interval"]),
        "songType":uint(raw.get("type").unwrap_or(&raw["songtype"])),"provider":"qq","source":"qq","type":"song"})
}

pub async fn playlist_tracks(
    client: &reqwest::Client,
    name: &str,
    offset: usize,
    limit: usize,
    account: &Account,
) -> Result<Value> {
    let response = playlist_data(client, name, offset, limit, account).await?;
    let mut page = playlist_page(&response, offset)?;
    page["provider"] = json!("qq");
    Ok(page)
}

async fn playlist_data(
    client: &reqwest::Client,
    name: &str,
    offset: usize,
    limit: usize,
    account: &Account,
) -> Result<Value> {
    let liked = matches!(name, "qq-liked" | "qq-likes" | "201");
    let playlist_id = if liked { 0 } else { numeric_id(name)? };
    ensure!(!account.cookie.is_empty() || !liked, "请先登录 QQ 音乐");
    rpc(
        client,
        &json!({"comm":{"ct":24,"cv":0},"req_0":{
            "module":"music.srfDissInfo.DissInfo","method":"CgiGetDiss","param":{
                "disstid":playlist_id,"dirid":if liked {201} else {0}, "tag":1,"song_begin":offset,
                "song_num":limit.min(100),"userinfo":1,"orderlist":1}
        }}),
        account,
        12,
    )
    .await
}

fn playlist_page(result: &Value, offset: usize) -> Result<Value> {
    let block = &result["req_0"];
    let data = &block["data"];
    ensure!(
        [
            &result["code"],
            &block["code"],
            &data["code"],
            &data["subcode"]
        ]
        .into_iter()
        .all(|field| field.is_null() || code(field, 0)),
        "QQ 音乐歌单暂不可读取"
    );
    let entries = data["songlist"]
        .as_array()
        .context("QQ 音乐歌单应答不完整")?;
    let span = entries.len().max(uint(&data["songlist_size"]) as usize);
    let total = data
        .get("total_song_num")
        .filter(|field| !field.is_null())
        .map_or(offset + span, |field| uint(field) as usize);
    let next = total.min(offset + span);
    let more = data["hasmore"] == true || code(&data["hasmore"], 1) || next < total;
    ensure!(!more || next > offset, "QQ 音乐歌单分页没有推进");
    let tracks = entries
        .iter()
        .map(song)
        .filter(|track| track["id"] != "")
        .collect::<Vec<_>>();
    Ok(json!({"ok":true,"tracks":tracks,"total":total,"hasMore":more,"nextOffset":next}))
}

async fn playlists_by_kind(
    client: &reqwest::Client,
    user_id: &str,
    created: bool,
    account: &Account,
) -> Result<Vec<Value>> {
    const LIMIT: usize = 200;
    let mut offset = 0;
    let mut seen = HashSet::new();
    let mut playlists = Vec::new();
    for _ in 0..100 {
        let response;
        let (data, list_field, total_field, more_field) = if created {
            response = request_json(
                headers(
                    client.get("https://c.y.qq.com/rsc/fcgi-bin/fcg_user_created_diss"),
                    account,
                    "https://y.qq.com/portal/profile.html",
                )
                .query(&[
                    ("hostUin", "0"),
                    ("hostuin", user_id),
                    ("loginUin", user_id),
                    ("size", &LIMIT.to_string()),
                    ("g_tk", "5381"),
                    ("sin", &offset.to_string()),
                    ("format", "json"),
                    ("inCharset", "utf8"),
                    ("outCharset", "utf-8"),
                    ("notice", "0"),
                    ("platform", "yqq.json"),
                    ("needNewCode", "0"),
                ]),
            )
            .await?;
            ensure!(code(&response["code"], 0), "QQ 音乐自建歌单暂不可读取");
            (&response["data"], "disslist", "totoal", "has_more")
        } else {
            // PlaylistFavRead takes the encrypted music UIN returned by CgiGetDiss.
            // See L-1124/QQMusicApi, qqmusic_api/modules/user.py (GPL-3.0-or-later).
            response = rpc(client, &json!({
                "comm":{"ct":24,"cv":0},
                "playlists":{"module":"music.musicasset.PlaylistFavRead","method":"CgiGetPlaylistFavInfo",
                    "param":{"uin":user_id,"offset":offset,"size":LIMIT}}
            }), account, 10).await?;
            ensure!(
                code(&response["code"], 0) && code(&response["playlists"]["code"], 0),
                "QQ 音乐收藏歌单暂不可读取"
            );
            (&response["playlists"]["data"], "v_list", "total", "hasmore")
        };
        let rows = data[list_field]
            .as_array()
            .context("QQ 音乐歌单目录应答不完整")?;
        let mut advanced = false;
        for row in rows {
            let id = first_text(&[&row["dissid"], &row["tid"], &row["diss_id"], &row["id"]]);
            if numeric_id(&id).is_err() || !seen.insert(id.clone()) {
                continue;
            }
            advanced = true;
            let dirid = first_text(&[&row["dirid"], &row["dir_id"], &row["dirId"]]);
            if dirid == "201" {
                continue;
            }
            let cover = first_text(&[
                &row["diss_cover"],
                &row["logo"],
                &row["picurl"],
                &row["cover"],
                &row["picUrl"],
            ]);
            let track_count = first_text(&[
                &row["song_cnt"],
                &row["songnum"],
                &row["total_song_num"],
                &row["song_count"],
                &row["songNum"],
            ]);
            playlists.push(json!({"id":id,"provider":"qq","source":"qq","kind":if created {"created"} else {"collected"},
                "name":first_text(&[&row["diss_name"],&row["dissname"],&row["name"],&row["title"],&row["dirName"]]),
                "cover":cover.replace("http://","https://"),"trackCount":track_count.parse::<u64>().unwrap_or(0),
                "dirid":dirid,"subscribed":!created,"editable":created,"canAdd":created,"canRemove":created}));
        }
        offset += rows.len();
        let total = uint(data.get(total_field).unwrap_or(&data["total"])) as usize;
        let more = &data[more_field];
        if (total > 0 && offset >= total)
            || (total == 0
                && (more == false || code(more, 0) || more.is_null() && rows.len() < LIMIT))
        {
            return Ok(playlists);
        }
        ensure!(advanced, "QQ 音乐歌单目录分页没有推进");
    }
    anyhow::bail!("QQ 音乐歌单目录尚未读取完整")
}

pub async fn playlists(client: &reqwest::Client, account: &Account) -> Result<Value> {
    ensure!(!account.cookie.is_empty(), "请先登录 QQ 音乐");
    let response = playlist_data(client, "qq-liked", 0, 1, account).await?;
    let liked = playlist_page(&response, 0)?;
    let owner = &response["req_0"]["data"]["dirinfo"];
    let user_id = text(&owner["host_uin"]);
    let user_id = if numeric_id(&user_id).is_ok() {
        user_id.as_str()
    } else {
        account
            .field("qqmusic_uin")
            .unwrap_or_else(|| identity(account))
            .trim_start_matches('o')
    };
    numeric_id(user_id)?;
    let encoded = owner["encrypt_uin"]
        .as_str()
        .filter(|value| !value.is_empty())
        .context("QQ 音乐未返回收藏歌单所需的账号标识")?;
    let (created, collected) = tokio::try_join!(
        playlists_by_kind(client, user_id, true, account),
        playlists_by_kind(client, encoded, false, account),
    )?;
    let cover = liked["tracks"][0]["cover"]
        .as_str()
        .filter(|cover| !cover.is_empty())
        .unwrap_or("https://y.gtimg.cn/mediastyle/global/img/cover_like.png");
    let mut rows = vec![
        json!({"id":"qq-liked","provider":"qq","source":"qq","name":"我的喜欢","isLiked":true,
        "kind":"liked","virtual":true,"cover":cover,"trackCount":liked["total"],"dirid":"201",
        "editable":true,"canAdd":true,"canRemove":true}),
    ];
    let mut seen = HashSet::new();
    rows.extend(
        created
            .into_iter()
            .chain(collected)
            .filter(|row| seen.insert(text(&row["id"]))),
    );
    Ok(
        json!({"ok":true,"provider":"qq","total":rows.len(),"nextOffset":rows.len(),"hasMore":false,"playlists":rows}),
    )
}

pub async fn write_playlist(
    client: &reqwest::Client,
    target: &Value,
    key: &str,
    add: bool,
    account: &Account,
) -> Result<()> {
    let directory = numeric_id(&text(&target["dirid"]))?;
    let playlist = if target["isLiked"] == true {
        0
    } else {
        numeric_id(&text(&target["id"]))?
    };
    let native = detail(client, key, account)
        .await
        .context("暂时无法读取 QQ 原生歌曲编号")?;
    ensure!(
        native["mid"] == key && uint(&native["id"]) > 0,
        "QQ 未确认歌曲原生编号"
    );
    mobile::write(
        client,
        json!({"dirId":directory,"tid":playlist,"bFmtUtf8":if add {json!(true)} else {json!(1)},
            "v_songInfo":[{"songId":uint(&native["id"]),"songType":uint(&native["type"])}]}),
        add,
        account,
    )
    .await
}

pub async fn search(
    client: &reqwest::Client,
    keyword: &str,
    limit: usize,
    offset: usize,
    account: &Account,
) -> Result<Value> {
    if keyword.trim().is_empty() {
        return Ok(search_result(Provider::Qq, vec![], limit, offset, Some(0)));
    }
    let request = json!({"method":"DoSearchForQQMusicDesktop","module":"music.search.SearchCgiService",
        "param":{"num_per_page":limit,"page_num":offset/limit+1,"query":keyword,"search_type":0}});
    let body = json!({"comm":{"ct":"19","cv":"1859","uin":identity(account)},"req":request});
    async fn throttle() {
        let mut last = LAST_SEARCH.lock().await;
        tokio::time::sleep_until(*last + Duration::from_millis(450)).await;
        *last = Instant::now();
    }
    throttle().await;
    let mut response = rpc(client, &body, account, 12).await?;
    let mut key = "req";
    if code(&response[key]["code"], 2001) {
        key = "music.search.SearchCgiService";
        throttle().await;
        response = rpc(client, &json!({(key): request}), account, 12).await?;
    }
    let data = &response[key]["data"];
    let rows = data
        .pointer("/body/song/list")
        .and_then(Value::as_array)
        .context("QQ 搜索响应不完整")?;
    let tracks = rows
        .iter()
        .map(song)
        .filter(|row| row["id"] != "")
        .collect();
    let total = data
        .pointer("/meta/sum")
        .or_else(|| data.pointer("/body/song/total"))
        .map(uint);
    Ok(search_result(Provider::Qq, tracks, limit, offset, total))
}

pub(crate) async fn detail(
    client: &reqwest::Client,
    key: &str,
    account: &Account,
) -> Result<Value> {
    let (method, params) = if key.bytes().all(|byte| byte.is_ascii_digit()) {
        ("get_song_detail", json!({"song_id":numeric_id(key)?}))
    } else {
        (
            "get_song_detail_yqq",
            json!({"song_type":0,"song_mid":mid(key)?}),
        )
    };
    let value = rpc(
        client,
        &json!({"songinfo":{"module":"music.pf_song_detail_svr","method":method,"param":params}}),
        account,
        7,
    )
    .await?;
    let track = &value["songinfo"]["data"]["track_info"];
    ensure!(track.is_object(), "QQ 音乐未返回歌曲详情");
    Ok(track.clone())
}

pub async fn music_video(
    client: &reqwest::Client,
    key: &str,
    resolution: u32,
    account: &Account,
) -> Result<String> {
    let track = detail(client, key, account).await?;
    let id = track["mv"]["vid"].as_str().unwrap_or_default();
    if id.is_empty() {
        return Ok(String::new());
    }
    let result = rpc(
        client,
        &json!({"comm":{"ct":24,"cv":4747474},
        "mv":{"module":"music.stream.MvUrlProxy","method":"GetMvUrls","param":{
        "vids":[id],"request_type":10003,"guid":uuid::Uuid::new_v4().simple().to_string(),
        "videoformat":1,"format":264,"dolby":0,"use_new_domain":1,"use_ipv6":0}}}),
        account,
        12,
    )
    .await?;
    let rows = &result["mv"]["data"][id]["mp4"];
    let preferred = if resolution >= 720 {
        [30, 20, 10]
    } else {
        [20, 10, 30]
    };
    let mut variants = object_rows(rows).collect::<Vec<_>>();
    variants.sort_by_key(|row| {
        preferred
            .iter()
            .position(|entry| code(&row["filetype"], *entry))
            .unwrap_or(preferred.len())
    });
    Ok(variants
        .into_iter()
        .flat_map(|row| {
            ["freeflow_url", "url"]
                .into_iter()
                .flat_map(|field| row[field].as_array().into_iter().flatten())
        })
        .filter_map(Value::as_str)
        .find(|entry| crate::media::parse_platform_media(entry).is_some())
        .unwrap_or_default()
        .to_owned())
}

fn decode_lyric(value: &Value) -> String {
    let text = value.as_str().unwrap_or_default().trim();
    if text.starts_with(['[', '{']) {
        return text.to_owned();
    }
    let mut encoded = text.to_owned();
    encoded.extend(std::iter::repeat_n('=', (4 - encoded.len() % 4) % 4));
    match STANDARD.decode(encoded) {
        Ok(bytes) => String::from_utf8_lossy(&bytes).into_owned(),
        Err(_) => text.to_owned(),
    }
}

pub async fn lyric(client: &reqwest::Client, raw: &str, account: &Account) -> Result<Value> {
    let resolved;
    let song_id = if raw.bytes().all(|byte| byte.is_ascii_digit()) {
        resolved = detail(client, raw, account).await?;
        mid(resolved["mid"].as_str().unwrap_or_default())?
    } else {
        mid(raw)?
    };
    let payload = json!({"lyric":{"module":"music.musichallSong.PlayLyricInfo","method":"GetPlayLyricInfo",
        "param":{"songMID":song_id,"songID":0,"songType":0,"trans":1,"roma":1}}});
    if let Ok(response) = rpc(client, &payload, account, 6).await {
        let node = &response["lyric"];
        let data = &node["data"];
        if code(&node["code"], 0) && data["lyric"].is_string() {
            let roma = decode_lyric(&data["roma"]);
            return Ok(
                json!({"ok":true,"provider":"qq","source":"QQ 音乐","lyric":decode_lyric(&data["lyric"]),
                "tlyric":decode_lyric(&data["trans"]),"klyric":decode_lyric(&data["qrc"]),
                "romalrc":if roma.starts_with('[') { roma } else { String::new() }}),
            );
        }
    }
    let value: Value = headers(
        client.get("https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg"),
        account,
        "https://y.qq.com/portal/player.html",
    )
    .query(&[
        ("songmid", song_id),
        ("g_tk", "5381"),
        ("format", "json"),
        ("nobase64", "1"),
        ("platform", "yqq.json"),
    ])
    .timeout(Duration::from_secs(7))
    .send()
    .await?
    .error_for_status()?
    .json()
    .await?;
    ensure!(
        code(&value["retcode"], 0) && value["lyric"].is_string(),
        "QQ 歌词暂不可用"
    );
    Ok(
        json!({"ok":true,"provider":"qq","source":"QQ 音乐","lyric":value["lyric"],"tlyric":decode_lyric(&value["trans"])}),
    )
}

pub async fn resolve(
    client: &reqwest::Client,
    raw: &str,
    requested: &str,
    playback: bool,
    fallback: bool,
    account: &Account,
) -> Result<ResolvedTrack> {
    let track = detail(client, raw, account).await?;
    let key = mid(track["mid"].as_str().unwrap_or_default())?;
    let media_id = track["file"]["media_mid"]
        .as_str()
        .and_then(|value| mid(value).ok())
        .unwrap_or(key);
    let from = if !playback || requested == "auto" {
        Some(0)
    } else {
        LADDER.iter().position(|row| row.0 == requested)
    };
    let Some(from) = from else {
        return Ok(ResolvedTrack {
            song: song(&track),
            qualities: Vec::new(),
        });
    };
    let until = if playback && requested != "auto" && !fallback {
        from + 1
    } else {
        LADDER.len()
    };
    let options = &LADDER[from..until];
    let mut qualities = Vec::new();
    let mut filenames = Vec::new();
    for (key, label, prefix, extension, size_key, bitrate) in options {
        let mut row = Quality::unavailable(key, label);
        let size = track["file"].get(size_key);
        row.source_available = size.is_none_or(|size| uint(size) > 0);
        row.filesize = size.map(uint).unwrap_or_default();
        row.bitrate = *bitrate;
        row.encode = (*extension).into();
        filenames.push(
            row.source_available
                .then(|| format!("{prefix}{media_id}.{extension}")),
        );
        qualities.push(row);
    }
    let requested_files: Vec<_> = filenames.iter().flatten().cloned().collect();
    if !requested_files.is_empty() {
        let uin = identity(account);
        let result = rpc(client, &json!({"req_1":{"module":"vkey.GetVkeyServer","method":"CgiGetVkey","param":{
            "filename":requested_files,"guid":"6666666666","songmid":vec![key;requested_files.len()],
            "songtype":vec![0;requested_files.len()],"uin":uin,"loginflag":1,"platform":"20"
        }},"comm":{"uin":uin.parse::<u64>().unwrap_or(0),"format":"json","ct":24,"cv":0}}), account, 8).await?;
        let data = &result["req_1"]["data"];
        let cdn = data["sip"]
            .as_array()
            .and_then(|servers| servers.iter().find_map(Value::as_str))
            .unwrap_or("http://aqqmusic.tc.qq.com/");
        for (quality, filename) in qualities.iter_mut().zip(filenames) {
            let Some(name) = filename else { continue };
            let matched = object_rows(&data["midurlinfo"])
                .find(|row| row["filename"].as_str() == Some(name.as_str()));
            let purl = matched
                .and_then(|row| row["purl"].as_str())
                .unwrap_or_default();
            if purl
                .split('?')
                .next()
                .and_then(|path| path.rsplit('/').next())
                == Some(name.as_str())
            {
                quality.url = format!("{cdn}{purl}");
                quality.available = true;
                quality.downloadable = true;
            }
        }
    }
    Ok(ResolvedTrack {
        song: song(&track),
        qualities,
    })
}

pub async fn account_info(
    client: &reqwest::Client,
    account: &Account,
) -> Result<(Option<bool>, Value)> {
    if !account.configured() {
        return Ok((None, json!({})));
    }
    let response = rpc(
        client,
        &json!({"comm":{"ct":24,"cv":0},"req_0":{
        "module":"music.srfDissInfo.DissInfo","method":"CgiGetDiss","param":{"disstid":0,
        "dirid":201,"tag":1,"song_begin":0,"song_num":1,"userinfo":1,"orderlist":1}}}),
        account,
        10,
    )
    .await?;
    let record = &response["req_0"];
    let data = &record["data"];
    let complete = data["songlist"].is_array()
        && data["dirinfo"].is_object()
        && !text(&data["total_song_num"]).is_empty();
    let valid = if code(&response["code"], 0)
        && code(&record["code"], 0)
        && (complete || uint(&data["login_uin"]) > 0)
    {
        Some(true)
    } else if text(&data["login_uin"]) == "0"
        && code(&record["code"], 10004)
        && text(&data["code"]) == "-100008"
    {
        Some(false)
    } else {
        None
    };
    let uid = identity(account);
    Ok((
        valid,
        if valid == Some(true) && uid != "0" {
            json!({"id":uid})
        } else {
            json!({})
        },
    ))
}
