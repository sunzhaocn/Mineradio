use super::{Transport, bytes, image_data, qq, status, timestamp_ms};
use crate::providers::code;
use anyhow::{Context, Result, ensure};
use regex::Regex;
use serde_json::{Value, json};
use std::sync::LazyLock;
use std::time::Duration;

const APP: &str = "wx48db31d50e334801";
const CONNECT: &str = "https://open.weixin.qq.com/connect/qrconnect";
const POLL: &str = "https://lp.open.weixin.qq.com/connect/l/qrconnect";
static UUID: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"uuid=([a-zA-Z0-9_-]{1,128})").unwrap());
static CODE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"window\.wx_errcode\s*=\s*(\d+)\s*;").unwrap());
static KEY: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"window\.wx_code\s*=\s*['"]([A-Za-z0-9_-]{1,1024})['"]"#).unwrap()
});

#[derive(Default)]
pub struct Login {
    uuid: String,
    ticket: Option<String>,
}

impl Login {
    pub(super) async fn create(&mut self, transport: &Transport) -> Result<Value> {
        let response = transport.client.get(CONNECT).header("referer","https://y.qq.com/").query(&[
            ("appid",APP),("redirect_uri","https://y.qq.com/portal/wx_redirect.html?login_type=2&surl=https://y.qq.com/"),
            ("response_type","code"),("scope","snsapi_login"),("state","STATE"),
            ("href","https://y.qq.com/mediastyle/music_v17/src/css/popup_wechat.css#wechat_redirect"),
        ]).send().await?.error_for_status()?;
        let data = bytes(response).await?;
        let doc = String::from_utf8_lossy(&data);
        self.uuid = UUID
            .captures(&doc)
            .map(|value| value[1].to_owned())
            .context("微信未返回扫码会话")?;
        let response = transport
            .client
            .get(format!(
                "https://open.weixin.qq.com/connect/qrcode/{}",
                self.uuid
            ))
            .header("referer", CONNECT)
            .send()
            .await?
            .error_for_status()?;
        let mut result = status("waiting", "请使用微信扫一扫");
        result["qr_image"] = json!(image_data(&bytes(response).await?)?);
        Ok(result)
    }

    pub(super) async fn poll(&mut self, transport: &Transport) -> Result<Value> {
        if self.ticket.is_none() {
            let response = transport
                .client
                .get(POLL)
                .header("referer", "https://open.weixin.qq.com/")
                .timeout(Duration::from_secs(32))
                .query(&[
                    ("uuid", self.uuid.clone()),
                    ("_", timestamp_ms().to_string()),
                ])
                .send()
                .await;
            let result = match response {
                Err(error) if error.is_timeout() => return Ok(status("waiting", "等待微信扫码")),
                value => value?.error_for_status()?,
            };
            let data = bytes(result).await?;
            let body = String::from_utf8_lossy(&data);
            match CODE
                .captures(&body)
                .and_then(|captures| captures.get(1))
                .map(|matched| matched.as_str())
            {
                Some("408") => return Ok(status("waiting", "等待微信扫码")),
                Some("404") => return Ok(status("scanned", "已扫码，请在微信中确认登录")),
                Some("402") => return Ok(status("expired", "微信二维码已过期，请重新生成")),
                Some("403") => return Ok(status("cancelled", "已取消微信授权")),
                Some("405") => {
                    self.ticket = KEY.captures(&body).map(|captures| captures[1].to_owned())
                }
                _ => return Ok(status("failed", "微信未接受授权，请重新扫码")),
            }
        }
        let ticket = self.ticket.as_ref().context("微信未返回音乐授权码")?;
        let result = transport.client.post("https://u.y.qq.com/cgi-bin/musicu.fcg")
            .header("origin","https://y.qq.com").header("referer","https://y.qq.com/").json(&json!({
                "comm":{"ct":24,"cv":4747474,"platform":"yqq.json","tmeLoginType":1},
                "req":{"module":"music.login.LoginServer","method":"Login","param":{"code":ticket,"strAppid":APP}}
            })).send().await?.error_for_status()?;
        let result: Value = serde_json::from_slice(&bytes(result).await?)?;
        ensure!(
            (result["code"].is_null() || code(&result["code"], 0))
                && code(&result["req"]["code"], 0)
                && result["req"]["data"].is_object(),
            "QQ 音乐未完成微信授权"
        );
        qq::authorized(transport, &result["req"]["data"], 1, "", "")
    }
}
