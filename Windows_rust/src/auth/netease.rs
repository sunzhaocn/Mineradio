use super::{Auth, Transport, cookie_header, required, status, timestamp_ms};
use crate::accounts::Account;
use crate::providers::{self, code, first_text, request_json, text};
use anyhow::{Result, ensure};
use md5::{Digest, Md5};
use serde_json::{Value, json};
use sha2::Sha256;
use std::sync::LazyLock;
use std::time::{Duration, Instant};

const MUSIC: &str = "https://music.163.com/";
static PHONE_SALT: LazyLock<uuid::Uuid> = LazyLock::new(uuid::Uuid::new_v4);

pub struct Phone {
    challenge_sent: Option<[u8; 32]>,
    next_attempt: Instant,
    failures: u8,
}

impl Default for Phone {
    fn default() -> Self {
        Self {
            challenge_sent: None,
            next_attempt: Instant::now(),
            failures: 0,
        }
    }
}

impl Phone {
    pub(super) async fn sms(
        &mut self,
        auth: &Auth,
        transport: &Transport,
        form: &Value,
    ) -> Result<Value> {
        let (phone, country, digest) = phone_number(form)?;
        if let Some(seconds) = auth.reserve_sms(digest).await {
            let mut result = status("cooldown", "请稍后再发送短信验证码");
            result["retry_after"] = json!(seconds);
            return Ok(result);
        }
        self.challenge_sent = None;
        let reply = we(
            transport,
            "/weapi/sms/captcha/sent",
            json!({
                "ctcode":country,"cellphone":phone,"secrete":"music_middleuser_pclogin"
            }),
        )
        .await?;
        if let Some(result) = verification(&reply) {
            return Ok(result);
        }
        if code(&reply["code"], 429) {
            let mut result = status("cooldown", "网易云限制了短信发送频率，请稍后重试");
            result["retry_after"] = json!(60);
            return Ok(result);
        }
        if !code(&reply["code"], 200) || reply["data"] == false {
            return Ok(status(
                "waiting",
                "网易云未接受短信发送，请检查手机号后重试",
            ));
        }
        self.challenge_sent = Some(digest);
        let mut result = status("waiting", "短信验证码已发送，请输入验证码登录");
        result["sms_sent"] = json!(true);
        result["retry_after"] = json!(60);
        Ok(result)
    }

    pub(super) async fn login(&mut self, transport: &Transport, form: &Value) -> Result<Value> {
        let (phone, country, digest) = phone_number(form)?;
        let password = form["password"].as_str().unwrap_or_default();
        let captcha = form["captcha"].as_str().unwrap_or_default();
        ensure!(
            password.is_empty() != captcha.is_empty()
                && password.len() <= 1024
                && !password.contains('\0'),
            "请选择正确的网易云登录方式"
        );
        if !captcha.is_empty() {
            ensure!(
                (4..=8).contains(&captcha.len())
                    && captcha.bytes().all(|byte| byte.is_ascii_digit()),
                "请输入有效的短信验证码"
            );
            ensure!(
                self.challenge_sent == Some(digest),
                "请先为该手机号发送验证码"
            );
        }
        let now = Instant::now();
        if self.next_attempt > now {
            let mut result = status("cooldown", "登录尝试过于频繁，请稍后重试");
            result["retry_after"] = json!((self.next_attempt - now).as_secs() + 1);
            return Ok(result);
        }
        if self.failures >= 5 {
            self.failures = 0;
        }
        let mut data = json!({"type":"1","https":"true","phone":phone,"countrycode":country,
            "remember":"true","secureCaptcha":""});
        if captcha.is_empty() {
            data["password"] = json!(hex::encode(Md5::digest(password.as_bytes())));
        } else {
            data["captcha"] = json!(captcha);
        }
        self.next_attempt = now + Duration::from_secs(3);
        let reply = we(transport, "/weapi/w/login/cellphone", data).await?;
        if let Some(result) = verification(&reply) {
            return Ok(result);
        }
        if !code(&reply["code"], 200) {
            self.failures += 1;
            if self.failures >= 5 || code(&reply["code"], 429) {
                self.next_attempt = now + Duration::from_secs(60);
            }
            return Ok(status("waiting", "网易云未确认登录，请检查密码或验证码"));
        }
        let cookies = transport.cookies(MUSIC);
        ensure!(cookies.contains_key("MUSIC_U"), "网易云未返回完整登录资料");
        let profile = &reply["profile"];
        let id = first_text(&[&profile["userId"], &reply["account"]["id"]]);
        let mut result = status("authorized", "网易云音乐登录成功");
        result["cookie"] = json!(cookie_header(cookies));
        result["account"] = json!({"id":id, "name":text(&profile["nickname"]), "avatar":text(&profile["avatarUrl"]),
            "vip_type":providers::uint(&profile["vipType"])});
        self.challenge_sent = None;
        Ok(result)
    }
}

fn phone_number(form: &Value) -> Result<(&str, &str, [u8; 32])> {
    let phone = required(form, "phone", 5, 15)?;
    let country = required(form, "countrycode", 1, 4)?;
    ensure!(
        phone.bytes().all(|byte| byte.is_ascii_digit())
            && country.bytes().all(|byte| byte.is_ascii_digit())
            && !country.starts_with('0'),
        "请输入数字手机号和区号"
    );
    ensure!(
        country != "86" || phone.len() == 11 && phone.starts_with('1'),
        "中国大陆手机号须为 11 位数字"
    );
    let mut hasher = Sha256::new();
    hasher.update(PHONE_SALT.as_bytes());
    hasher.update(country);
    hasher.update([0]);
    hasher.update(phone);
    Ok((phone, country, hasher.finalize().into()))
}

fn verification(reply: &Value) -> Option<Value> {
    let code = text(&reply["code"]);
    matches!(code.as_str(), "163" | "415" | "8821" | "-462").then(|| {
        status(
            "verification_required",
            "网易云要求额外安全验证，请在官方客户端完成后重试",
        )
    })
}

async fn we(transport: &Transport, route: &str, mut payload: Value) -> Result<Value> {
    let csrf = transport.cookie(MUSIC, "__csrf");
    payload["csrf_token"] = json!(csrf);
    let request =
        providers::netease::we_request(&transport.client, route, &Account::default(), payload)
            .query(&[
                ("csrf_token", csrf),
                ("timestamp", timestamp_ms().to_string()),
            ]);
    request_json(request).await
}
