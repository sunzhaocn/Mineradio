mod kugou;
mod music_qr;
mod netease;
mod qq;
mod soda;
mod wechat;

use crate::accounts::Provider;
use anyhow::{Context, Result, ensure};
use base64::{Engine, engine::general_purpose::STANDARD};
use reqwest::cookie::{CookieStore, Jar};
use serde_json::{Value, json};
use std::collections::{BTreeMap, HashMap};
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tokio::sync::Mutex;
use url::Url;
use uuid::Uuid;

const MAX_SESSIONS: usize = 32;
const MAX_UPSTREAM: usize = 2 * 1024 * 1024;
const POLL: Duration = Duration::from_secs(2);

#[derive(Default)]
pub struct Auth {
    sessions: Arc<Mutex<HashMap<(String, Provider), Entry>>>,
    sms_attempts: Mutex<HashMap<[u8; 32], Instant>>,
}

struct Entry {
    key: String,
    until: Instant,
    state: Arc<Mutex<Session>>,
}

struct Session {
    result: Value,
    transport: Transport,
    flow: Flow,
    after: Instant,
}

enum Flow {
    Phone(netease::Phone),
    Qq(qq::Login),
    MusicQr(music_qr::Login),
    WeChat(wechat::Login),
    Kugou(kugou::Login),
    Soda(soda::Login),
}

struct Transport {
    client: reqwest::Client,
    jar: Arc<Jar>,
}

impl Transport {
    fn new(provider: Provider) -> Result<Self> {
        let jar = Arc::new(Jar::default());
        let redirects = reqwest::redirect::Policy::custom(move |request| {
            let allowed = match provider {
                Provider::Netease => safe_host(
                    request.url(),
                    &[
                        "music.163.com",
                        "reg.163.com",
                        "dl.reg.163.com",
                        "id.163.com",
                        "dun.163.com",
                    ],
                ),
                Provider::Qishui => soda::allowed(request.url()),
                _ => false,
            };
            if allowed && request.previous().len() < 4 {
                request.follow()
            } else {
                request.stop()
            }
        });
        let client = reqwest::Client::builder()
            .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36")
            .cookie_provider(Arc::clone(&jar)).redirect(redirects)
            .connect_timeout(Duration::from_secs(7)).timeout(Duration::from_secs(16))
            .build()?;
        Ok(Self { client, jar })
    }

    fn cookies(&self, address: &str) -> BTreeMap<String, String> {
        let url = Url::parse(address).expect("fixed cookie origin");
        let value = self.jar.cookies(&url);
        value
            .as_ref()
            .and_then(|header| header.to_str().ok())
            .unwrap_or_default()
            .split(';')
            .filter_map(|pair| pair.trim().split_once('='))
            .filter(|(name, value)| valid_cookie(name, value))
            .map(|(name, value)| (name.to_owned(), value.to_owned()))
            .collect()
    }

    fn cookie(&self, address: &str, name: &str) -> String {
        self.cookies(address).remove(name).unwrap_or_default()
    }
}

impl Auth {
    pub async fn handle(&self, operation: &str, payload: &Value) -> Result<Value> {
        let provider = payload["provider"]
            .as_str()
            .and_then(Provider::parse)
            .context("请选择有效的登录平台")?;
        let owner = required(payload, "client_id", 32, 128)?;
        ensure!(safe_id(owner), "登录窗口标识无效");
        let identity = (owner.to_owned(), provider);
        if operation == "logout" {
            let previous = self.sessions.lock().await.remove(&identity);
            if let Some(previous) = previous
                && let Flow::Soda(login) = &mut previous.state.lock().await.flow
            {
                login.close().await;
            }
            return Ok(
                json!({"provider":provider.name(),"status":"logged_out","authorized":false}),
            );
        }
        if operation == "session" {
            return self
                .begin(identity, payload["method"].as_str().unwrap_or_default())
                .await;
        }
        let key = required(payload, "key", 32, 128)?;
        ensure!(safe_id(key), "登录会话标识无效");
        let Some((until, active)) = self.find(&identity, key).await else {
            return Ok(status("expired", "登录会话已结束，请重新开始"));
        };
        let mut active = active.lock().await;
        ensure!(
            self.find(&identity, key).await.is_some(),
            "已创建新的登录会话"
        );
        let now = Instant::now();
        if active.result["authorized"] == true {
            return Ok(active.result.clone());
        }
        if until <= now {
            return Ok(status("expired", "登录会话已过期，请重新开始"));
        }
        if active.result["status"] == "expired"
            || active.result["status"] == "verification_required"
        {
            return Ok(active.result.clone());
        }
        let session = &mut *active;
        let updated = match (&mut session.flow, operation) {
            (Flow::Phone(_), "check") => session.result.clone(),
            (Flow::Qq(login), "check") => {
                if now < session.after {
                    return Ok(session.result.clone());
                }
                session.after = now + POLL;
                login.poll(&session.transport).await?
            }
            (Flow::WeChat(login), "check") => {
                if now < session.after {
                    return Ok(session.result.clone());
                }
                session.after = now + POLL;
                login.poll(&session.transport).await?
            }
            (Flow::MusicQr(login), "check") => login.poll(&session.transport).await?,
            (Flow::Kugou(login), "check") => {
                if now < session.after {
                    return Ok(session.result.clone());
                }
                session.after = now + POLL;
                login.poll(&session.transport).await?
            }
            (Flow::Soda(login), "check") => {
                if now < session.after {
                    return Ok(session.result.clone());
                }
                session.after = now + Duration::from_secs(3);
                login.poll(&session.transport).await?
            }
            (Flow::Phone(phone), "sms") => phone.sms(self, &session.transport, payload).await?,
            (Flow::Phone(phone), "login") => phone.login(&session.transport, payload).await?,
            _ => anyhow::bail!("当前平台不支持此登录操作"),
        };
        {
            let mut sessions = self.sessions.lock().await;
            let entry = sessions
                .get_mut(&identity)
                .filter(|entry| entry.key == key)
                .context("已创建新的登录会话")?;
            if updated["verification_required"] == true
                && session.result["verification_required"] != true
            {
                entry.until = Instant::now() + Duration::from_secs(600);
            }
        }
        session.result = updated;
        session.result["provider"] = json!(provider.name());
        Ok(session.result.clone())
    }

