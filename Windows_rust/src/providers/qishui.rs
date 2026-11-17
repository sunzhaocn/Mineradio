use super::{
    Quality, ResolvedTrack, code, first_text, lrc_line, object_rows, request_json, search_result,
    text, uint,
};
use crate::accounts::{Account, Provider};
use crate::media::parse_platform_media;
use crate::{protected_audio, tools};
use anyhow::{Context, Result, ensure};
use base64::{Engine, engine::general_purpose::STANDARD};
use md5::{Digest, Md5};
use regex::Regex;
use reqwest::header::{COOKIE, REFERER, USER_AGENT};
use serde_json::{Value, json};
use std::collections::{BTreeMap, HashSet};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::LazyLock;
use std::time::Duration;
use tokio::io::AsyncWriteExt;
use url::Url;

pub mod catalogue;
pub mod library;

const HOST: &str = "https://api.qishui.com";
const LADDER: [(&str, &str); 6] = [
    ("lossless", "无损"),
    ("hi_res", "Hi-Res"),
    ("spatial", "空间音频"),
    ("highest", "极高"),
    ("higher", "较高"),
    ("medium", "标准"),
];
const SIGNER: &str = include_str!("../../../music_app/providers/qishui/runtime/signer.cjs");
static LYRIC_LINE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^\[(\d+),\d+\](.*)$").unwrap());
static WORD_TAG: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"<\d+,\d+(?:,\d+)?>").unwrap());

fn id(raw: &str) -> bool {
    (1..=25).contains(&raw.len())
        && !raw.starts_with('0')
        && raw.bytes().all(|byte| byte.is_ascii_digit())
}

fn has_session(account: &Account) -> bool {
    !account.cookie.is_empty()
        && account
            .session_config
            .as_ref()
            .is_some_and(|session| id(&text(&session["query"]["device_id"])))
}

pub fn desktop_query(device: &str, install: &str) -> Value {
    json!({"aid":"386088","app_name":"luna_pc","region":"cn","geo_region":"cn","os_region":"cn","sim_region":"",
        "device_id":device,"iid":install,"version_name":"3.7.0","version_code":"30070000",
        "channel":"official","build_mode":"master","ac":"wifi","tz_name":"Asia/Shanghai",
        "device_platform":"windows","device_type":"Windows","os_version":"Windows 10","fp":device})
}

pub fn features(account: &Account) -> Value {
    json!({"session_configured":has_session(account),"sdk_available":sdk_directory().is_some(),
        "direct_playback":tools::ffmpeg().is_some(),"node_available":tools::resource("tools/node.exe")
            .or_else(|| tools::resource("build/tools/node.exe")).is_some()})
}

fn sdk_directory() -> Option<PathBuf> {
    let present =
        |path: &Path| path.join("bdms.node").is_file() && path.join("metasecml.dll").is_file();
    if let Some(path) = std::env::var_os("QISHUI_SDK_DIR")
        .map(PathBuf::from)
        .filter(|path| path.is_absolute() && present(path))
    {
        return Some(path);
    }
    if let Some(path) = tools::resource("sdk").filter(|path| present(path)) {
        return Some(path);
    }
    let base = PathBuf::from(std::env::var_os("LOCALAPPDATA")?).join("Programs/Soda Music");
    let mut versions: Vec<_> = std::fs::read_dir(base)
        .ok()?
        .filter_map(std::result::Result::ok)
        .collect();
    versions.sort_by_key(|entry| {
        entry
            .file_name()
            .to_string_lossy()
            .split(|letter: char| !letter.is_ascii_digit())
            .filter_map(|number| number.parse::<u32>().ok())
            .collect::<Vec<_>>()
    });
    versions
        .into_iter()
        .rev()
        .map(|entry| entry.path().join("resources/app.asar.unpacked"))
        .find(|path| present(path))
}

