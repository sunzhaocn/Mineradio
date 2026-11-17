use super::{comments, get, hex_md5, https, login_fields, valid_hash};
use crate::accounts::Account;
use crate::providers::{code, first_text, numeric_id, object_rows, request_json, text, uint};
use anyhow::{Context, Result, ensure};
use reqwest::header::{COOKIE, REFERER, USER_AGENT};
use serde_json::{Value, json};
use std::collections::BTreeMap;

const SONGS: &str = "/openapi/kmr/v2/audio_group/author";
const PAGE_SIZE: usize = 50;

async fn request(
    client: &reqwest::Client,
    route: &str,
    body: Value,
    account: &Account,
) -> Result<Value> {
    let origin = format!("https://gateway.kugou.com{route}");
    let uptime = time::OffsetDateTime::now_utc().unix_timestamp().to_string();
    let (device, dfid) = comments::device(account);
    let (token, user) = login_fields(account);
    let mut query = BTreeMap::from([
        ("dfid", dfid.to_owned()),
        ("mid", device.to_owned()),
        ("uuid", "-".into()),
        ("appid", "1005".into()),
        ("clientver", "20489".into()),
        ("clienttime", uptime.clone()),
    ]);
    if !token.is_empty() {
        query.insert("token", token);
    }
    if numeric_id(&user).is_ok() {
        query.insert("userid", user);
    }
    let popular = route == SONGS;
    let content = if popular {
        query.extend(
            body.as_object()
                .context("酷狗查询参数无效")?
                .iter()
                .map(|(key, value)| (key.as_str(), text(value))),
        );
        String::new()
    } else {
        body.to_string()
    };
    let fields = query
        .iter()
        .map(|(key, value)| format!("{key}={value}"))
        .collect::<String>();
    let salt = comments::SALT;
    query.insert(
        "signature",
        hex_md5(format!("{salt}{fields}{content}{salt}")),
    );
    let flag = match route {
        "/kmr/v3/author" | SONGS => "36",
        "/kmr/v2/audio" => "238",
        _ => "255",
    };
    let mut request = if popular {
        client.get(origin)
    } else {
        client
            .post(origin)
            .header("x-router", "openapi.kugou.com")
            .body(content)
    };
    request = request
        .query(&query)
        .header("content-type", "application/json")
        .header("kg-tid", flag)
        .header("mid", device)
        .header("dfid", dfid)
        .header("clienttime", uptime)
        .header(REFERER, "https://www.kugou.com/")
        .header(
            USER_AGENT,
            "Android15-1070-11083-46-0-DiscoveryDRADProtocol-wifi",
        );
    if account.configured() {
        request = request.header(COOKIE, &account.cookie);
    }
    let data = request_json(request).await?;
    ensure!(
        code(&data["status"], 1)
            && ["error_code", "errcode"]
                .iter()
                .all(|key| data[*key].is_null() || code(&data[*key], 0)),
        "酷狗资料暂不可读取"
    );
    Ok(data)
}

fn cover(raw: &Value) -> String {
    https(text(raw).replace("{size}", "480"))
}

fn authors(raw: &Value) -> Vec<Value> {
    object_rows(&raw["authors"])
        .filter_map(|row| {
            let base = row.get("base").unwrap_or(row);
            let id = first_text(&[&base["author_id"], &base["id"]]);
            let name = first_text(&[&base["author_name"], &base["name"]]);
            (!name.is_empty()).then(|| json!({"id":id,"name":name}))
        })
        .collect()
}

fn row_song(row: &Value, detail: &Value, for_album: bool) -> Result<Value> {
    let base = row.get("base").unwrap_or(row);
    let audio = &row["audio_info"];
    let hash = first_text(&[&audio["hash"], &audio["hash_128"]]);
    let id = text(&base["album_audio_id"]);
    let name = text(&base["audio_name"]);
    ensure!(
        !name.is_empty() && (valid_hash(&hash) || numeric_id(&id).is_ok()),
        "酷狗返回无效曲目"
    );
    let refs = authors(row);
    let names = refs
        .iter()
        .filter_map(|item| item["name"].as_str())
        .collect::<Vec<_>>();
    let artist = if names.is_empty() {
        first_text(&[
            &base["author_name"],
            &detail[if for_album { "artist" } else { "name" }],
        ])
    } else {
        names.join(" / ")
    };
    let info = &row["album_info"];
    let album_id = first_text(&[
        &base["album_id"],
        if for_album {
            &detail["id"]
        } else {
            &Value::Null
        },
    ]);
    ensure!(
        !for_album || album_id == text(&detail["id"]),
        "酷狗返回了其他专辑的曲目"
    );
    let image = first_text(&[
        &info["cover"],
        &row["trans_param"]["union_cover"],
        &detail["cover"],
    ]);
    let duration = uint(audio.get("duration").unwrap_or(&audio["timelength"]));
    Ok(
        json!({"id":if hash.is_empty(){&id}else{&hash},"hash":hash,"name":name,"artist":artist,"artists":refs,
        "artistId":refs.first().map(|row|row["id"].clone()),"album":first_text(&[&info["album_name"],
        if for_album{&detail["name"]}else{&Value::Null}]),"albumId":album_id,"cover":cover(&json!(image)),
        "albumAudioId":id,"mixSongId":id,"duration":duration as f64/1000.0,"durationMs":duration,
        "provider":"kugou","source":"kugou","type":"song"}),
    )
}

