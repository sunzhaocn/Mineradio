use crate::accounts::{Account, Provider};
use anyhow::{Context, Result, ensure};
use futures_util::StreamExt;
use serde::Serialize;
use serde_json::{Value, json};

pub mod kugou;
pub mod netease;
pub mod qishui;
pub mod qq;

pub async fn request_json(request: reqwest::RequestBuilder) -> Result<Value> {
    const LIMIT: usize = 8 * 1024 * 1024;
    let response = request.send().await?.error_for_status()?;
    ensure!(
        response
            .content_length()
            .is_none_or(|length| length <= LIMIT as u64),
        "平台响应过长"
    );
    let mut stream = response.bytes_stream();
    let mut data = Vec::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk?;
        ensure!(data.len() + chunk.len() <= LIMIT, "平台响应过长");
        data.extend_from_slice(&chunk);
    }
    Ok(serde_json::from_slice(&data)?)
}

pub fn first_text(values: &[&Value]) -> String {
    values
        .iter()
        .map(|value| text(value))
        .find(|value| !value.is_empty())
        .unwrap_or_default()
}

pub fn lrc_line(milliseconds: u64, text: &str) -> String {
    format!(
        "[{:02}:{:02}.{:03}]{}",
        milliseconds / 60_000,
        milliseconds / 1_000 % 60,
        milliseconds % 1_000,
        text
    )
}

#[derive(Serialize, Clone)]
pub struct Quality {
    pub key: String,
    pub quality: String,
    pub available: bool,
    pub downloadable: bool,
    pub source_available: bool,
    pub encrypted: bool,
    pub decryption_supported: bool,
    pub encode: String,
    pub bitrate: u64,
    pub filesize: u64,
    pub kind: String,
    pub url: String,
    #[serde(skip)]
    pub protected: Option<crate::protected_audio::Source>,
}

impl Quality {
    pub fn unavailable(key: &str, label: &str) -> Self {
        Self {
            key: key.to_owned(),
            quality: label.to_owned(),
            available: false,
            downloadable: false,
            source_available: false,
            encrypted: false,
            decryption_supported: false,
            encode: String::new(),
            bitrate: 0,
            filesize: 0,
            kind: String::new(),
            url: String::new(),
            protected: None,
        }
    }
}

pub struct ResolvedTrack {
    pub song: Value,
    pub qualities: Vec<Quality>,
}

pub fn text(value: &Value) -> String {
    if let Some(text) = value.as_str() {
        text.to_owned()
    } else if value.is_number() {
        value.to_string()
    } else {
        String::new()
    }
}

pub fn uint(value: &Value) -> u64 {
    value
        .as_u64()
        .or_else(|| value.as_str()?.parse().ok())
        .unwrap_or(0)
}

pub fn object_rows(value: &Value) -> impl Iterator<Item = &Value> {
    value
        .as_array()
        .into_iter()
        .flatten()
        .filter(|value| value.is_object())
}

pub fn code(value: &Value, expected: u64) -> bool {
    value.as_u64() == Some(expected)
        || value
            .as_str()
            .is_some_and(|str| str.parse() == Ok(expected))
}

pub fn numeric_id(value: &str) -> Result<u64> {
    ensure!(
        !value.is_empty() && value.bytes().all(|byte| byte.is_ascii_digit()),
        "歌曲标识无效"
    );
    let id = value.parse::<u64>().context("歌曲标识无效")?;
    ensure!(id > 0, "歌曲标识无效");
    Ok(id)
}

pub fn sign_in_status(account: &Account, valid: Option<bool>) -> Value {
    let configured = account.configured();
    let expired = configured && valid == Some(false);
    json!({
        "configured": configured,
        "loggedIn": configured && !expired,
        "authState": match valid { Some(true) => "valid", Some(false) if expired => "expired", _ => "unknown" },
        "verified": valid == Some(true),
        "reauthRequired": expired,
        "checkFailed": configured && valid.is_none(),
    })
}

pub fn search_result(
    provider: Provider,
    songs: Vec<Value>,
    limit: usize,
    offset: usize,
    total: Option<u64>,
) -> Value {
    let next_offset = offset.saturating_add(songs.len());
    json!({
        "songs": songs, "provider": provider.name(), "limit": limit, "offset": offset, "nextOffset": next_offset,
        "hasMore": total.map_or(songs.len() >= limit, |total| (next_offset as u64) < total && !songs.is_empty()),
        "total": total,
    })
}

pub fn quality_name(provider: Provider, raw: &str) -> String {
    let value = raw.trim().to_ascii_lowercase();
    match (provider, value.as_str()) {
        (_, "" | "best") => "auto".into(),
        (Provider::Netease, "128" | "128k") => "standard".into(),
        (Provider::Netease, "192" | "192k" | "high") => "higher".into(),
        (Provider::Netease, "320" | "320k") => "exhigh".into(),
        (Provider::Netease, "sq" | "flac") => "lossless".into(),
        (Provider::Qq | Provider::Kugou, "standard") => "128".into(),
        (Provider::Qq | Provider::Kugou, "exhigh") => "320".into(),
        (Provider::Qq, "lossless" | "sq") => "flac".into(),
        (Provider::Kugou, "lossless" | "flac") => "sq".into(),
        (Provider::Qishui, "standard") => "medium".into(),
        (Provider::Qishui, "128") => "higher".into(),
        (Provider::Qishui, "320") => "highest".into(),
        (Provider::Qishui, "flac" | "sq") => "lossless".into(),
        _ => value,
    }
}

pub fn select_quality<'a>(
    qualities: &'a [Quality],
    requested: &str,
    fallback: bool,
) -> Option<&'a Quality> {
    if requested == "auto" {
        return qualities.iter().find(|row| row.available);
    }
    let index = qualities.iter().position(|row| row.key == requested)?;
    if fallback {
        qualities.get(index..)?.iter().find(|row| row.available)
    } else {
        qualities.get(index).filter(|row| row.available)
    }
}
