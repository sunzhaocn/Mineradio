use super::{get, hex_md5, login_fields, signed_song_info, valid_hash};
use crate::accounts::Account;
use crate::providers::{code, first_text, numeric_id, request_json};
use anyhow::{Result, ensure};
use reqwest::header::{COOKIE, REFERER, USER_AGENT};
use serde_json::Value;
use std::collections::BTreeMap;
use time::OffsetDateTime;

const MODULE: &str = "fc4be23b4e972707f36b8a828a93ba8a";
pub(super) const SALT: &str = "OIlwieks28dk2k092lksi2UIkp";
const GUEST: &str = "fb0e809d96a2cf74128bbd8f31d3fe1b";

pub(super) fn device(account: &Account) -> (&str, &str) {
    (
        ["kg_mid", "KG_MID", "mid"]
            .into_iter()
            .find_map(|name| account.field(name))
            .unwrap_or(GUEST),
        ["kg_dfid", "KG_DFID", "dfid"]
            .into_iter()
            .find_map(|name| account.field(name))
            .unwrap_or("-"),
    )
}

pub(super) async fn native_song(
    client: &reqwest::Client,
    song: &str,
    native: &str,
    account: &Account,
) -> Result<String> {
    if !native.is_empty() || !valid_hash(song) {
        let id = if native.is_empty() { song } else { native };
        numeric_id(id)?;
        return Ok(id.to_owned());
    }
    let upstream = request_json(
        get(
            client,
            "https://mobiles.kugou.com/api/v3/song/info",
            account,
        )
        .query(&[("hash", song)]),
    )
    .await?;
    let node = &upstream["data"];
    if let Some(value) = crate::providers::object_rows(&node["album"])
        .map(|row| crate::providers::text(&row["album_audio_id"]))
        .find(|value| numeric_id(value).is_ok())
    {
        return Ok(value);
    }
    let key = first_text(&[
        &node["album_audio_id"],
        &node["audio_id"],
        &node["mixsongid"],
    ]);
    if numeric_id(&key).is_ok() {
        return Ok(key);
    }
    let info = signed_song_info(client, song, "", account).await?;
    let native = first_text(&[
        &info["album_audio_id"],
        &info["audio_id"],
        &info["mixsongid"],
    ]);
    numeric_id(&native)?;
    Ok(native)
}

pub async fn read(
    client: &reqwest::Client,
    song: &str,
    native: &str,
    page: u64,
    limit: usize,
    hot: bool,
    account: &Account,
) -> Result<Value> {
    let native = native_song(client, song, native, account).await?;
    let route = if hot { "topliked" } else { "newest" };
    let now = OffsetDateTime::now_utc().unix_timestamp().to_string();
    let (device, dfid) = device(account);
    let (token, user) = login_fields(account);
    let mut query = BTreeMap::from([
        ("dfid", dfid.to_owned()),
        ("mid", device.to_owned()),
        ("uuid", "-".into()),
        ("appid", "1005".into()),
        ("clientver", "20489".into()),
        ("clienttime", now.clone()),
        ("ver", "6".into()),
        ("mixsongid", native),
        ("need_show_image", "1".into()),
        ("p", page.to_string()),
        ("pagesize", limit.to_string()),
        ("extdata", "0".into()),
        ("code", MODULE.into()),
    ]);
    if !token.is_empty() {
        query.insert("token", token);
    }
    if numeric_id(&user).is_ok() {
        query.insert("userid", user);
    }
    let fields = query
        .iter()
        .map(|(key, value)| format!("{key}={value}"))
        .collect::<String>();
    query.insert("signature", hex_md5(format!("{SALT}{fields}{SALT}")));
    let mut request = client
        .post(format!(
            "https://gateway.kugou.com/mcomment/r/v1/rank/{route}"
        ))
        .query(&query)
        .header(
            USER_AGENT,
            "Android15-1070-11083-46-0-DiscoveryDRADProtocol-wifi",
        )
        .header(REFERER, "https://www.kugou.com/")
        .header("mid", device)
        .header("dfid", dfid)
        .header("clienttime", now)
        .body("");
    if account.configured() {
        request = request.header(COOKIE, &account.cookie);
    }
    let reply = request_json(request).await?;
    ensure!(
        code(&reply["status"], 1) && (reply["err_code"].is_null() || code(&reply["err_code"], 0)),
        "酷狗暂时无法返回评论"
    );
    Ok(reply)
}

pub async fn toggle(
    client: &reqwest::Client,
    comment: &str,
    child: &str,
    account: &Account,
) -> Result<bool> {
    numeric_id(comment)?;
    numeric_id(child)?;
    let (device, _) = device(account);
    let (token, user) = login_fields(account);
    numeric_id(&user)?;
    ensure!(!token.is_empty(), "请先登录酷狗");
    let now = OffsetDateTime::now_utc().unix_timestamp_nanos() / 1_000_000;
    let assign = hex_md5(format!(
        "{MODULE}{now}949ad1dac503e48ad6e86bb841383485{device}"
    ));
    let reply = request_json(
        client
            .post("https://gateway.kugou.com/like/handlelike")
            .header("x-router", "like.service.kugou.com")
            .header(REFERER, "https://pc.service.kugou.com/")
            .header("content-type", "application/json")
            .query(&[
                ("modulecode", MODULE),
                ("clienttime", &(now / 1000).to_string()),
                ("timestamp", &now.to_string()),
                ("mid", device),
                ("ver", "2.02"),
                ("assign", &assign),
                ("tid", "0"),
                ("childrenid", child),
                ("object", comment),
                ("kugouid", &user),
                ("clienttoken", &token),
                ("appid", "1001"),
                ("from", "pc"),
                ("uuid", "-"),
            ])
            .body("{}"),
    )
    .await?;
    ensure!(code(&reply["status"], 1), "酷狗未确认点赞");
    if let Some(liked) = reply["islike"].as_bool() {
        return Ok(liked);
    }
    ensure!(
        code(&reply["islike"], 0) || code(&reply["islike"], 1),
        "酷狗未返回点赞状态"
    );
    Ok(code(&reply["islike"], 1))
}
