use super::{
    Transport, bytes, cookie_header, image_data, safe_host, status, timestamp_ms, valid_cookie,
};
use crate::providers::{code, first_text, numeric_id, text};
use anyhow::{Context, Result, ensure};
use regex::Regex;
use serde_json::{Value, json};
use std::sync::LazyLock;
use url::Url;

const SHOW: &str = "https://ssl.ptlogin2.qq.com/ptqrshow";
const POLL: &str = "https://ssl.ptlogin2.qq.com/ptqrlogin";
const SIGN: &str = "https://ssl.ptlogin2.graph.qq.com/check_sig";
const GRAPH: &str = "https://graph.qq.com/oauth2.0/authorize";
const MUSIC: &str = "https://u.y.qq.com/cgi-bin/musicu.fcg";
const REF: &str = "https://xui.ptlogin2.qq.com/";
static CALLBACK: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?s)^\s*ptuiCB\((.*)\)\s*;?\s*$").unwrap());
static ARG: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"'((?:\\.|[^'\\])*)'").unwrap());
static ESCAPE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\\(x[0-9a-fA-F]{2}|u[0-9a-fA-F]{4}|.)").unwrap());

#[derive(Default)]
pub struct Login {
    signature: String,
}

impl Login {
    pub(super) async fn create(&mut self, transport: &Transport) -> Result<Value> {
        let random = format!("0.{}", timestamp_ms());
        let response = transport
            .client
            .get(SHOW)
            .header("referer", REF)
            .query(&[
                ("appid", "716027609"),
                ("e", "2"),
                ("l", "M"),
                ("s", "3"),
                ("d", "72"),
                ("v", "4"),
                ("t", &random),
                ("daid", "383"),
                ("pt_3rd_aid", "100497308"),
            ])
            .send()
            .await?
            .error_for_status()?;
        let data = bytes(response).await?;
        self.signature = transport.cookie(POLL, "qrsig");
        ensure!(!self.signature.is_empty(), "QQ 未创建有效扫码会话");
        let mut result = status("waiting", "请使用手机 QQ 扫码，并在手机上确认登录 QQ 音乐");
        result["qr_image"] = json!(image_data(&data)?);
        Ok(result)
    }

    pub(super) async fn poll(&self, transport: &Transport) -> Result<Value> {
        let token = hash33(&self.signature, 0).to_string();
        let action = format!("0-0-{}", timestamp_ms());
        let data = bytes(
            transport
                .client
                .get(POLL)
                .header("referer", REF)
                .query(&[
                    ("u1", "https://graph.qq.com/oauth2.0/login_jump"),
                    ("ptqrtoken", &token),
                    ("ptredirect", "0"),
                    ("h", "1"),
                    ("t", "1"),
                    ("g", "1"),
                    ("from_ui", "1"),
                    ("ptlang", "2052"),
                    ("action", &action),
                    ("js_ver", "20102616"),
                    ("js_type", "1"),
                    ("login_sig", ""),
                    ("pt_uistyle", "40"),
                    ("aid", "716027609"),
                    ("daid", "383"),
                    ("pt_3rd_aid", "100497308"),
                    ("has_onekey", "1"),
                ])
                .send()
                .await?
                .error_for_status()?,
        )
        .await?;
        let body = std::str::from_utf8(&data)?;
        let captures = CALLBACK.captures(body).context("QQ 返回的扫码状态无效")?;
        let parts = ARG
            .captures_iter(&captures[1])
            .take(7)
            .map(|matched| unescape(&matched[1]))
            .collect::<Vec<_>>();
        match parts.first().map(String::as_str) {
            Some("66") => Ok(status("waiting", "等待扫码…")),
            Some("67") => Ok(status("scanned", "已扫码，请在手机上确认登录")),
            Some("65") => Ok(status("expired", "二维码已过期，请重新生成")),
            Some("68") => Ok(status("cancelled", "已取消登录，请重新生成二维码")),
            Some("0") => {
                authorize(
                    transport,
                    parts.get(2).context("QQ 缺少登录回调")?,
                    parts.get(5).map(String::as_str).unwrap_or_default(),
                )
                .await
            }
            _ => Ok(status("failed", "QQ 未确认登录，请重新生成二维码")),
        }
    }
}

fn hash33(value: &str, seed: u32) -> u32 {
    value.chars().fold(seed, |state, ch| {
        state.wrapping_mul(33).wrapping_add(ch as u32) & 0x7fff_ffff
    })
}

fn unescape(input: &str) -> String {
    ESCAPE
        .replace_all(input, |matched: &regex::Captures| {
            let value = &matched[1];
            if value.len() > 1 && value.starts_with(['x', 'u']) {
                return u32::from_str_radix(&value[1..], 16)
                    .ok()
                    .and_then(char::from_u32)
                    .unwrap_or('\u{fffd}')
                    .to_string();
            }
            value.to_owned()
        })
        .into_owned()
}

