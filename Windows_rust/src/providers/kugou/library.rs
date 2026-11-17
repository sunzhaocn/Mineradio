use super::{
    Account, first_text, hex_md5, https, login_fields, object_rows, request_json, sign_body, text,
    uint, valid_hash,
};
use anyhow::{Context, Result, ensure};
use serde_json::{Value, json};
use std::collections::{BTreeMap, HashSet};
use std::time::{SystemTime, UNIX_EPOCH};

const WIDTH: usize = 50;

struct CloudAccount {
    id: u64,
    token: String,
    mid: String,
    dfid: String,
}

impl CloudAccount {
    fn new(account: &Account) -> Result<Self> {
        let (web_token, user) = login_fields(account);
        let id = crate::providers::numeric_id(&user)?;
        let token = ["token", "Token"]
            .into_iter()
            .find_map(|key| account.field(key))
            .unwrap_or(&web_token)
            .trim_matches(['\'', '"'])
            .to_string();
        ensure!(!token.is_empty(), "请先登录酷狗");
        let mid = ["kg_mid", "KG_MID", "mid"]
            .into_iter()
            .find_map(|key| account.field(key))
            .map_or_else(|| hex_md5(format!("mineradio-kugou:{id}")), str::to_owned);
        let dfid = ["kg_dfid", "KG_DFID", "dfid"]
            .into_iter()
            .find_map(|key| account.field(key))
            .unwrap_or("-")
            .to_owned();
        Ok(Self {
            id,
            token,
            mid,
            dfid,
        })
    }
}

async fn gateway(
    client: &reqwest::Client,
    route: &str,
    body: Value,
    extra: &[(&str, String)],
    access: &CloudAccount,
    account: &Account,
) -> Result<Value> {
    let now = SystemTime::now().duration_since(UNIX_EPOCH)?;
    let mut params = BTreeMap::from([
        ("srcappid", "2919".to_string()),
        ("clientver", "20000".into()),
        ("clienttime", now.as_millis().to_string()),
        ("mid", access.mid.clone()),
        ("uuid", access.mid.clone()),
        ("dfid", access.dfid.clone()),
        ("appid", "1014".into()),
        ("token", access.token.clone()),
        ("userid", access.id.to_string()),
        ("plat", "1".into()),
    ]);
    params.extend(extra.iter().cloned());
    let bytes = serde_json::to_vec(&body)?;
    let reply = request_json(
        client
            .post(format!("https://gateway.kugou.com{route}"))
            .query(&sign_body(params, &bytes))
            .body(bytes)
            .header("content-type", "application/json")
            .header("cookie", &account.cookie)
            .header("referer", "https://www.kugou.com/")
            .header("x-router", "cloudlist.service.kugou.com"),
    )
    .await?;
    ensure!(
        crate::providers::code(&reply["status"], 1) && uint(&reply["error_code"]) == 0,
        "酷狗未接受歌单请求"
    );
    let data = reply["data"].clone();
    ensure!(data.is_object(), "酷狗歌单数据不完整");
    Ok(data)
}

fn identifier(value: &str) -> Result<u64> {
    let key = if let Some(rest) = value.strip_prefix("collection_") {
        rest.split('_').nth(2).context("酷狗歌单编号无效")?
    } else {
        value
    };
    crate::providers::numeric_id(key)
}

fn list(item: &Value, initial_kind: &str) -> Result<Value> {
    let raw_id = first_text(&[
        &item["listid"],
        &item["list_id"],
        &item["global_collection_id"],
        &item["list_create_listid"],
        &item["specialid"],
        &item["id"],
    ]);
    let id = identifier(&raw_id)?.to_string();
    let name = first_text(&[
        &item["name"],
        &item["listname"],
        &item["specialname"],
        &item["title"],
    ]);
    ensure!(!name.trim().is_empty(), "酷狗歌单缺少名称");
    let liked = initial_kind == "liked"
        || uint(&item["is_def"]) == 2
        || initial_kind != "collected" && uint(&item["type"]) != 1 && name.contains("我喜欢");
    let kind = if liked { "liked" } else { initial_kind };
    let editable = kind != "collected" && uint(&item["type"]) != 1;
    let cover = https(first_text(&[
        &item["pic"],
        &item["img"],
        &item["imgurl"],
        &item["sizable_cover"],
    ]))
    .replace("{size}", "240");
    let count = field_number(
        item,
        &["count", "m_count", "song_count", "total", "list_count"],
    )
    .unwrap_or_default();
    Ok(
        json!({"id":id,"name":name,"kind":kind,"cover":cover,"provider":"kugou","isLiked":liked,
        "trackCount":count,"editable":editable,"canAdd":editable,"canRemove":editable}),
    )
}

