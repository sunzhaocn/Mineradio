use super::{
    Transport, bytes, cookie_header, qr_image, safe_host, status, timestamp_ms, valid_cookie,
};
use crate::providers::{code, first_text, qishui, text, uint};
use anyhow::{Context, Result, ensure};
use serde_json::{Value, json};
use std::collections::BTreeMap;
use url::Url;

#[cfg(windows)]
mod security;

const HOST: &str = "https://api.qishui.com";
const PAGE: &str = "https://www.qishui.com";
const AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) SodaMusic/3.7.0 Chrome/136.0.7103.59 Electron/36.4.0 Safari/537.36";
const SESSION_NAMES: &[&str] = &["sessionid", "sessionid_ss", "sid_tt", "sid_guard"];

pub(super) fn allowed(url: &Url) -> bool {
    safe_host(
        url,
        &["api.qishui.com", "bff-pc.qishui.com", "www.qishui.com"],
    )
}

pub(super) struct Login {
    token: String,
    device: String,
    installation: String,
    cooldowns: u8,
    #[cfg(windows)]
    browser: Option<security::Browser>,
    #[cfg(windows)]
    verification: Option<Vec<(String, String)>>,
}

impl Login {
    pub(super) fn new() -> Self {
        let device = (uuid::Uuid::new_v4().as_u128() % 8_000_000_000_000_000
            + 1_000_000_000_000_000)
            .to_string();
        let installation = (uuid::Uuid::new_v4().as_u128() % 800_000_000_000_000
            + 100_000_000_000_000)
            .to_string();
        Self {
            token: String::new(),
            device,
            installation,
            cooldowns: 0,
            #[cfg(windows)]
            browser: None,
            #[cfg(windows)]
            verification: None,
        }
    }

    fn parameters(&self) -> [(&str, &str); 15] {
        [
            ("passport_jssdk_version", "3.4.10"),
            ("passport_jssdk_type", "normal"),
            ("is_from_ttaccountsdk", "1"),
            ("aid", "386088"),
            ("language", "zh"),
            ("is_new_login", "1"),
            ("is_from_iesaccountsaas", "1"),
            ("account_sdk_source", "web"),
            ("device_id", &self.device),
            ("install_id", &self.installation),
            ("did", &self.device),
            ("iid", &self.installation),
            ("device_platform", "PC"),
            ("version_code", "3.7.0"),
            ("platform", "web"),
        ]
    }

    fn headers(request: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
        request
            .header("user-agent", AGENT)
            .header("accept", "application/json, text/javascript")
            .header("referer", format!("{PAGE}/"))
            .header("origin", PAGE)
    }

    async fn request(
        &mut self,
        transport: &Transport,
        route: &str,
        form: Option<&[(&str, &str)]>,
        extra: &[(&str, &str)],
    ) -> Result<Value> {
        let mut target = Url::parse(&format!("{HOST}{route}"))?;
        target
            .query_pairs_mut()
            .extend_pairs(self.parameters())
            .extend_pairs(extra);
        #[cfg(windows)]
        if let Some(browser) = self.browser.as_mut() {
            let value = browser.request(target, form, transport).await?;
            ensure!(value["data"].is_object(), "汽水扫码服务响应无效");
            return Ok(value);
        }
        let request = match form {
            Some(fields) => {
                let mut request = transport.client.post(target).form(fields);
                let fields = transport.cookies(HOST);
                if let Some(token) = fields
                    .get("passport_csrf_token")
                    .or_else(|| fields.get("passport_csrf_token_default"))
                {
                    request = request.header("X-Tt-Passport-Csrf-Token", token);
                }
                request
            }
            None => transport.client.get(target),
        };
        let response = Self::headers(request)
            .send()
            .await
            .and_then(reqwest::Response::error_for_status)
            .context("暂时无法访问汽水官方扫码服务")?;
        let data = serde_json::from_slice::<Value>(&bytes(response).await?)
            .context("汽水扫码服务响应无效")?;
        ensure!(data["data"].is_object(), "汽水扫码服务响应无效");
        Ok(data)
    }