async fn authorize(transport: &Transport, callback: &str, nickname: &str) -> Result<Value> {
    let redirect = Url::parse(callback)?;
    ensure!(
        safe_host(&redirect, &["ssl.ptlogin2.graph.qq.com"]) && redirect.path() == "/check_sig",
        "QQ 返回的授权回调无效"
    );
    let uin = redirect
        .query_pairs()
        .find(|(name, _)| name == "uin")
        .map(|(_, value)| value.into_owned())
        .context("QQ 缺少账号标识")?;
    numeric_id(&uin)?;
    let ticket = redirect
        .query_pairs()
        .find(|(name, _)| name == "ptsigx")
        .map(|(_, value)| value.into_owned())
        .filter(|value| !value.is_empty())
        .context("QQ 缺少扫码凭据")?;
    let reply = transport
        .client
        .get(SIGN)
        .header("referer", REF)
        .query(&[
            ("uin", uin.as_str()),
            ("pttype", "1"),
            ("service", "ptqrlogin"),
            ("nodirect", "0"),
            ("ptsigx", ticket.as_str()),
            ("s_url", "https://graph.qq.com/oauth2.0/login_jump"),
            ("ptlang", "2052"),
            ("ptredirect", "100"),
            ("aid", "716027609"),
            ("daid", "383"),
            ("j_later", "0"),
            ("low_login_hour", "0"),
            ("regmaster", "0"),
            ("pt_login_type", "3"),
            ("pt_aid", "0"),
            ("pt_aaid", "16"),
            ("pt_light", "0"),
            ("pt_3rd_aid", "100497308"),
        ])
        .send()
        .await?;
    ensure!(
        reply.status().is_success() || reply.status().is_redirection(),
        "QQ 扫码授权未确认"
    );
    let p_skey = transport.cookie(GRAPH, "p_skey");
    ensure!(!p_skey.is_empty(), "QQ 的音乐授权会话未建立");
    let gtk = hash33(&p_skey, 5381);
    let reply = transport
        .client
        .post(GRAPH)
        .header("referer", "https://graph.qq.com/")
        .form(&[
            ("response_type", "code".to_owned()),
            ("client_id", "100497308".into()),
            (
                "redirect_uri",
                "https://y.qq.com/portal/wx_redirect.html?login_type=1&surl=https://y.qq.com/"
                    .into(),
            ),
            ("scope", "get_user_info,get_app_friends".into()),
            ("state", "state".into()),
            ("switch", String::new()),
            ("from_ptlogin", "1".into()),
            ("src", "1".into()),
            ("update_auth", "1".into()),
            ("openapi", "1010_1030".into()),
            ("g_tk", gtk.to_string()),
            ("auth_time", timestamp_ms().to_string()),
            ("ui", uuid::Uuid::new_v4().to_string()),
        ])
        .send()
        .await?;
    let location = reply
        .headers()
        .get("location")
        .and_then(|value| value.to_str().ok())
        .context("QQ 缺少音乐授权回调")?;
    let location = Url::parse(location)?;
    ensure!(
        safe_host(&location, &["y.qq.com"]),
        "QQ 返回的音乐授权回调无效"
    );
    let auth_code = location
        .query_pairs()
        .find(|(name, _)| name == "code")
        .map(|(_, value)| value.into_owned())
        .filter(|value| !value.is_empty())
        .context("QQ 缺少音乐授权码")?;
    let reply = transport.client.post(MUSIC).header("referer","https://y.qq.com/").header("origin","https://y.qq.com").json(&json!({
        "comm":{"g_tk":gtk,"platform":"yqq.json","ct":24,"cv":4747474,"tmeLoginType":2},
        "req":{"module":"QQConnectLogin.LoginServer","method":"QQLogin","param":{"code":auth_code}},
    })).send().await?.error_for_status()?;
    let decoded: Value = serde_json::from_slice(&bytes(reply).await?)?;
    ensure!(
        (decoded["code"].is_null() || code(&decoded["code"], 0))
            && code(&decoded["req"]["code"], 0),
        "QQ 音乐未给出完整授权"
    );
    authorized(transport, &decoded["req"]["data"], 2, &uin, nickname)
}

pub(super) fn authorized(
    transport: &Transport,
    data: &Value,
    login_type: u8,
    uin: &str,
    nickname: &str,
) -> Result<Value> {
    let mut cookies = transport.cookies(MUSIC);
    let user = first_text(&[
        &data["musicid"],
        &data["str_musicid"],
        &json!(cookies.get("qqmusic_uin")),
    ]);
    numeric_id(&user)?;
    let key = first_text(&[
        &data["musickey"],
        &json!(cookies.get("qqmusic_key")),
        &json!(cookies.get("qm_keyst")),
    ]);
    ensure!(
        valid_cookie("qqmusic_key", &key),
        "QQ 音乐未给出有效的播放授权"
    );
    cookies.retain(|name, _| {
        !matches!(
            name.as_str(),
            "qrsig" | "pt_login_sig" | "ptcz" | "ptdrvs" | "pt_local_token"
        )
    });
    cookies.extend([
        ("uin".into(), user.clone()),
        ("qqmusic_uin".into(), user.clone()),
        ("qqmusic_key".into(), key.clone()),
        ("qm_keyst".into(), key),
        ("tmeLoginType".into(), login_type.to_string()),
    ]);
    let mut result = status("authorized", "QQ 音乐登录成功");
    result["cookie"] = json!(cookie_header(cookies));
    let name = if nickname.is_empty() {
        first_text(&[&data["nickname"], &data["nick"]])
    } else {
        nickname.into()
    };
    result["account"] = json!({"id":user,"uin":uin,"qqUin":uin,"name":name.chars().take(256).collect::<String>(),
        "avatar":text(&data["face"])});
    Ok(result)
}