fn field_number(data: &Value, keys: &[&str]) -> Option<usize> {
    keys.iter().find_map(|key| text(&data[*key]).parse().ok())
}

fn batch(data: &Value) -> Result<Vec<(&Value, &'static str)>> {
    let contents = data.get("info").unwrap_or(data);
    if let Some(rows) = contents.as_array() {
        return Ok(rows
            .iter()
            .map(|row| {
                (
                    row,
                    if uint(&row["type"]) == 1 || uint(&row["is_def"]) == 1 {
                        "collected"
                    } else {
                        "created"
                    },
                )
            })
            .collect());
    }
    if contents.is_null() && field_number(data, &["list_count"]) == Some(0) {
        return Ok(Vec::new());
    }
    let mut rows = Vec::new();
    let mut loaded = false;
    for (key, kind) in [
        ("collect", "collected"),
        ("love", "liked"),
        ("self", "created"),
        ("list", "created"),
    ] {
        if let Some(items) = contents.get(key) {
            let items = items.as_array().context("酷狗歌单分组格式无效")?;
            loaded = true;
            rows.extend(items.iter().map(|row| (row, kind)));
        }
    }
    if data.get("info").is_some()
        && let Some(items) = data["list"].as_array()
    {
        loaded = true;
        rows.extend(items.iter().map(|row| (row, "created")));
    }
    ensure!(loaded, "酷狗未返回歌单资料");
    Ok(rows)
}

pub async fn playlists(client: &reqwest::Client, account: &Account) -> Result<Value> {
    let access = CloudAccount::new(account)?;
    let mut playlists = Vec::new();
    let mut seen = HashSet::new();
    for page in 1..=1000 {
        let response = gateway(client,"/v7/get_all_list",json!({
            "userid":access.id,"token":access.token,"total_ver":979,"type":2,"page":page,"pagesize":WIDTH
        }),&[],&access,account).await?;
        let batch = batch(&response)?;
        let batch_count = batch.len();
        let previous = playlists.len();
        for (item, kind) in batch {
            let row = list(item, kind)?;
            if seen.insert(text(&row["id"])) {
                playlists.push(row);
            }
        }
        let total = field_number(&response, &["total", "total_count", "list_count", "count"]);
        let more = response
            .get("has_more")
            .or_else(|| response.get("hasMore"))
            .and_then(|flag| {
                flag.as_bool()
                    .or_else(|| (!flag.is_null()).then(|| uint(flag) != 0))
            })
            .unwrap_or_else(|| total.map_or(batch_count >= WIDTH, |total| playlists.len() < total));
        if !more {
            ensure!(
                total.is_none_or(|total| playlists.len() >= total),
                "酷狗歌单目录分页不完整"
            );
            return Ok(json!({"playlists":playlists}));
        }
        ensure!(playlists.len() > previous, "酷狗歌单目录分页没有推进");
    }
    anyhow::bail!("酷狗歌单目录过大")
}

fn track(item: &Value) -> Result<Value> {
    let artist = object_rows(item.get("singerinfo").unwrap_or(&item["Singers"]))
        .map(|row| first_text(&[&row["name"], &row["SingerName"]]))
        .filter(|name| !name.is_empty())
        .collect::<Vec<_>>()
        .join(" / ");
    let artist = if artist.is_empty() {
        first_text(&[&item["SingerName"], &item["singer"]])
    } else {
        artist
    };
    let title = first_text(&[&item["name"], &item["SongName"], &item["filename"]]);
    let title = if let Some((name, extension)) = title.rsplit_once('.') {
        if matches!(
            extension.to_ascii_lowercase().as_str(),
            "mp3" | "flac" | "m4a" | "wav" | "ape" | "ogg"
        ) {
            name.to_owned()
        } else {
            title
        }
    } else {
        title
    };
    let name = title
        .strip_prefix(&artist)
        .map(|name| name.trim_start_matches([' ', '-', '–', '—']))
        .filter(|name| !name.is_empty())
        .unwrap_or(&title);
    let hash = first_text(&[&item["hash"], &item["FileHash"]]);
    let media_id = first_text(&[
        &item["mixsongid"],
        &item["MixSongID"],
        &item["album_audio_id"],
    ]);
    let id = if valid_hash(&hash) {
        hash.clone()
    } else {
        media_id.clone()
    };
    ensure!(!id.is_empty() && !name.is_empty(), "酷狗歌单曲目资料无效");
    let album = &item["albuminfo"];
    let cover = https(first_text(&[
        &item["cover"],
        &item["img"],
        &item["Image"],
        &item["trans_param"]["union_cover"],
    ]))
    .replace("{size}", "480");
    let duration = first_text(&[&item["duration"], &item["Duration"]])
        .parse::<f64>()
        .unwrap_or_else(|_| uint(&item["timelen"]) as f64 / 1000.);
    Ok(
        json!({"id":id,"hash":hash,"name":name,"artist":artist,"provider":"kugou","type":"song","source":"kugou",
        "album":first_text(&[&album["name"],&item["album_name"],&item["AlbumName"]]),
        "albumId":first_text(&[&album["id"],&item["album_id"],&item["AlbumID"]]),
        "cover":cover,"duration":duration,"mixSongId":media_id,"albumAudioId":media_id,
        "fileId":first_text(&[&item["fileid"],&item["file_id"]])}),
    )
}