async fn signature(
    url: &Url,
    headers: &BTreeMap<String, String>,
    device: &str,
) -> Result<[(String, String); 2]> {
    let sdk = sdk_directory().context("汽水客户端签名组件未安装")?;
    let node = tools::resource("tools/node.exe")
        .or_else(|| tools::resource("build/tools/node.exe"))
        .unwrap_or_else(|| PathBuf::from("node"));
    let headers = headers
        .iter()
        .flat_map(|(key, value)| [key.as_str(), value.as_str()])
        .collect::<Vec<_>>()
        .join("\r\n");
    let input = serde_json::to_vec(
        &json!({"sdkDirectory":sdk,"deviceId":device,"url":url.as_str(),"headers":headers}),
    )?;
    let mut command = tools::hidden_command(&node);
    command
        .arg("-e")
        .arg(SIGNER)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    let response = tokio::time::timeout(Duration::from_secs(12), async {
        let mut child = command.spawn()?;
        let mut stdin = child.stdin.take().context("无法开启汽水签名输入")?;
        stdin.write_all(&input).await?;
        drop(stdin);
        Ok::<_, anyhow::Error>(child.wait_with_output().await?)
    })
    .await
    .context("汽水签名超时")??;
    ensure!(
        response.status.success() && response.stdout.len() < 64 * 1024,
        "汽水签名失败"
    );
    let output = std::str::from_utf8(&response.stdout)?
        .rsplit_once("QISHUI_SIGNATURE:")
        .and_then(|(_, last)| last.lines().next())
        .context("汽水签名响应无效")?;
    let record: Value = serde_json::from_str(output)?;
    let rows: Vec<_> = record["output"]
        .as_str()
        .context("汽水签名响应缺失")?
        .lines()
        .collect();
    let pair = |name: &str| -> Result<(String, String)> {
        let value = rows
            .chunks_exact(2)
            .find(|pair| pair[0].eq_ignore_ascii_case(name))
            .map(|pair| pair[1])
            .filter(|header| {
                !header.is_empty()
                    && header.len() < 4096
                    && header.is_ascii()
                    && !header.chars().any(char::is_control)
            })
            .context("汽水签名字段无效")?;
        Ok((name.to_owned(), value.to_owned()))
    };
    Ok([pair("X-Helios")?, pair("X-Medusa")?])
}

pub(crate) async fn signed_read(
    client: &reqwest::Client,
    route: &str,
    query: &[(&str, String)],
    body: Option<Value>,
    account: &Account,
) -> Result<Value> {
    ensure!(has_session(account), "汽水请求需要 Cookie 和设备 ID");
    let session = account.session_config.as_ref().expect("validated session");
    let device = text(&session["query"]["device_id"]);
    let mut parameters: BTreeMap<_, _> = session["query"]
        .as_object()
        .context("汽水会话参数无效")?
        .iter()
        .map(|(key, value)| {
            (
                key.as_str(),
                if value.is_boolean() {
                    value.to_string()
                } else {
                    text(value)
                },
            )
        })
        .collect();
    parameters.extend(query.iter().map(|(name, value)| (*name, value.clone())));
    let mut url = Url::parse(&format!("{HOST}/luna/pc/{route}"))?;
    url.query_pairs_mut().extend_pairs(parameters);
    let mut headers: BTreeMap<String, String> = session["headers"]
        .as_object()
        .into_iter()
        .flat_map(|fields| fields.iter())
        .map(|(key, value)| (key.clone(), text(value)))
        .collect();
    headers.insert("cookie".to_owned(), account.cookie.clone());
    let body = body.map(|value| serde_json::to_vec(&value)).transpose()?;
    if let Some(bytes) = &body {
        headers.insert(
            "content-type".to_owned(),
            "application/json; charset=UTF-8".into(),
        );
        headers.insert(
            "X-SS-STUB".to_owned(),
            hex::encode_upper(Md5::digest(bytes)),
        );
    }
    headers.extend(signature(&url, &headers, &device).await?);
    let mut request = match body {
        Some(bytes) => client.post(url).body(bytes),
        None => client.get(url),
    };
    for (name, value) in headers {
        request = request.header(name, value);
    }
    let result = request_json(request).await?;
    ensure!(result.is_object(), "汽水响应格式无效");
    Ok(result)
}

pub(crate) fn accepted(body: Value) -> Result<Value> {
    ensure!(
        body["status_code"].is_null() || code(&body["status_code"], 0),
        "汽水未接受本次请求"
    );
    Ok(body)
}

