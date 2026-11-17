use crate::accounts::{Account, Accounts, Provider};
use crate::providers::{
    code, first_text, kugou, netease, numeric_id, object_rows, qishui, qq, request_json, text, uint,
};
use anyhow::{Context, Result, ensure};
use regex::Regex;
use serde_json::{Map, Value, json};
use std::collections::HashSet;
use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;
use std::sync::LazyLock;
use std::time::Duration;

static EXCLUDED: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
    r"(?i)说唱|嘻哈|hip[\s-]?hop|\brap\b|有声|听书|小说|评书|相声|脱口秀|广播剧|播客|audiobooks?|podcasts?|spoken[\s-]?word|故事榜|儿童故事|MV榜|视频榜|歌手榜|艺人榜|专辑榜"
).expect("chart exclusion pattern")
});
const QQ_MODULE: &str = "musicToplist.ToplistInfoServer";
const PAGE: usize = 100;

fn cover(url: String) -> String {
    url.replace("{size}", "400")
        .replacen("http://", "https://", 1)
}

fn selection(
    platform: Provider,
    id: &str,
    name: &str,
    image: String,
    count: u64,
    desc: String,
) -> Value {
    let source = if platform == Provider::Qq {
        "qqmusic"
    } else {
        platform.name()
    };
    json!({"id":format!("chart:{source}:{id}"),"name":name,"cover":cover(image),"trackCount":count,"description":desc,
        "creator":platform.label(),"provider":"mineradio","source":"mineradio","kind":"chart","builtin":true,"readonly":true,"shelfPane":"mine"})
}

async fn qq_data(
    client: &reqwest::Client,
    method: &str,
    params: Value,
    account: &Account,
) -> Result<Value> {
    let reply = qq::rpc(
        client,
        &json!({"comm":{"ct":24,"cv":0},"req_1":{"module":QQ_MODULE,
        "method":method,"param":params}}),
        account,
        12,
    )
    .await?;
    ensure!(code(&reply["req_1"]["code"], 0), "QQ 音乐榜单暂不可读取");
    Ok(reply["req_1"]["data"].clone())
}

fn kugou_rows(rows: &Value, cards: &mut Vec<Value>, depth: u8) {
    if depth > 6 {
        return;
    }
    for row in object_rows(rows).take(500) {
        let id = text(&row["rankid"]);
        let name = text(&row["rankname"]);
        if numeric_id(&id).is_ok() && !name.is_empty() && !EXCLUDED.is_match(&name) {
            cards.push(selection(
                Provider::Kugou,
                &id,
                &name,
                first_text(&[&row["img_cover"], &row["imgurl"], &row["banner7url"]]),
                uint(&row["extra"]["resp"]["all_total"]),
                text(&row["intro"]),
            ));
        }
        kugou_rows(&row["children"], cards, depth + 1);
    }
}