    pub(super) async fn create(&mut self, transport: &Transport) -> Result<Value> {
        #[cfg(windows)]
        match security::Browser::open().await {
            Ok(browser) => self.browser = Some(browser),
            Err(_error) => {
                #[cfg(debug_assertions)]
                eprintln!("汽水安全组件启动: {_error}");
            }
        }
        let extra = [
            ("next", HOST),
            ("need_logo", "false"),
            ("need_short_url", "false"),
        ];
        let response = self
            .request(transport, "/passport/web/get_qrcode/", None, &extra)
            .await;
        #[cfg(windows)]
        let response = if response.is_err() && self.browser.is_some() {
            #[cfg(debug_assertions)]
            if let Err(error) = &response {
                eprintln!("汽水安全组件取码: {error}");
            }
            self.close().await;
            self.request(transport, "/passport/web/get_qrcode/", None, &extra)
                .await
        } else {
            response
        };
        let response = response?;
        let data = &response["data"];
        let token = data["token"]
            .as_str()
            .filter(|token| {
                !token.is_empty() && token.len() <= 4096 && !token.chars().any(char::is_control)
            })
            .context("汽水暂时无法提供登录二维码")?;
        ensure!(
            data["error_code"].is_null() || code(&data["error_code"], 0),
            "汽水暂时无法提供登录二维码"
        );
        self.token = token.to_owned();
        let url = Url::parse(&first_text(&[&data["qrcode_index_url"], &data["web_url"]]))?;
        ensure!(allowed(&url), "汽水二维码不在官方登录服务内");
        let mut result = status("waiting", "请使用汽水音乐 App 扫码并确认");
        result["qr_image"] = json!(qr_image(&url)?);
        let expiry = uint(&data["expire_time"]);
        let now = (timestamp_ms() / 1000) as u64;
        let seconds = if expiry >= 1_000_000_000_000 {
            (expiry / 1000).saturating_sub(now)
        } else if expiry >= 1_000_000_000 {
            expiry.saturating_sub(now)
        } else if expiry == 0 {
            180
        } else {
            expiry
        };
        result["expires_in"] = json!(seconds.clamp(1, 600));
        Ok(result)
    }

    fn ingest(transport: &Transport, data: &Value) -> Result<()> {
        if data["session_cookie"].is_null() {
            return Ok(());
        }
        let raw = data["session_cookie"]
            .as_str()
            .context("汽水登录会话格式无效")?;
        ensure!(
            raw.len() <= 65_536 && !raw.chars().any(char::is_control),
            "汽水登录会话格式无效"
        );
        let destination = Url::parse(HOST)?;
        for field in raw.split(';') {
            let Some((key, value)) = field.trim().split_once('=') else {
                continue;
            };
            let name = key.trim();
            let value = value.trim();
            if matches!(
                name.to_ascii_lowercase().as_str(),
                "domain"
                    | "path"
                    | "expires"
                    | "max-age"
                    | "secure"
                    | "httponly"
                    | "samesite"
                    | "priority"
            ) || !valid_cookie(name, value)
            {
                continue;
            }
            transport.jar.add_cookie_str(
                &format!("{name}={value}; Domain=qishui.com; Path=/; Secure; HttpOnly"),
                &destination,
            );
        }
        Ok(())
    }

    fn cookies(transport: &Transport) -> BTreeMap<String, String> {
        let mut fields = transport.cookies(PAGE);
        fields.extend(transport.cookies(HOST));
        fields
    }

    pub(super) async fn close(&mut self) {
        #[cfg(windows)]
        if let Some(mut browser) = self.browser.take() {
            browser.close().await;
        }
    }

    #[cfg(windows)]
    fn verification_fields(data: &Value) -> Vec<(String, String)> {
        let input = &data["biz_params"];
        let parsed;
        let fields = match input.as_str() {
            Some(raw) if raw.len() <= 16384 => {
                parsed = serde_json::from_str::<Value>(raw).unwrap_or_else(|_| {
                    json!(
                        url::form_urlencoded::parse(raw.as_bytes())
                            .into_owned()
                            .collect::<BTreeMap<_, _>>()
                    )
                });
                parsed.as_object()
            }
            _ => input.as_object(),
        };
        fields
            .into_iter()
            .flatten()
            .filter_map(|(key, value)| {
                let value = text(value);
                (key.len() <= 128
                    && value.len() <= 4096
                    && !key.is_empty()
                    && !matches!(
                        key.as_str(),
                        "token"
                            | "next"
                            | "need_logo"
                            | "need_short_url"
                            | "is_frontier"
                            | "is_new_login"
                    ))
                .then(|| (key.to_owned(), value))
            })
            .take(32)
            .collect()
    }