pub(crate) fn normalized_track(track: &Value) -> Option<Value> {
    let key = text(&track["id"]);
    let name = text(&track["name"]);
    if !id(&key) || name.is_empty() {
        return None;
    }
    let album = &track["album"];
    let image = &album["url_cover"];
    let uri = text(&image["uri"]);
    let image_root = text(&image["urls"][0]);
    let template = image["template_prefix"]
        .as_str()
        .filter(|name| !name.is_empty())
        .unwrap_or("tplv-b829550vbb");
    let cover = if !uri.is_empty() && !image_root.is_empty() {
        format!("{image_root}{uri}~{template}-crop-center:400:400.jpg")
    } else {
        String::new()
    };
    let artists: Vec<_> = object_rows(&track["artists"])
        .take(40)
        .filter_map(|row| {
            let name = first_text(&[&row["name"], &row["simple_display_name"]]);
            (!name.is_empty()).then(|| json!({"id":text(&row["id"]),"name":name}))
        })
        .collect();
    let artist = artists
        .iter()
        .filter_map(|row| row["name"].as_str())
        .collect::<Vec<_>>()
        .join(" / ");
    let duration = uint(&track["duration"]);
    let media_type = track["media_type"]
        .as_str()
        .filter(|value| *value == "ugc_clip")
        .unwrap_or("track");
    let labels = &track["label_info"];
    Some(
        json!({"id":key,"name":name,"artist":artist,"artists":artists,
        "artistId":artists.first().map(|artist| &artist["id"]),"album":text(&album["name"]),"albumId":text(&album["id"]),
        "duration":duration as f64 / 1000.0,"durationMs":duration,"cover":cover,"nativeMediaType":media_type,
        "provider":"qishui","source":"qishui","type":"song","onlyVipPlayable":labels["only_vip_playable"] == true,
        "vipRequired":labels["only_vip_playable"] == true}),
    )
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
            Provider::Qishui,
            vec![],
            limit,
            offset,
            Some(0),
        ));
    }
    let end = offset + limit;
    ensure!(end <= 100, "汽水搜索支持前 100 条");
    let mut cursor = "0".to_owned();
    let search_id = uuid::Uuid::new_v4().to_string();
    let (mut rows, mut seen, mut more) = (Vec::new(), HashSet::new(), false);
    for _ in 0..5 {
        let request = [
            ("q", keyword.into()),
            ("cursor", cursor.clone()),
            ("search_id", search_id.clone()),
            ("search_method", "input".into()),
            ("debug_params", String::new()),
            ("from_search_id", String::new()),
            ("search_scene", String::new()),
        ];
        let response =
            accepted(signed_read(client, "search/track", &request, None, account).await?)?;
        ensure!(
            !matches!(uint(&response["extra"]["empty_search"]), 1 | 2),
            "汽水暂时未接受该搜索"
        );
        let Some(group) = object_rows(&response["result_groups"]).find(|row| row["id"] == "tracks")
        else {
            break;
        };
        for row in object_rows(&group["data"]) {
            let entity = &row["entity"];
            let raw = entity
                .get("track")
                .unwrap_or(&entity["track_wrapper"]["track"]);
            if let Some(track) =
                normalized_track(raw).filter(|track| seen.insert(text(&track["id"])))
            {
                rows.push(track);
            }
        }
        more = group["has_more"] == true || code(&group["has_more"], 1);
        let next = text(&group["next_cursor"]);
        if rows.len() >= end || !more || next.is_empty() || next == cursor {
            break;
        }
        cursor = next;
    }
    let loaded = rows.len();
    let page = rows
        .into_iter()
        .skip(offset)
        .take(limit)
        .collect::<Vec<_>>();
    let result = search_result(
        Provider::Qishui,
        page,
        limit,
        offset,
        (!more).then_some(loaded as u64),
    );
    Ok(result)
}

pub(crate) async fn details(
    client: &reqwest::Client,
    track: &str,
    account: &Account,
) -> Result<Value> {
    ensure!(id(track), "汽水歌曲标识无效");
    let request = |kind| json!({"track_id":track,"media_type":kind,"queue_type":"search_one_track","scene_name":"search"});
    let mut result = signed_read(client, "track_v2", &[], Some(request("track")), account).await?;
    if code(&result["status_code"], 1000005) {
        result = signed_read(client, "track_v2", &[], Some(request("ugc_clip")), account).await?;
    }
    let result = accepted(result)?;
    ensure!(
        text(&result["track"]["id"]) == track,
        "汽水返回的歌曲标识不一致"
    );
    Ok(result)
}

fn plain_lyric(native: &str) -> String {
    native
        .lines()
        .map(|line| {
            if let Some(matched) = LYRIC_LINE.captures(line) {
                let body = WORD_TAG.replace_all(&matched[2], "");
                return lrc_line(matched[1].parse().unwrap_or(0), &body);
            }
            WORD_TAG.replace_all(line, "").into_owned()
        })
        .collect::<Vec<_>>()
        .join("\n")
}

pub async fn lyric(client: &reqwest::Client, id: &str, account: &Account) -> Result<Value> {
    let body = details(client, id, account).await?;
    let lyric = &body["lyric"];
    let native = text(&lyric["content"]);
    let translation = text(&lyric["translations"]["cn"]);
    Ok(
        json!({"provider":"qishui","songId":id,"lyric":plain_lyric(&native),
        "klyric":native,"tlyric":plain_lyric(&translation),"romalrc":""}),
    )
}

