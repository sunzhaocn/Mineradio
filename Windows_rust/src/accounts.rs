use crate::profile::Profile;
use anyhow::{Context, Result, ensure};
use axum::http::HeaderMap;
use futures_util::StreamExt;
use serde_json::{Map, Value};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, HashMap};
use std::time::{Duration, Instant};
use tokio::sync::Mutex;

const SERVER_URL: &str = "https://music.hbsuzh.cn/api/server-account/v1/credentials";
const MAX_SERVER_BYTES: usize = 65_536;
const MAX_COOKIE_BYTES: usize = 65_536;

#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum Provider {
    Netease,
    Qq,
    Kugou,
    Qishui,
}

impl Provider {
    pub const ALL: [Self; 4] = [Self::Netease, Self::Qq, Self::Kugou, Self::Qishui];

    pub fn parse(value: &str) -> Option<Self> {
        match value.trim().to_ascii_lowercase().as_str() {
            "netease" | "ne" | "163" | "wy" | "网易" | "网易云" | "网易云音乐" => {
                Some(Self::Netease)
            }
            "qq" | "qqmusic" | "qqm" | "tx" | "tencent" | "腾讯" | "qq音乐" => Some(Self::Qq),
            "kugou" | "kg" | "kgmusic" | "酷狗" | "酷狗音乐" => Some(Self::Kugou),
            "qishui" | "soda" | "汽水" | "汽水音乐" => Some(Self::Qishui),
            _ => None,
        }
    }

    pub fn name(self) -> &'static str {
        match self {
            Self::Netease => "netease",
            Self::Qq => "qq",
            Self::Kugou => "kugou",
            Self::Qishui => "qishui",
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Self::Netease => "网易云音乐",
            Self::Qq => "QQ 音乐",
            Self::Kugou => "酷狗音乐",
            Self::Qishui => "汽水音乐",
        }
    }
}

#[derive(Clone, Default)]
pub struct Account {
    pub cookie: String,
    pub session_config: Option<Value>,
}

impl Account {
    pub fn configured(&self) -> bool {
        !self.cookie.is_empty() || self.session_config.is_some()
    }

    pub fn field(&self, key: &str) -> Option<&str> {
        self.cookie
            .split(';')
            .filter_map(|field| field.trim().split_once('='))
            .find_map(|(name, value)| (name.trim() == key).then(|| value.trim()))
            .filter(|value| !value.is_empty())
    }
}

#[derive(Clone, Default)]
pub struct Accounts(BTreeMap<Provider, Account>);

impl Accounts {
    fn parse(value: &Value) -> Result<Self> {
        let object = value.as_object().context("账号资料格式错误")?;
        let mut accounts = BTreeMap::new();
        for (key, record) in object {
            let Some(provider) = Provider::parse(key) else {
                continue;
            };
            let mut account = if let Some(cookie) = record.as_str() {
                Account {
                    cookie: clean_cookie(cookie)?,
                    session_config: None,
                }
            } else {
                let record = record.as_object().context("账号资料格式错误")?;
                let cookie = record
                    .get("cookie")
                    .map(|value| clean_cookie(value.as_str().context("Cookie 格式错误")?))
                    .transpose()?
                    .unwrap_or_default();
                let session = record
                    .get("session_config")
                    .or_else(|| record.get("session"));
                Account {
                    cookie,
                    session_config: session_config(provider, session)?,
                }
            };
            if account.cookie.is_empty() {
                if let Some(cookie) = account
                    .session_config
                    .as_ref()
                    .and_then(|value| value.pointer("/headers/cookie"))
                    .and_then(Value::as_str)
                {
                    account.cookie = clean_cookie(cookie)?;
                }
            }
            if account.configured() {
                accounts.insert(provider, account);
            }
        }
        Ok(Self(accounts))
    }

    pub fn account(&self, provider: Provider) -> Account {
        self.0.get(&provider).cloned().unwrap_or_default()
    }

    pub fn qishui_needs_device(&self) -> bool {
        self.0.get(&Provider::Qishui).is_some_and(|entry| {
            !entry.cookie.is_empty()
                && entry
                    .session_config
                    .as_ref()
                    .and_then(|data| data.pointer("/query/device_id"))
                    .is_none_or(|field| crate::providers::text(field).is_empty())
        })
    }