    async fn find(
        &self,
        identity: &(String, Provider),
        key: &str,
    ) -> Option<(Instant, Arc<Mutex<Session>>)> {
        let sessions = self.sessions.lock().await;
        let entry = sessions.get(identity)?;
        (entry.key == key).then(|| (entry.until, Arc::clone(&entry.state)))
    }

    async fn begin(&self, identity: (String, Provider), method: &str) -> Result<Value> {
        let provider = identity.1;
        let transport = Transport::new(provider)?;
        let (flow, lifetime) = match (provider, method) {
            (Provider::Netease, "" | "phone" | "sms" | "password") => {
                (Flow::Phone(netease::Phone::default()), 600)
            }
            (Provider::Qq, "" | "qq") => (Flow::Qq(qq::Login::default()), 180),
            (Provider::Qq, "wechat") => (Flow::WeChat(wechat::Login::default()), 180),
            (Provider::Qq, "mobile") => (Flow::MusicQr(music_qr::Login::default()), 180),
            (Provider::Kugou, "" | "qr") => (Flow::Kugou(kugou::Login::new()), 180),
            (Provider::Qishui, "" | "qr") => (Flow::Soda(soda::Login::new()), 180),
            _ => anyhow::bail!("此登录方式暂不可用，可在此处粘贴该平台的 Cookie"),
        };
        let state = Arc::new(Mutex::new(Session {
            transport,
            flow,
            result: status("waiting", "正在创建登录会话"),
            after: Instant::now(),
        }));
        let key = Uuid::new_v4().simple().to_string();
        let mut locked = state.lock().await;
        {
            let mut sessions = self.sessions.lock().await;
            let now = Instant::now();
            sessions.retain(|_, entry| entry.until + Duration::from_secs(20) > now);
            ensure!(
                sessions.contains_key(&identity) || sessions.len() < MAX_SESSIONS,
                "登录会话过多，请稍后重试"
            );
            sessions.insert(
                identity.clone(),
                Entry {
                    key: key.clone(),
                    until: now + Duration::from_secs(lifetime),
                    state: Arc::clone(&state),
                },
            );
        }
        let session = &mut *locked;
        let result = match &mut session.flow {
            Flow::Phone(_) => Ok(status(
                "waiting",
                "请输入已有网易云账号的手机号，使用密码或短信验证码登录",
            )),
            Flow::Qq(login) => login.create(&session.transport).await,
            Flow::WeChat(login) => login.create(&session.transport).await,
            Flow::MusicQr(login) => login.create(&session.transport).await,
            Flow::Kugou(login) => login.create(&session.transport).await,
            Flow::Soda(login) => login.create(&session.transport).await,
        };
        let result = match result {
            Ok(result) => result,
            Err(error) => {
                let mut sessions = self.sessions.lock().await;
                if sessions
                    .get(&identity)
                    .is_some_and(|entry| entry.key == key)
                {
                    sessions.remove(&identity);
                }
                return Err(error);
            }
        };
        ensure!(
            self.find(&identity, &key).await.is_some(),
            "已创建新的登录会话"
        );
        session.result = result;
        session.result["provider"] = json!(provider.name());
        let lifetime = session.result["expires_in"]
            .as_u64()
            .filter(|ttl| (1..=900).contains(ttl))
            .unwrap_or(lifetime);
        {
            let mut sessions = self.sessions.lock().await;
            if let Some(entry) = sessions.get_mut(&identity).filter(|entry| entry.key == key) {
                entry.until = Instant::now() + Duration::from_secs(lifetime);
            }
        }
        if provider == Provider::Qishui {
            self.expire_browser(identity, key.clone());
        }
        let mut response = session.result.clone();
        response["key"] = json!(key);
        response["expires_in"] = json!(lifetime);
        response["expires_at"] = json!(timestamp_ms() / 1000 + u128::from(lifetime));
        response["poll_interval"] = json!(POLL.as_secs());
        Ok(response)
    }