pub async fn detail(
    client: &reqwest::Client,
    id: &str,
    offset: usize,
    limit: usize,
    for_album: bool,
    account: &Account,
) -> Result<Value> {
    numeric_id(id)?;
    let mut descriptor = if for_album {
        let metadata=request(client,"/kmr/v2/albums",json!({"data":[{"album_id":id}],"is_buy":0,
            "fields":"album_id,album_name,publish_date,sizable_cover,intro,type,authors,author_name,publish_company"}),account).await?;
        let row = object_rows(&metadata["data"])
            .find(|row| text(&row["album_id"]) == id)
            .context("酷狗专辑资料不完整")?;
        let refs = authors(row);
        let artists = refs
            .iter()
            .filter_map(|row| row["name"].as_str())
            .collect::<Vec<_>>();
        let author = if artists.is_empty() {
            text(&row["author_name"])
        } else {
            artists.join(" / ")
        };
        json!({"id":id,"albumId":id,"name":text(&row["album_name"]),"artist":author,"artists":artists,
            "cover":cover(&row["sizable_cover"]),"description":text(&row["intro"]),"publish_time":text(&row["publish_date"]),
            "company":text(&row["publish_company"]),"type":text(&row["type"])})
    } else {
        let metadata = request(client, "/kmr/v3/author", json!({"author_id":id}), account).await?;
        let raw = &metadata["data"];
        ensure!(text(&raw["author_id"]) == id, "酷狗歌手资料不完整");
        let avatar = raw.get("sizable_avatar").unwrap_or(&raw["avatar"]);
        let aliases = raw.get("alias").unwrap_or(&raw["author_alias"]);
        let alias = aliases
            .as_array()
            .map(|rows| rows.iter().map(text).collect::<Vec<_>>())
            .unwrap_or_else(|| aliases.as_str().map(str::to_owned).into_iter().collect());
        json!({"id":id,"name":text(&raw["author_name"]),"avatar":cover(avatar),
            "description":text(&raw["intro"]),"alias":alias})
    };
    ensure!(!text(&descriptor["name"]).is_empty(), "酷狗资料缺少名称");
    let mut next = offset;
    let mut tracks = Vec::new();
    let mut total = None;
    while tracks.len() < limit {
        let page = next / PAGE_SIZE + 1;
        let response = if for_album {
            request(
                client,
                "/v1/album_audio/lite",
                json!({"album_id":id,"is_buy":"","page":page,"pagesize":PAGE_SIZE}),
                account,
            )
            .await?
        } else {
            request(client,SONGS,json!({"author_id":id,"area_code":"all","sort":1,"page":page,"pagesize":PAGE_SIZE,
                "replace_api_version":1,"mvdata_need":1,"show_audio_honor":1,"show_audio_tag":1,"replace_need":1}),account).await?
        };
        let data = &response["data"];
        let count = text(data.get("total").unwrap_or(&response["total"]))
            .parse::<usize>()
            .context("酷狗未返回曲目总数")?;
        ensure!(
            total.is_none_or(|old| old == count),
            "酷狗目录已变化，请重新读取"
        );
        total = Some(count);
        let songs = data["songs"].as_array().context("酷狗曲目列表不完整")?;
        let expected = count.saturating_sub((page - 1) * PAGE_SIZE).min(PAGE_SIZE);
        ensure!(songs.len() == expected, "酷狗曲目分页不完整");
        for row in songs
            .iter()
            .skip(next % PAGE_SIZE)
            .take(limit - tracks.len())
        {
            tracks.push(row_song(row, &descriptor, for_album)?);
        }
        next = offset + tracks.len();
        if next >= count {
            break;
        }
    }
    let total = total.unwrap_or(0);
    descriptor[if for_album { "total" } else { "song_count" }] = json!(total);
    Ok(
        json!({"ok":true,"provider":"kugou",(if for_album{"album"}else{"artist"}):descriptor,"songs":tracks,
       "total":total,"nextOffset":next,"hasMore":next<total,"scope":"hot"}),
    )
}

pub async fn references(
    client: &reqwest::Client,
    song: &str,
    account: &Account,
) -> Result<(String, Vec<Value>)> {
    let native = if numeric_id(song).is_ok() || valid_hash(song) {
        comments::native_song(client, song, "", account).await?
    } else {
        ensure!(
            (4..=12).contains(&song.len()) && song.bytes().all(|byte| byte.is_ascii_alphanumeric()),
            "酷狗歌曲标识无效"
        );
        let page = get(
            client,
            &format!("https://www.kugou.com/mixsong/{song}.html"),
            account,
        )
        .send()
        .await?
        .error_for_status()?
        .text()
        .await?;
        let source = page
            .split_once("var dataFromSmarty")
            .context("酷狗未返回原曲目标识")?
            .1
            .trim_start()
            .strip_prefix('=')
            .context("酷狗歌曲资料格式无效")?
            .trim_start();
        let rows = serde_json::Deserializer::from_str(source)
            .into_iter::<Value>()
            .next()
            .transpose()?
            .context("酷狗未返回原曲目标识")?;
        let native = object_rows(&rows)
            .find(|row| row["encode_album_audio_id"] == song)
            .map(|row| text(&row["mixsongid"]))
            .context("酷狗未返回原曲目标识")?;
        numeric_id(&native)?;
        native
    };
    let response = request(
        client,
        "/kmr/v2/audio",
        json!({"data":[{"entity_id":numeric_id(&native)?}],
        "fields":"base,authors.base"}),
        account,
    )
    .await?;
    let raw = object_rows(&response["data"])
        .find(|row| text(&row["base"]["album_audio_id"]) == native)
        .context("酷狗未返回原曲目所属专辑及歌手")?;
    Ok((text(&raw["base"]["album_id"]), authors(raw)))
}