    pub(super) async fn poll(&mut self, transport: &Transport) -> Result<Value> {
        #[cfg(windows)]
        let verified = if let (Some(_), Some(browser)) = (&self.verification, self.browser.as_mut())
        {
            match browser.verification().await {
                Ok(Some(true)) => self.verification.take(),
                Ok(None) => return Ok(Self::waiting_for_verification()),
                _ => {
                    self.close().await;
                    return Ok(status("cancelled", "汽水身份验证未完成，请重新扫码"));
                }
            }
        } else {
            None
        };
        let token = self.token.clone();
        let form = [
            ("need_logo", "false"),
            ("need_short_url", "false"),
            ("is_frontier", "true"),
            ("token", token.as_str()),
            ("is_new_login", "1"),
            ("next", HOST),
        ];
        #[cfg(windows)]
        let form = form
            .into_iter()
            .chain(
                verified
                    .iter()
                    .flatten()
                    .map(|(key, value)| (key.as_str(), value.as_str())),
            )
            .collect::<Vec<_>>();
        #[cfg(windows)]
        let extra = if verified.is_some() {
            &[("isResend", "true")][..]
        } else {
            &[]
        };
        #[cfg(not(windows))]
        let extra = &[];
        let value = self
            .request(
                transport,
                "/passport/web/check_qrconnect/",
                Some(&form),
                extra,
            )
            .await?;
        let data = &value["data"];
        if code(&data["error_code"], 7) {
            self.cooldowns += 1;
            if self.cooldowns >= 3 {
                self.close().await;
                return Ok(status(
                    "expired",
                    "汽水安全校验未通过，请重新扫码或粘贴 Cookie",
                ));
            }
            let mut result = status("cooldown", "汽水安全校验暂未通过");
            result["retry_after"] = json!(5);
            return Ok(result);
        }
        self.cooldowns = 0;
        if code(&data["error_code"], 2046) || data["account_flow"] == "verify" {
            #[cfg(windows)]
            if let Some(browser) = self.browser.as_mut() {
                browser
                    .begin_verification(&value, &self.device, &self.installation)
                    .await?;
                self.verification =
                    Some(Self::verification_fields(if data["biz_params"].is_null() {
                        &value
                    } else {
                        data
                    }));
                return Ok(Self::waiting_for_verification());
            }
            return Ok(status(
                "verification_required",
                "汽水要求额外身份验证，请在汽水音乐完成验证后使用 Cookie 登录",
            ));
        }
        ensure!(
            data["error_code"].is_null() || code(&data["error_code"], 0),
            "汽水扫码暂未确认，请重试"
        );
        Self::ingest(transport, data)?;
        let state = text(&data["status"]).to_ascii_lowercase();
        let confirmed = matches!(state.as_str(), "3" | "confirmed" | "success");
        let mut cookies = Self::cookies(transport);
        if confirmed && !SESSION_NAMES.iter().any(|name| cookies.contains_key(*name)) {
            if let Some(url) = data["redirect_url"].as_str().filter(|url| !url.is_empty()) {
                let url = Url::parse(url)?;
                ensure!(allowed(&url), "汽水登录跳转地址无效");
                let _ = Self::headers(transport.client.get(url))
                    .send()
                    .await?
                    .error_for_status()?;
                cookies = Self::cookies(transport);
            }
        }
        if SESSION_NAMES.iter().any(|name| cookies.contains_key(*name))
            && (confirmed || !text(&data["session_cookie"]).is_empty() || data["logged_in"] == true)
        {
            let profile = self
                .request(transport, "/passport/account/info/v2/", None, &[])
                .await
                .ok();
            cookies.extend(Self::cookies(transport));
            let profile = profile
                .as_ref()
                .filter(|entry| entry["message"] == "success")
                .map_or(data, |entry| &entry["data"]);
            let user = ["my_info", "user", "user_info"]
                .into_iter()
                .map(|key| &profile[key])
                .find(|user| user.is_object())
                .unwrap_or(profile);
            let cookie = cookie_header(cookies);
            let mut result = status("authorized", "汽水音乐扫码登录成功");
            result["cookie"] = json!(cookie);
            result["account"] = json!({"id":first_text(&[&user["id"],&user["user_id"],&user["uid"]]),
                "name":first_text(&[&user["nickname"],&user["name"],&user["screen_name"]]),
                "avatar":first_text(&[&user["avatar_url"],&user["avatar"]])});
            result["session_config"] = json!({"query":qishui::desktop_query(&self.device,&self.installation),
                "headers":{"user-agent":AGENT,"cookie":cookie}});
            self.close().await;
            return Ok(result);
        }
        let result = match state.as_str() {
            "2" | "scanned" => status("scanned", "已扫码，请在手机上确认"),
            "3" | "confirmed" => status("scanned", "正在等待汽水签发登录会话"),
            "4" | "expired" => status("expired", "二维码已过期，请重新获取"),
            "5" | "cancelled" | "canceled" | "refused" | "rejected" => {
                status("cancelled", "已取消汽水音乐登录")
            }
            _ => status("waiting", "等待汽水音乐 App 扫码"),
        };
        if matches!(result["status"].as_str(), Some("expired" | "cancelled")) {
            self.close().await;
        }
        Ok(result)
    }

    #[cfg(windows)]
    fn waiting_for_verification() -> Value {
        let mut result = status("scanned", "请在弹出的汽水安全验证窗口完成验证");
        result["verification_required"] = json!(true);
        result
    }
}
