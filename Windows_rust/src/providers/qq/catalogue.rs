use super::{mid, rpc, song};
use crate::accounts::Account;
use crate::providers::{code, numeric_id, object_rows, text, uint};
use anyhow::{Context, Result, ensure};
use serde_json::{Value, json};

async fn read(
    client: &reqwest::Client,
    account: &Account,
    module: &str,
    method: &str,
    param: Value,
) -> Result<Value> {
    let value = rpc(
        client,
        &json!({"comm":{"ct":24,"cv":0},
        "req":{"module":module,"method":method,"param":param}}),
        account,
        15,
    )
    .await?;
    ensure!(
        code(&value["code"], 0)
            && code(&value["req"]["code"], 0)
            && value["req"]["data"].is_object(),
        "QQ 音乐资料暂不可读取"
    );
    Ok(value["req"]["data"].clone())
}

pub async fn album(
    client: &reqwest::Client,
    id: &str,
    offset: usize,
    limit: usize,
    account: &Account,
) -> Result<Value> {
    let params = match numeric_id(id) {
        Ok(id) => json!({"albumId":id}),
        _ => json!({"albumMid":mid(id)?}),
    };
    let detail = read(
        client,
        account,
        "music.musichallAlbum.AlbumInfoServer",
        "GetAlbumDetail",
        params,
    )
    .await?;
    let raw = &detail["basicInfo"];
    let code = text(&raw["albumID"]);
    let album_mid = mid(raw["albumMid"].as_str().unwrap_or_default())?;
    ensure!(id == album_mid || id == code, "QQ 音乐返回了其他专辑");
    let title = text(&raw["albumName"]);
    ensure!(!title.is_empty(), "QQ 音乐专辑资料缺少名称");
    let artists = object_rows(&detail["singer"]["singerList"])
        .filter_map(|row| row["name"].as_str())
        .collect::<Vec<_>>();
    let cover = format!("https://y.gtimg.cn/music/photo_new/T002R500x500M000{album_mid}.jpg");
    let mut tracks = Vec::new();
    let mut total = None;
    while tracks.len() < limit {
        let start = offset + tracks.len();
        let size = 100.min(limit - tracks.len());
        let page=read(client,account,"music.musichallAlbum.AlbumSongList","GetAlbumSongList",
            json!({"albumMid":album_mid,"albumID":numeric_id(&code)?,"begin":start,"num":size,"order":2})).await?;
        let count = text(&page["totalNum"])
            .parse::<usize>()
            .context("QQ 音乐未返回专辑歌曲总数")?;
        ensure!(
            total.is_none_or(|old| old == count),
            "QQ 音乐专辑已变化，请重新读取"
        );
        total = Some(count);
        let rows = page["songList"]
            .as_array()
            .context("QQ 音乐未返回专辑曲目")?;
        ensure!(
            rows.len() <= size && (start >= count || !rows.is_empty()),
            "QQ 音乐专辑分页无效"
        );
        for row in rows {
            let source = row.get("songInfo").unwrap_or(row);
            let mut track = song(row);
            ensure!(track["id"] != "", "QQ 音乐专辑包含无效曲目");
            if text(&track["albumId"]).is_empty() {
                track["albumId"] = json!(code);
            }
            if text(&track["albumMid"]).is_empty() {
                track["albumMid"] = json!(album_mid);
            }
            if text(&track["cover"]).is_empty() {
                track["cover"] = json!(cover);
            }
            if let Some(number) = source.get("index_album") {
                track["track_number"] = number.clone();
            }
            if let Some(disc) = source.get("index_cd") {
                track["disc"] = json!(uint(disc) + 1);
            }
            tracks.push(track);
        }
        if start + rows.len() >= count {
            break;
        }
    }
    let total = total.unwrap_or(0);
    let next = offset + tracks.len();
    Ok(
        json!({"ok":true,"provider":"qq","album":{"id":code,"mid":album_mid,"albumId":code,"albumMid":album_mid,
        "name":title,"artist":artists.join(" / "),"artists":artists,"cover":cover,"description":text(&raw["desc"]),
        "publish_time":text(&raw["publishDate"]),"company":text(&detail["company"]["name"]),
        "type":text(&raw["albumType"]),"total":total},"songs":tracks,"total":total,"nextOffset":next,"hasMore":next<total}),
    )
}

async fn artist_page(
    client: &reqwest::Client,
    id: &str,
    offset: usize,
    limit: usize,
    account: &Account,
) -> Result<Value> {
    let mut params = match numeric_id(id) {
        Ok(id) => json!({"singerId":id}),
        _ => json!({"singerMid":mid(id)?}),
    };
    params["begin"] = json!(offset);
    params["num"] = json!(limit);
    params["order"] = json!(1);
    read(
        client,
        account,
        "musichall.song_list_server",
        "GetSingerSongList",
        params,
    )
    .await
}

pub async fn artist(
    client: &reqwest::Client,
    id: &str,
    offset: usize,
    limit: usize,
    account: &Account,
) -> Result<Value> {
    let first = artist_page(client, id, offset, limit.min(50), account).await?;
    let singer = mid(first["singerMid"].as_str().unwrap_or_default())?.to_owned();
    let profile = read(
        client,
        account,
        "music.musichallSinger.SingerInfoInter",
        "GetSingerDetail",
        json!({"singer_mids":[singer],"wiki_singer":1,"ex_singer":1,"group_singer":0}),
    )
    .await?;
    let detail = object_rows(&profile["singer_list"])
        .find(|row| row["basic_info"]["singer_mid"] == singer)
        .context("QQ 音乐歌手资料不完整")?;
    let basic = &detail["basic_info"];
    let native = text(&basic["singer_id"]);
    ensure!(native == id || singer == id, "QQ 音乐返回了其他歌手");
    let total = text(&first["totalNum"])
        .parse::<usize>()
        .context("QQ 音乐未返回歌手歌曲总数")?;
    let mut tracks = Vec::new();
    let mut page = first;
    loop {
        ensure!(
            uint(&page["totalNum"]) == total as u64 && page["singerMid"] == singer,
            "QQ 音乐歌手分页已变化"
        );
        let rows = page["songList"]
            .as_array()
            .context("QQ 音乐未返回歌手曲目")?;
        for row in rows.iter().take(limit.saturating_sub(tracks.len())) {
            let track = song(row);
            ensure!(track["id"] != "", "QQ 音乐歌手包含无效曲目");
            tracks.push(track);
        }
        let next = offset + tracks.len();
        if tracks.len() >= limit || next >= total {
            break;
        }
        ensure!(!rows.is_empty(), "QQ 音乐歌手分页停止推进");
        page = artist_page(client, &singer, next, 50.min(limit - tracks.len()), account).await?;
    }
    let extra = &detail["ex_info"];
    let alias = text(&extra["foreign_name"]);
    let next = offset + tracks.len();
    Ok(
        json!({"ok":true,"provider":"qq","artist":{"id":native,"mid":singer,"name":text(&basic["name"]),
        "avatar":format!("https://y.gtimg.cn/music/photo_new/T001R500x500M000{singer}.jpg"),
        "description":text(&extra["desc"]),"alias":if alias.is_empty(){Vec::new()}else{vec![alias]},"song_count":total},
        "total":total,"songs":tracks,"hasMore":next<total,"nextOffset":next,"scope":"hot"}),
    )
}