async fn catalog(
    client: &reqwest::Client,
    platform: Provider,
    account: &Account,
) -> Result<Vec<Value>> {
    let mut charts = Vec::new();
    match platform {
        Provider::Netease => {
            let data = netease::web_get(client, "/api/toplist/detail", &[], account).await?;
            ensure!(
                code(&data["code"], 200) && data["list"].is_array(),
                "网易云榜单暂不可读取"
            );
            for row in object_rows(&data["list"]) {
                let name = text(&row["name"]);
                let id = text(&row["id"]);
                if name.is_empty() || EXCLUDED.is_match(&name) || numeric_id(&id).is_err() {
                    continue;
                }
                charts.push(selection(
                    platform,
                    &id,
                    &name,
                    text(&row["coverImgUrl"]),
                    uint(&row["trackCount"]),
                    text(&row["description"]),
                ));
            }
        }
        Provider::Qq => {
            let data = qq_data(client, "GetAll", json!({}), account).await?;
            ensure!(data["group"].is_array(), "QQ 音乐未返回榜单");
            for group in object_rows(&data["group"]) {
                for row in object_rows(&group["toplist"]) {
                    let id = text(&row["topId"]);
                    let name = text(&row["title"]);
                    if name.is_empty()
                        || EXCLUDED.is_match(&format!("{name} {}", text(&group["groupName"])))
                        || numeric_id(&id).is_err()
                    {
                        continue;
                    }
                    charts.push(selection(
                        platform,
                        &id,
                        &name,
                        first_text(&[&row["frontPicUrl"], &row["headPicUrl"]]),
                        uint(&row["totalNum"]),
                        text(&row["intro"]),
                    ));
                }
            }
        }
        Provider::Kugou => {
            let reply = request_json(
                kugou::get(
                    client,
                    "https://mobiles.kugou.com/api/v3/rank/list",
                    account,
                )
                .query(&[
                    ("version", "9108"),
                    ("plat", "0"),
                    ("showtype", "2"),
                    ("withsong", "0"),
                ]),
            )
            .await?;
            ensure!(
                code(&reply["status"], 1) && reply["data"]["info"].is_array(),
                "酷狗榜单暂不可读取"
            );
            kugou_rows(&reply["data"]["info"], &mut charts, 0);
        }
        Provider::Qishui => {
            let data = qishui::accepted(
                qishui::signed_read(client, "discover", &[], Some(json!({})), account).await?,
            )?;
            ensure!(data["blocks"].is_array(), "汽水音乐未返回榜单");
            for group in
                object_rows(&data["blocks"]).filter(|row| row["type"] == "discover_top_song_list")
            {
                for row in object_rows(&group["inner_block"])
                    .filter(|row| row["type"] == "discover_track_top_list")
                {
                    let id = text(&row["inner_block_id"]);
                    let title = text(&row["title"]);
                    if id.is_empty()
                        || id.len() > 80
                        || title.is_empty()
                        || EXCLUDED.is_match(&title)
                    {
                        continue;
                    }
                    let resources = row["resources"].as_array().map_or(0, Vec::len);
                    let image = object_rows(&row["resources"])
                        .find_map(|value| {
                            qishui::normalized_track(&value["entity"]["ranked_track"]["track"])
                        })
                        .map_or_else(String::new, |track| text(&track["cover"]));
                    charts.push(selection(
                        platform,
                        &id,
                        &title,
                        image,
                        resources as u64,
                        text(&row["desc"]),
                    ));
                }
            }
        }
    }
    let mut seen = HashSet::new();
    charts.retain(|row| seen.insert(text(&row["id"])));
    Ok(charts)
}

pub async fn list(client: &reqwest::Client, accounts: &Accounts) -> Value {
    let results =
        futures_util::future::join_all(Provider::ALL.into_iter().map(|platform| async move {
            catalog(client, platform, &accounts.account(platform)).await
        }))
        .await;
    let partial = results.iter().any(std::result::Result::is_err);
    let playlists = results
        .into_iter()
        .filter_map(std::result::Result::ok)
        .flatten()
        .collect::<Vec<_>>();
    json!({"ok":true,"playlists":playlists,"partial":partial})
}

fn kugou_song(row: &Value) -> Value {
    let file = row["filename"].as_str().unwrap_or_default();
    let (singer, title) = file.split_once(" - ").unwrap_or(("", file));
    let artist = object_rows(&row["authors"])
        .filter_map(|author| author["author_name"].as_str())
        .collect::<Vec<_>>();
    let id = first_text(&[&row["album_audio_id"], &row["mixsongid"]]);
    json!({"id":text(&row["hash"]),"hash":text(&row["hash"]),"provider":"kugou","source":"kugou","type":"song",
        "name":row["songname"].as_str().filter(|name|!name.is_empty()).unwrap_or(title),
        "artist":if artist.is_empty(){singer.to_owned()}else{artist.join(" / ")},
        "album":text(&row["album_name"]),"albumId":text(&row["album_id"]),"albumAudioId":id,"mixSongId":id,
        "duration":uint(&row["duration"]),"cover":cover(first_text(&[&row["album_sizable_cover"],&row["trans_param"]["union_cover"]]))})
}