pub async fn tracks(
    client: &reqwest::Client,
    id: &str,
    offset: usize,
    limit: usize,
    account: &Account,
) -> Result<Value> {
    let id = identifier(id)?;
    let access = CloudAccount::new(account)?;
    let mut position = offset;
    let mut tracks = Vec::new();
    let mut total = None;
    let mut more = false;
    while tracks.len() < limit {
        let (page, skip) = (position / WIDTH + 1, position % WIDTH);
        let response = gateway(
            client,
            "/v4/get_list_all_file",
            json!({
                "listid":id,"userid":access.id,"area_code":1,"show_relate_goods":0,"pagesize":WIDTH,
                "allplatform":1,"show_cover":1,"type":0,"token":access.token,"page":page
            }),
            &[],
            &access,
            account,
        )
        .await?;
        let elements = ["info", "songs", "lists", "file"]
            .into_iter()
            .find_map(|key| response[key].as_array())
            .or_else(|| response["info"]["file"].as_array());
        total = field_number(&response, &["count", "total", "total_count"]).or(total);
        let empty = Vec::new();
        let rows = elements
            .or_else(|| {
                (response.get("info").is_some_and(Value::is_null) && total == Some(0))
                    .then_some(&empty)
            })
            .context("酷狗歌单曲目列表无效")?;
        let before = tracks.len();
        for raw in rows.iter().skip(skip).take(limit - before) {
            tracks.push(track(raw)?);
        }
        position += tracks.len() - before;
        let received = (page - 1) * WIDTH + rows.len();
        more = total.map_or(rows.len() == WIDTH || received > position, |count| {
            position < count
        });
        if !more || tracks.len() == before || rows.len() < WIDTH {
            ensure!(
                total.is_none_or(|total| !more || received >= total || rows.len() == WIDTH),
                "酷狗歌单分页提前结束"
            );
            break;
        }
    }
    Ok(
        json!({"tracks":tracks,"total":total.or_else(||(!more).then_some(position)),"hasMore":more,"nextOffset":position}),
    )
}

pub async fn write(
    client: &reqwest::Client,
    list: &str,
    song: &Value,
    add: bool,
    existing: Option<&Value>,
    account: &Account,
) -> Result<()> {
    let list = identifier(list)?;
    let access = CloudAccount::new(account)?;
    let mut body =
        json!({"userid":access.id,"token":access.token,"listid":list,"list_ver":0,"type":0});
    if add {
        let name = text(&song["name"]);
        let hash = text(&song["hash"]).to_ascii_lowercase();
        ensure!(
            valid_hash(&hash) && (1..=1000).contains(&name.len()),
            "请选择有效的酷狗平台音源"
        );
        let duration_ms =
            (song["duration"].as_f64().unwrap_or_default().max(0.0) * 1000.0).round() as u64;
        body["slow_upload"] = json!(1);
        body["scene"] = json!("false;null");
        body["data"] = json!([{"number":1,"name":name,"hash":hash,"size":0,"sort":0,"timelen":duration_ms,
            "bitrate":0,"album_id":uint(&song["albumId"]),"mixsongid":uint(&song["mixSongId"]).max(uint(&song["albumAudioId"]))}]);
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)?
            .as_secs()
            .to_string();
        gateway(
            client,
            "/v6/add_song",
            body,
            &[("last_time", now), ("last_area", "gztx".into())],
            &access,
            account,
        )
        .await?;
    } else {
        let id = crate::providers::numeric_id(&text(
            &existing.context("酷狗未返回要移除的曲目资料")?["fileId"],
        ))?;
        body["data"] = json!([{"fileid":id}]);
        gateway(client, "/v4/delete_songs", body, &[], &access, account).await?;
    }
    Ok(())
}