    pub fn set_qishui_device(&mut self, device: &str, install: &str) {
        let Some(account) = self.0.get_mut(&Provider::Qishui) else {
            return;
        };
        let mut supplemental = crate::providers::qishui::desktop_query(device, install);
        let headers = if let Some(session) = account.session_config.take() {
            if let Some(custom) = session["query"].as_object() {
                let parameters = supplemental.as_object_mut().expect("desktop parameters");
                for (key, value) in custom {
                    if !crate::providers::text(value).is_empty() {
                        parameters.insert(key.clone(), value.clone());
                    }
                }
            }
            session["headers"].clone()
        } else {
            Value::Null
        };
        account.session_config = Some(serde_json::json!({"query":supplemental,"headers":headers}));
    }

    pub fn scope(&self, provider: Provider) -> [u8; 32] {
        let mut hash = Sha256::new();
        if let Some(entry) = self.0.get(&provider) {
            hash.update(provider.name());
            hash.update([0]);
            hash.update(&entry.cookie);
            hash.update([0]);
            if let Some(config) = &entry.session_config {
                hash.update(config.to_string());
            }
            hash.update([0]);
        }
        hash.finalize().into()
    }

    pub fn local(
        headers: &HeaderMap,
        query: &HashMap<String, String>,
        provider: Provider,
    ) -> Result<Self> {
        let read = |header, param| {
            headers
                .get(header)
                .and_then(|value| value.to_str().ok())
                .or_else(|| query.get(param).map(String::as_str))
        };
        let mut result = match read("x-music-credentials", "credentials") {
            Some(content) if !content.is_empty() => {
                ensure!(content.len() <= 4 * MAX_COOKIE_BYTES, "账号资料过长");
                Self::parse(&serde_json::from_str(content)?)?
            }
            _ => Self::default(),
        };
        let cookie = read("x-music-cookie", "cookie").or_else(|| {
            (!result.0.contains_key(&provider))
                .then(|| headers.get("cookie").and_then(|value| value.to_str().ok()))
                .flatten()
        });
        let session = read("x-music-session", "session_config");
        if cookie.is_some() || session.is_some() {
            let mut entry = result.0.remove(&provider).unwrap_or_default();
            if let Some(cookie) = cookie {
                entry.cookie = clean_cookie(cookie)?;
            }
            if let Some(session) = session {
                entry.session_config =
                    session_config(provider, Some(&serde_json::from_str(session)?))?;
            }
            if entry.configured() {
                result.0.insert(provider, entry);
            }
        }
        Ok(result)
    }
}

fn clean_cookie(raw: &str) -> Result<String> {
    let raw = raw.trim();
    ensure!(
        raw.len() <= MAX_COOKIE_BYTES && !raw.chars().any(char::is_control),
        "Cookie 格式错误"
    );
    Ok(
        if raw
            .get(..7)
            .is_some_and(|prefix| prefix.eq_ignore_ascii_case("cookie:"))
        {
            raw[7..].trim().to_owned()
        } else {
            raw.to_owned()
        },
    )
}

fn session_config(provider: Provider, value: Option<&Value>) -> Result<Option<Value>> {
    let Some(value) = value.filter(|value| !value.is_null() && provider == Provider::Qishui) else {
        return Ok(None);
    };
    ensure!(
        value.is_object() && value["query"].is_object(),
        "汽水会话格式错误"
    );
    let mut headers = Map::new();
    if let Some(source) = value.get("headers") {
        for (key, raw) in source.as_object().context("汽水会话格式错误")? {
            let name = key.to_ascii_lowercase();
            if matches!(
                name.as_str(),
                "cookie"
                    | "user-agent"
                    | "x-luna-background-type"
                    | "x-luna-is-background-req"
                    | "x-luna-is-local-user"
            ) {
                headers.insert(
                    name,
                    Value::String(clean_cookie(raw.as_str().context("汽水会话格式错误")?)?),
                );
            }
        }
    }
    let query = value["query"].as_object().expect("validated above");
    for (key, item) in query {
        ensure!(
            key.len() <= 128 && !key.chars().any(char::is_control),
            "汽水会话参数无效"
        );
        let valid = item
            .as_str()
            .map_or(item.is_number() || item.is_boolean(), |text| {
                text.len() <= 4096 && !text.chars().any(char::is_control)
            });
        ensure!(valid, "汽水会话参数无效");
    }
    Ok(Some(
        serde_json::json!({"query": query, "headers": headers}),
    ))
}