pub async fn tracks(
    client: &reqwest::Client,
    accounts: &Accounts,
    id: &str,
    offset: usize,
    limit: usize,
) -> Result<Value> {
    let mut parts = id.splitn(3, ':');
    ensure!(parts.next() == Some("chart"), "榜单标识无效");
    let platform = parts
        .next()
        .and_then(Provider::parse)
        .context("榜单平台无效")?;
    let key = parts
        .next()
        .filter(|key| {
            !key.is_empty()
                && key.len() <= 80
                && key
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
        })
        .context("榜单标识无效")?;
    let account = accounts.account(platform);
    if platform == Provider::Netease {
        return netease::playlist_tracks(client, key, offset, limit, &account).await;
    }
    let mut page_rows = Vec::new();
    let total = match platform {
        Provider::Qq => {
            let top = numeric_id(key)?;
            let mut total = 0;
            while page_rows.len() < limit {
                let start = offset + page_rows.len();
                let result = qq_data(
                    client,
                    "GetDetail",
                    json!({"topId":top,"offset":start,
                    "num":PAGE.min(limit-page_rows.len())}),
                    &account,
                )
                .await?;
                let rows = result["songInfoList"]
                    .as_array()
                    .context("QQ 音乐未返回榜单歌曲")?;
                total = uint(&result["data"]["totalNum"]).max((start + rows.len()) as u64) as usize;
                page_rows.extend(rows.iter().map(qq::song));
                if rows.is_empty() || offset + page_rows.len() >= total {
                    break;
                }
            }
            total
        }
        Provider::Kugou => {
            numeric_id(key)?;
            let mut total = 0;
            let mut period = String::new();
            while page_rows.len() < limit {
                let begin = offset + page_rows.len();
                let mut query = vec![
                    ("rankid", key.to_owned()),
                    ("page", (begin / PAGE + 1).to_string()),
                    ("pagesize", PAGE.to_string()),
                    ("plat", "0".into()),
                    ("version", "9108".into()),
                ];
                if !period.is_empty() {
                    query.push(("rank_cid", period.clone()));
                }
                let reply = request_json(
                    kugou::get(
                        client,
                        "https://mobiles.kugou.com/api/v3/rank/song",
                        &account,
                    )
                    .query(&query),
                )
                .await?;
                ensure!(code(&reply["status"], 1), "酷狗榜单暂不可读取");
                let data = &reply["data"];
                let rows = data["info"].as_array().context("酷狗未返回榜单歌曲")?;
                total = uint(&data["total"]) as usize;
                if period.is_empty() {
                    period = text(&data["info"][0]["rank_cid"]);
                }
                let start = page_rows.len();
                page_rows.extend(
                    rows.iter()
                        .skip(begin % PAGE)
                        .take(limit - start)
                        .map(kugou_song),
                );
                if page_rows.len() == start || offset + page_rows.len() >= total {
                    break;
                }
            }
            total
        }
        Provider::Qishui => {
            let data = qishui::accepted(
                qishui::signed_read(client, &format!("charts/{key}"), &[], None, &account).await?,
            )?;
            let chart = &data["chart"];
            ensure!(text(&chart["id"]) == key, "汽水返回了其他榜单");
            let rows = chart["track_ranks"]
                .as_array()
                .context("汽水未返回榜单歌曲")?;
            page_rows.extend(
                rows.iter()
                    .skip(offset)
                    .take(limit)
                    .filter_map(|row| qishui::normalized_track(&row["track"])),
            );
            rows.len()
        }
        _ => unreachable!(),
    };
    let next = offset + page_rows.len();
    ensure!(next >= total || next > offset, "榜单分页停止推进");
    Ok(json!({"ok":true,"tracks":page_rows,"total":total,"nextOffset":next,"hasMore":next<total}))
}

