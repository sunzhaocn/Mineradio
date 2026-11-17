use crate::accounts::{Accounts, Provider};
use crate::media::parse_platform_media;
use crate::providers::{first_text, kugou, netease, object_rows, qq};
use anyhow::{Result, ensure};
use sha2::{Digest, Sha256};
use std::collections::VecDeque;
use std::time::{Duration, Instant};
use tokio::sync::Mutex;

type Resolved = (Provider, String);

struct Entry {
    key: [u8; 32],
    expires: Instant,
    result: Resolved,
}

#[derive(Default)]
pub struct MusicVideos(Mutex<VecDeque<Entry>>);

fn normalize(value: &str) -> String {
    value
        .chars()
        .filter(|letter| letter.is_alphanumeric() || *letter == '_')
        .flat_map(char::to_lowercase)
        .collect()
}

async fn url(
    client: &reqwest::Client,
    accounts: &Accounts,
    platform: Provider,
    id: &str,
    resolution: u32,
) -> String {
    let account = accounts.account(platform);
    let result = match platform {
        Provider::Netease => netease::music_video(client, id, resolution, &account).await,
        Provider::Qq => qq::music_video(client, id, resolution, &account).await,
        Provider::Kugou => kugou::music_video(client, id, resolution, &account).await,
        Provider::Qishui => return String::new(),
    };
    result
        .ok()
        .and_then(|value| {
            let mut url = parse_platform_media(&value)?;
            // The KuGou legacy MV CDN may issue an HTTP-only URL. The local
            // streaming handler does not send account headers to media CDNs.
            if url.scheme() == "http" && platform != Provider::Kugou {
                url.set_scheme("https").ok()?;
            }
            Some(url.to_string())
        })
        .unwrap_or_default()
}

impl MusicVideos {
    pub async fn resolve(
        &self,
        client: &reqwest::Client,
        accounts: &Accounts,
        platform: Provider,
        id: &str,
        title: &str,
        artist: &str,
        resolution: u32,
    ) -> Result<Resolved> {
        ensure!(
            !id.is_empty()
                && id.len() <= 128
                && id
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_')),
            "MV 歌曲标识无效"
        );
        let title = title.trim().chars().take(200).collect::<String>();
        let artist = artist.trim().chars().take(200).collect::<String>();
        let mut hasher = Sha256::new();
        hasher.update(
            serde_json::json!([platform.name(), id, title, artist, resolution]).to_string(),
        );
        for provider in Provider::ALL {
            hasher.update(accounts.scope(provider));
        }
        let key: [u8; 32] = hasher.finalize().into();
        {
            let mut entries = self.0.lock().await;
            entries.retain(|entry| entry.expires > Instant::now());
            if let Some(entry) = entries.iter().find(|entry| entry.key == key) {
                return Ok(entry.result.clone());
            }
        }
        let mut actual = platform;
        let mut media = url(client, accounts, platform, id, resolution).await;
        let normalized_title = normalize(&title);
        let normalized_artist = normalize(&artist);
        if media.is_empty() && !normalized_title.is_empty() && !normalized_artist.is_empty() {
            let keyword = format!("{title} {artist}");
            for candidate in [Provider::Netease, Provider::Qq]
                .into_iter()
                .filter(|candidate| *candidate != platform)
            {
                let account = accounts.account(candidate);
                let search = match candidate {
                    Provider::Netease => netease::search(client, &keyword, 3, 0, &account).await,
                    _ => qq::search(client, &keyword, 3, 0, &account).await,
                };
                let Ok(search) = search else { continue };
                for track in object_rows(search.get("tracks").unwrap_or(&search["songs"])).take(3) {
                    let name = first_text(&[&track["name"], &track["title"]]);
                    let singer = first_text(&[&track["artist"], &track["author"]]);
                    if normalize(&name) != normalized_title
                        || normalize(&singer) != normalized_artist
                    {
                        continue;
                    }
                    let song_id = first_text(&[&track["mid"], &track["id"]]);
                    if song_id.is_empty() {
                        continue;
                    }
                    media = url(client, accounts, candidate, &song_id, resolution).await;
                    if !media.is_empty() {
                        actual = candidate;
                        break;
                    }
                }
                if !media.is_empty() {
                    break;
                }
            }
        }
        let expires = Instant::now() + Duration::from_secs(if media.is_empty() { 60 } else { 300 });
        let result = (actual, media);
        let mut entries = self.0.lock().await;
        entries.retain(|entry| entry.key != key);
        entries.push_front(Entry {
            key,
            expires,
            result: result.clone(),
        });
        entries.truncate(256);
        Ok(result)
    }
}