pub async fn resolve(
    client: &reqwest::Client,
    id: &str,
    account: &Account,
) -> Result<ResolvedTrack> {
    let response = details(client, id, account).await?;
    let song = normalized_track(&response["track"]).context("汽水歌曲资料缺失")?;
    let model = &response["track_player"]["video_model"];
    let model = if let Some(raw) = model.as_str() {
        serde_json::from_str::<Value>(raw)?
    } else {
        model.clone()
    };
    let mut qualities = Vec::new();
    for (key, label) in LADDER {
        let mut quality = Quality::unavailable(key, label);
        let Some(row) =
            object_rows(&model["video_list"]).find(|row| row["video_meta"]["quality"] == key)
        else {
            qualities.push(quality);
            continue;
        };
        let info = &row["video_meta"];
        quality.source_available = true;
        quality.encrypted = row["encrypt_info"]["encrypt"] != false;
        quality.bitrate = uint(&info["bitrate"]) / 1000;
        quality.filesize = uint(&info["size"]);
        quality.encode = match info["codec_type"].as_str().unwrap_or_default() {
            "flac" => "flac",
            "aac" => "m4a",
            _ => "",
        }
        .into();
        let raw = text(&row["main_url"]);
        let url = if raw.starts_with("https://") {
            raw
        } else {
            STANDARD
                .decode(raw)
                .ok()
                .and_then(|value| String::from_utf8(value).ok())
                .unwrap_or_default()
        };
        let labels = &response["track"]["label_info"];
        let download_allowed = labels["only_vip_download"] != true
            && !labels["quality_only_vip_can_download"]
                .as_array()
                .is_some_and(|items| items.iter().any(|item| item == key));
        if !quality.encrypted {
            if parse_platform_media(&url).is_some_and(|url| url.scheme() == "https") {
                quality.url = url;
                quality.available = true;
                quality.downloadable = download_allowed;
            }
        } else if row["encrypt_info"]["encryption_method"] == "cenc-aes-ctr"
            && tools::ffmpeg().is_some()
        {
            quality.protected = protected_audio::Source::new(
                &url,
                quality.filesize,
                row["encrypt_info"]["spade_a"].as_str().unwrap_or_default(),
                first_text(&[&info["file_hash"], &info["file_id"]]),
                info["codec_type"].as_str().unwrap_or_default(),
            );
            quality.available = quality.protected.is_some();
            quality.decryption_supported = quality.available;
            quality.downloadable = quality.available && download_allowed;
        }
        qualities.push(quality);
    }
    Ok(ResolvedTrack { song, qualities })
}

pub async fn account_info(
    client: &reqwest::Client,
    account: &Account,
) -> Result<(Option<bool>, Value)> {
    if account.cookie.is_empty() {
        return Ok((Some(false), json!({})));
    }
    let session = account.session_config.as_ref().unwrap_or(&Value::Null);
    let values = &session["query"];
    let version = first_text(&[&values["version_name"], &values["version_code"]]);
    let version = if !version.is_empty()
        && version.len() <= 32
        && version
            .bytes()
            .all(|byte| byte == b'.' || byte.is_ascii_digit())
    {
        version
    } else {
        "3.7.0".into()
    };
    let mut query = vec![
        ("aid", "386088".to_owned()),
        ("app_name", "luna_pc".into()),
        ("account_sdk_source", "web".into()),
        ("language", "zh".into()),
        ("device_platform", "PC".into()),
        ("passport_jssdk_version", "2.4.13".into()),
        ("passport_jssdk_type", "normal".into()),
        ("is_from_ttaccountsdk", "1".into()),
        ("version_code", version),
    ];
    for (field, alias) in [("device_id", "did"), ("install_id", "iid")] {
        let value = first_text(&[&values[field], &values[alias]]);
        if id(&value) {
            query.extend([(field, value.clone()), (alias, value)]);
        }
    }
    let mut request = client
        .get(format!("{HOST}/passport/account/info/v2/"))
        .query(&query)
        .header(COOKIE, &account.cookie)
        .header(REFERER, "https://www.qishui.com/")
        .header("accept", "application/json");
    if let Some(ua) = session
        .pointer("/headers/user-agent")
        .and_then(Value::as_str)
    {
        request = request.header(USER_AGENT, ua);
    }
    let body = request_json(request).await?;
    let data = &body["data"];
    let root_ok = body["error_code"].is_null() || code(&body["error_code"], 0);
    if root_ok
        && body["message"] == "error"
        && code(&data["error_code"], 13)
        && data["name"] == "account_info_error"
    {
        return Ok((Some(false), json!({})));
    }
    let user = ["my_info", "user", "user_info", "account", "me"]
        .into_iter()
        .find_map(|name| data.get(name).filter(|value| value.is_object()))
        .unwrap_or(data);
    let user_id = first_text(&[&user["id"], &user["user_id"], &user["uid"]]);
    let valid = root_ok
        && body["message"] == "success"
        && (data["error_code"].is_null() || code(&data["error_code"], 0))
        && id(&user_id);
    let info = if valid {
        json!({"id":user_id,"userId":user_id,"nickname":first_text(&[&user["nickname"],&user["public_name"],&user["name"]]),
            "avatar":first_text(&[&user["avatar_url"],&user["avatar_thumb"]["url_list"][0]])})
    } else {
        json!({})
    };
    Ok((valid.then_some(true), info))
}