pub async fn home(client: &reqwest::Client, accounts: &Accounts) -> Value {
    let results =
        futures_util::future::join_all(Provider::ALL.into_iter().map(|platform| async move {
            let work = async {
                let charts = catalog(client, platform, &accounts.account(platform)).await?;
                let count = charts.len().min(12);
                if count == 0 {
                    return Ok::<_, anyhow::Error>((Value::Null, Vec::new()));
                }
                let random = uuid::Uuid::new_v4().as_u128() as usize % count;
                let list = charts[random].clone();
                let id = list["id"].as_str().context("榜单标识无效")?;
                let result = tracks(client, accounts, id, 0, 15).await?;
                Ok((
                    list,
                    result["tracks"].as_array().cloned().unwrap_or_default(),
                ))
            };
            (
                platform,
                tokio::time::timeout(Duration::from_secs(6), work).await,
            )
        }))
        .await;
    let mut states = Map::new();
    let mut suggestions = Vec::new();
    let mut lists = Vec::new();
    let mut pending = Vec::new();
    let mut seen = HashSet::new();
    for (platform, result) in results {
        let timed_out = result.is_err();
        if timed_out {
            pending.push(platform.name());
        }
        if let Ok(Ok((list, songs))) = result {
            states.insert(
                platform.name().into(),
                json!({"complete":true,"ready":!songs.is_empty(),"pending":false}),
            );
            if !list.is_null() {
                lists.push(list);
            }
            for song in songs {
                let fingerprint = format!("{}|{}", text(&song["name"]), text(&song["artist"]))
                    .to_lowercase()
                    .chars()
                    .filter(|letter| !letter.is_whitespace())
                    .collect::<String>();
                if seen.insert(fingerprint) {
                    suggestions.push(song);
                }
            }
        } else {
            states.insert(
                platform.name().into(),
                json!({"complete":false,"ready":false,"pending":timed_out}),
            );
        }
    }
    suggestions.sort_by_cached_key(|_| uuid::Uuid::new_v4());
    let complete = states.values().all(|state| state["complete"] == true);
    let daily = suggestions.iter().take(30).collect::<Vec<_>>();
    json!({"loggedIn":false,"publicDiscovery":true,"mode":"charts","dailySongs":daily,
        "candidateSongs":suggestions,"playlists":lists,"podcasts":[],"complete":complete,"partial":!complete,
        "pendingPlatforms":pending,"platformStates":states,"updatedAt":time::OffsetDateTime::now_utc().unix_timestamp_nanos()/1_000_000})
}

pub fn radio_metadata(cache: &Path) -> Value {
    static FILE: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(
            r"^(?:request-v2_public_)?tracks_(netease|qqmusic|kugou|qishui)_[A-Za-z0-9_-]+\.json$",
        )
        .expect("legacy chart cache name")
    });
    let mut songs = BTreeMap::<String, BTreeSet<String>>::new();
    let mut artists = BTreeMap::<String, BTreeSet<String>>::new();
    let mut charts = BTreeSet::new();
    for path in std::fs::read_dir(cache)
        .into_iter()
        .flatten()
        .filter_map(std::result::Result::ok)
        .take(500)
    {
        if !path
            .file_name()
            .to_str()
            .is_some_and(|name| FILE.is_match(name))
            || !path
                .file_type()
                .is_ok_and(|kind| kind.is_file() && !kind.is_symlink())
        {
            continue;
        }
        let Ok(Some(chart)) = crate::profile::read_json::<Value>(&path.path()) else {
            continue;
        };
        if chart["complete"] != true {
            continue;
        }
        let details = &chart["chart"];
        let name = text(&details["name"]);
        if name.is_empty() || EXCLUDED.is_match(&format!("{name} {}", text(&details["category"]))) {
            continue;
        }
        charts.insert((text(&details["platform"]), text(&details["id"])));
        for song in object_rows(&chart["songs"]).take(10_000) {
            for source in object_rows(&song["sources"]) {
                let platform = text(&source["platform"]);
                let key = text(&source["key"]);
                if Provider::parse(&platform).is_some() && !key.is_empty() {
                    songs
                        .entry(format!("{platform}:{key}"))
                        .or_default()
                        .insert(name.clone());
                }
            }
            let aliases = song["artists"].as_array();
            for artist in aliases
                .into_iter()
                .flatten()
                .filter_map(Value::as_str)
                .chain(song["artist"].as_str().filter(|_| aliases.is_none()))
            {
                for word in artist
                    .split(['/', '、', ',', '&', '，'])
                    .map(str::trim)
                    .filter(|word| !word.is_empty())
                {
                    artists
                        .entry(word.to_owned())
                        .or_default()
                        .insert(name.clone());
                }
            }
        }
    }
    json!({"song_charts":songs,"artist_charts":artists,"songs_indexed":songs.len(),"charts_indexed":charts.len(),"complete":true})
}