    fn expire_browser(&self, identity: (String, Provider), key: String) {
        let sessions = Arc::downgrade(&self.sessions);
        tokio::spawn(async move {
            loop {
                let deadline = if let Some(sessions) = sessions.upgrade() {
                    sessions
                        .lock()
                        .await
                        .get(&identity)
                        .filter(|entry| entry.key == key)
                        .map(|entry| entry.until)
                } else {
                    None
                };
                let Some(deadline) = deadline else {
                    return;
                };
                tokio::time::sleep_until(deadline.into()).await;
                let Some(sessions) = sessions.upgrade() else {
                    return;
                };
                let state = sessions
                    .lock()
                    .await
                    .get(&identity)
                    .filter(|entry| entry.key == key)
                    .map(|entry| Arc::clone(&entry.state));
                let Some(state) = state else {
                    return;
                };
                let mut state = state.lock().await;
                let mut table = sessions.lock().await;
                let Some(entry) = table.get(&identity).filter(|entry| entry.key == key) else {
                    return;
                };
                if entry.until > Instant::now() {
                    continue;
                }
                table.remove(&identity);
                drop(table);
                if let Flow::Soda(login) = &mut state.flow {
                    login.close().await;
                }
                return;
            }
        });
    }

    async fn reserve_sms(&self, fingerprint: [u8; 32]) -> Option<u64> {
        let mut attempts = self.sms_attempts.lock().await;
        let now = Instant::now();
        attempts.retain(|_, until| *until > now);
        if let Some(until) = attempts.get(&fingerprint) {
            return Some((*until - now).as_secs() + 1);
        }
        if attempts.len() >= 128 {
            return Some(60);
        }
        attempts.insert(fingerprint, now + Duration::from_secs(60));
        None
    }
}

fn safe_id(input: &str) -> bool {
    input
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
}

fn required<'a>(values: &'a Value, field: &str, minimum: usize, maximum: usize) -> Result<&'a str> {
    values[field]
        .as_str()
        .filter(|value| (minimum..=maximum).contains(&value.len()))
        .context("登录请求资料不完整或格式错误")
}

fn valid_cookie(name: &str, value: &str) -> bool {
    !name.is_empty()
        && name.len() <= 128
        && name
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
        && !value.is_empty()
        && value.len() <= 8192
        && value
            .bytes()
            .all(|byte| (33..=126).contains(&byte) && byte != b';')
}

fn safe_host(url: &Url, allowed: &[&str]) -> bool {
    url.scheme() == "https"
        && url.port_or_known_default() == Some(443)
        && url.username().is_empty()
        && url.password().is_none()
        && url.host_str().is_some_and(|host| allowed.contains(&host))
}

fn timestamp_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

fn status(kind: &str, message: &str) -> Value {
    json!({"status":kind,"message":message,"authorized":kind == "authorized"})
}

fn cookie_header(values: BTreeMap<String, String>) -> String {
    values
        .into_iter()
        .map(|(name, value)| format!("{name}={value}"))
        .collect::<Vec<_>>()
        .join("; ")
}

async fn bytes(mut reply: reqwest::Response) -> Result<Vec<u8>> {
    ensure!(
        reply
            .content_length()
            .is_none_or(|count| count <= MAX_UPSTREAM as u64),
        "登录响应过大"
    );
    let mut result = Vec::new();
    while let Some(piece) = reply.chunk().await? {
        ensure!(result.len() + piece.len() <= MAX_UPSTREAM, "登录响应过大");
        result.extend_from_slice(&piece);
    }
    Ok(result)
}

fn image_data(body: &[u8]) -> Result<String> {
    let mime = if body.starts_with(b"\x89PNG\r\n\x1a\n") {
        "image/png"
    } else if body.starts_with(b"\xff\xd8\xff") {
        "image/jpeg"
    } else if body.starts_with(b"GIF87a") || body.starts_with(b"GIF89a") {
        "image/gif"
    } else {
        anyhow::bail!("平台没有返回二维码图片")
    };
    Ok(format!("data:{mime};base64,{}", STANDARD.encode(body)))
}

fn qr_image(url: &Url) -> Result<String> {
    let code = qrcode::QrCode::new(url.as_str().as_bytes())?;
    let scale = 5;
    let quiet = 4;
    let size = ((code.width() + quiet * 2) * scale) as u32;
    let mut out = image::GrayImage::from_pixel(size, size, image::Luma([255]));
    for (index, color) in code.to_colors().into_iter().enumerate() {
        if color == qrcode::Color::Light {
            continue;
        }
        let left = ((index % code.width() + quiet) * scale) as u32;
        let top = ((index / code.width() + quiet) * scale) as u32;
        for y in top..top + scale as u32 {
            for x in left..left + scale as u32 {
                out.put_pixel(x, y, image::Luma([0]));
            }
        }
    }
    let mut png = std::io::Cursor::new(Vec::new());
    out.write_to(&mut png, image::ImageFormat::Png)?;
    image_data(png.get_ref())
}