#[derive(Clone)]
pub struct ServerSnapshot {
    pub accounts: Accounts,
    pub revision: String,
}

impl ServerSnapshot {
    fn empty(revision: &str) -> Self {
        Self {
            accounts: Accounts::default(),
            revision: revision.to_owned(),
        }
    }
}

struct Cache {
    key: String,
    next: Instant,
    snapshot: ServerSnapshot,
}

pub struct ServerAccounts {
    profile: Profile,
    cache: Mutex<Cache>,
}

impl ServerAccounts {
    pub fn new(profile: Profile) -> Self {
        Self {
            profile,
            cache: Mutex::new(Cache {
                key: String::new(),
                next: Instant::now(),
                snapshot: ServerSnapshot::empty("empty"),
            }),
        }
    }

    pub async fn read(&self, client: &reqwest::Client) -> ServerSnapshot {
        let mut cache = self.cache.lock().await;
        let key = tokio::fs::read_to_string(self.profile.device_key())
            .await
            .unwrap_or_default();
        let key = key.trim();
        if cache.key != key {
            cache.key = key.to_owned();
            cache.next = Instant::now();
            cache.snapshot = ServerSnapshot::empty("empty");
        }
        if !(43..=128).contains(&key.len())
            || !key
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
            || cache.next > Instant::now()
        {
            return cache.snapshot.clone();
        }
        let (snapshot, seconds) = match Self::download(client, key).await {
            Ok(snapshot) => (snapshot, 30),
            Err(_) => (ServerSnapshot::empty("unavailable"), 8),
        };
        cache.next = Instant::now() + Duration::from_secs(seconds);
        cache.snapshot = snapshot.clone();
        snapshot
    }

    async fn download(client: &reqwest::Client, key: &str) -> Result<ServerSnapshot> {
        let response = client
            .get(SERVER_URL)
            .bearer_auth(key)
            .timeout(Duration::from_secs(4))
            .send()
            .await?;
        ensure!(
            response.status() == reqwest::StatusCode::OK,
            "账号服务器暂不可用"
        );
        ensure!(
            response.content_length().unwrap_or_default() <= MAX_SERVER_BYTES as u64,
            "账号资料过长"
        );
        let mut stream = response.bytes_stream();
        let mut body = Vec::new();
        while let Some(chunk) = stream.next().await {
            let chunk = chunk?;
            ensure!(body.len() + chunk.len() <= MAX_SERVER_BYTES, "账号资料过长");
            body.extend_from_slice(&chunk);
        }
        let data: Value = serde_json::from_slice(&body)?;
        let accounts = Accounts::parse(&data["credentials"])?;
        let revision = data["revision"]
            .as_str()
            .unwrap_or_default()
            .chars()
            .take(64)
            .collect();
        Ok(ServerSnapshot { accounts, revision })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn legacy_aliases_and_request_overrides_use_distinct_scopes() {
        let mut headers = HeaderMap::new();
        headers.insert(
            "x-music-credentials",
            r#"{"qqmusic":{"cookie":"uin=7; qm_keyst=example"}}"#
                .parse()
                .unwrap(),
        );
        let accounts = Accounts::local(&headers, &HashMap::new(), Provider::Qq).unwrap();
        assert_eq!(accounts.account(Provider::Qq).field("uin"), Some("7"));
        headers.insert("x-music-cookie", "uin=8; qm_keyst=other".parse().unwrap());
        let changed = Accounts::local(&headers, &HashMap::new(), Provider::Qq).unwrap();
        assert_eq!(changed.account(Provider::Qq).field("uin"), Some("8"));
        assert_ne!(accounts.scope(Provider::Qq), changed.scope(Provider::Qq));
    }
}
