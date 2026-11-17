use crate::accounts::{Account, Accounts, Provider};
use crate::media::parse_platform_media;
use crate::providers::{
    code, first_text, kugou, netease, numeric_id, object_rows, qishui, qq, text, uint,
};
use anyhow::{Context, Result, ensure};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, VecDeque};
use std::time::{Duration, Instant};
use tokio::sync::Mutex;

pub struct Comments {
    state: Mutex<Cache>,
    changes: [Mutex<()>; 32],
}

#[derive(Default)]
struct Cache {
    targets: VecDeque<Target>,
    replies: VecDeque<Reply>,
}

struct Target {
    created: Instant,
    scope: [u8; 32],
    song: String,
    id: String,
    child: String,
    liked: bool,
    count: u64,
}

struct Reply {
    created: Instant,
    scope: [u8; 32],
    request: String,
    data: [u8; 32],
    response: Value,
}

impl Default for Comments {
    fn default() -> Self {
        Self {
            state: Mutex::default(),
            changes: std::array::from_fn(|_| Mutex::new(())),
        }
    }
}

fn flag(value: &Value) -> bool {
    value == true || code(value, 1)
}

fn strip(value: &Value) -> String {
    text(value)
        .chars()
        .filter(|character| !character.is_control() || matches!(*character, '\n' | '\t'))
        .take(8_000)
        .collect::<String>()
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&amp;", "&")
}

fn image(raw: &Value) -> String {
    let candidate = raw
        .as_str()
        .or_else(|| raw["url"].as_str())
        .or_else(|| raw["url_list"][0].as_str())
        .or_else(|| raw["urls"][0].as_str())
        .unwrap_or_default();
    if parse_platform_media(candidate).is_some() {
        candidate.replace("http://", "https://")
    } else {
        String::new()
    }
}

fn picture(raw: &Value) -> Option<Value> {
    let url = image(raw);
    (!url.is_empty()).then(|| json!({"url":url,"thumbnailUrl":url,"alt":"评论图片"}))
}

fn badge(label: &str, icon: &Value, kind: &str) -> Value {
    json!({"label":label,"iconUrl":image(icon),"type":kind})
}

fn normalize(platform: Provider, row: &Value, top_level: bool) -> Option<Value> {
    let (
        id,
        raw,
        likes,
        liked,
        timestamp,
        date,
        count,
        location,
        reply_rows,
        account,
        mut pictures,
        can_like,
    ) = match platform {
        Provider::Netease => {
            let user = &row["user"];
            let mut badges = Vec::new();
            for (tier, name) in [
                ("redplus", "黑胶 SVIP"),
                ("associator", "黑胶 VIP"),
                ("musicPackage", "音乐包"),
            ] {
                let value = &user["vipRights"][tier];
                if uint(&value["rights"]) > 0 {
                    badges.push(badge(name, &value["iconUrl"], "vip"));
                }
            }
            if badges.is_empty() && uint(&user["vipType"]) > 0 {
                badges.push(badge("VIP", &Value::Null, "vip"));
            }
            let identity_icon = &user["avatarDetail"]["identityIconUrl"];
            if !image(identity_icon).is_empty() {
                badges.push(badge("平台身份标识", identity_icon, "identity"));
            }
            let account = json!({"id":text(&user["userId"]),"nickname":strip(&user["nickname"]),
                "avatarUrl":image(&user["avatarUrl"]),"badges":badges});
            let pictures = [row["pictures"].as_array(), row["images"].as_array()]
                .into_iter()
                .flatten()
                .flatten()
                .chain(std::iter::once(&row["expressionUrl"]))
                .take(16)
                .filter_map(picture)
                .collect::<Vec<_>>();
            (
                first_text(&[&row["commentId"], &row["beRepliedCommentId"]]),
                strip(row.get("content").unwrap_or(&row["richContent"])),
                uint(&row["likedCount"]),
                flag(&row["liked"]),
                uint(&row["time"]),
                strip(&row["timeStr"]),
                uint(&row["showFloorComment"]["replyCount"]),
                strip(&row["ipLocation"]["location"]),
                vec![&row["beReplied"]],
                account,
                pictures,
                top_level,
            )
        }
        Provider::Qq => {
            let mut badges = Vec::new();
            if flag(&row["IsVip"]) || uint(&row["VipType"]) > 0 {
                badges.push(badge("VIP", &Value::Null, "vip"));
            }
            let account = json!({"id":text(&row["EncryptUin"]),"nickname":strip(&row["Nick"]),
                "avatarUrl":image(&row["Avatar"]),"badges":badges});
            (
                text(&row["CmId"]),
                strip(&row["Content"]),
                uint(&row["PraiseNum"]),
                flag(&row["IsPraised"]),
                uint(&row["PubTime"]).saturating_mul(1000),
                String::new(),
                uint(row.get("ReplyCnt").unwrap_or(&row["RplCnt"])),
                strip(&row["Location"]),
                vec![&row["SubComments"], &row["RepliedComments"]],
                account,
                picture(&row["Pic"]).into_iter().collect(),
                top_level,
            )
        }
        Provider::Kugou => {
            let mut message = strip(&row["content"]);
            for (tag, emoji) in [
                ("[玫瑰]", "🌹"),
                ("[爱心]", "❤️"),
                ("[流泪]", "😢"),
                ("[微笑]", "🙂"),
                ("[大哭]", "😭"),
                ("[强]", "👍"),
                ("[太阳]", "☀️"),
                ("[月亮]", "🌙"),
                ("[拥抱]", "🤗"),
                ("[鼓掌]", "👏"),
            ] {
                message = message.replace(tag, emoji);
            }
            let level = uint(&row["svip_level"]);
            let mut badges = Vec::new();
            if level > 0 {
                badges.push(badge(&format!("SVIP {level}"), &Value::Null, "vip"));
            } else if uint(&row["vip_type"]) > 0 {
                badges.push(badge("VIP", &Value::Null, "vip"));
            }
            let identity = &row["vinfo9"];
            if !image(&identity["pic"]).is_empty() {
                let label = first_text(&[
                    &identity["auth_info"],
                    &identity["user_label"],
                    &json!("平台标识"),
                ]);
                badges.push(badge(&label, &identity["pic"], "identity"));
            }
            for medal in object_rows(&row["udetails"])
                .chain(std::iter::once(&row["udetail"]))
                .take(10)
            {
                let icon = medal
                    .get("small_pic_v3")
                    .unwrap_or(&medal["medal_def_small_pic"]);
                if !image(icon).is_empty() {
                    badges.push(badge(&strip(&medal["word_v3"]), icon, "medal"));
                }
            }
            let account = json!({"id":text(&row["user_id"]),"nickname":strip(&row["user_name"]),
                "avatarUrl":image(&row["user_pic"]),"badges":badges});
            (
                text(&row["id"]),
                message,
                uint(row["like"].get("likenum").unwrap_or(&row["like"]["count"])),
                flag(&row["like"]["haslike"]),
                0,
                strip(&row["addtime"]),
                uint(&row["reply_num"]),
                strip(&row["location"]),
                vec![row.get("reply_list").unwrap_or(&row["replies"])],
                account,
                object_rows(&row["images"])
                    .take(12)
                    .filter_map(picture)
                    .collect(),
                top_level && numeric_id(&text(&row["special_child_id"])).is_ok(),
            )
        }
        Provider::Qishui => {
            let user = row.get("user").unwrap_or(&row["user_info"]);
            let artist = &row["artist"];
            let mut badges = Vec::new();
            if row["featured"] == true {
                badges.push(badge("精选", &Value::Null, "featured"));
            }
            let avatar = [
                &artist["url_avatar"],
                &user["thumb_avatar_url"],
                &user["medium_avatar_url"],
            ]
            .into_iter()
            .map(image)
            .find(|url| !url.is_empty())
            .unwrap_or_default();
            let account = json!({"id":first_text(&[&artist["id"],&user["id"]]),
                "nickname":first_text(&[&artist["name"],&user["nickname"]]),"avatarUrl":avatar,"badges":badges});
            let pictures = object_rows(&row["image_list"])
                .take(12)
                .filter_map(|row| {
                    [&row["origin_url"], &row["download_url"], &row["medium_url"]]
                        .into_iter()
                        .find_map(picture)
                })
                .collect();
            (
                text(&row["id"]),
                strip(&row["content"]),
                uint(&row["count_digged"]),
                flag(&row["user_digged"]),
                uint(&row["time_created"]).saturating_mul(1000),
                String::new(),
                uint(&row["count_reply"]),
                strip(&row["ip_label"]),
                vec![&row["reply_comments"]],
                account,
                pictures,
                top_level,
            )
        }
    };
    if id.is_empty() || id.len() > 256 {
        return None;
    }
    let mut segments = Vec::new();
    if !raw.is_empty() {
        segments.push(json!({"type":"text","text":raw}));
    }
    if platform == Provider::Qq {
        let emoji = image(&row["EmoPic"]);
        if !emoji.is_empty() {
            segments.push(json!({"type":"emoji","url":emoji,"alt":"表情包"}));
        }
    }
    let replies = if top_level {
        reply_rows
            .into_iter()
            .flat_map(object_rows)
            .take(10)
            .filter_map(|reply| normalize(platform, reply, false))
            .collect::<Vec<_>>()
    } else {
        Vec::new()
    };
    pictures.truncate(12);
    Some(
        json!({"id":id,"content":raw,"segments":segments,"pictures":pictures,"user":account,"time":timestamp,"timeText":date,
        "likedCount":likes,"liked":liked,"replyCount":count,"replies":replies,"location":location,"canLike":can_like}),
    )
}

async fn qq_request(
    client: &reqwest::Client,
    account: &Account,
    module: &str,
    method: &str,
    param: Value,
) -> Result<Value> {
    let value = qq::rpc(
        client,
        &json!({"comm":{"ct":24,"cv":0,"uin":qq::identity(account),"format":"json"},
        "req":{"module":module,"method":method,"param":param}}),
        account,
        15,
    )
    .await?;
    let node = &value["req"];
    ensure!(
        code(&node["code"], 0) && node["data"].is_object(),
        "QQ 音乐暂时无法返回评论"
    );
    Ok(node["data"].clone())
}

fn validate_id(value: &str, comment: bool) -> Result<()> {
    ensure!(
        !value.is_empty()
            && value.len() <= 256
            && value.bytes().all(|byte| byte.is_ascii_alphanumeric()
                || matches!(byte, b'_' | b'-')
                || comment && matches!(byte, b'!' | b'.' | b'*' | b':' | b'+')),
        "歌曲或评论标识无效"
    );
    Ok(())
}

impl Comments {
    pub async fn read(
        &self,
        client: &reqwest::Client,
        platform: Provider,
        song: &str,
        query: &HashMap<String, String>,
        accounts: &Accounts,
    ) -> Result<Value> {
        validate_id(song, false)?;
        let param = |key: &str| query.get(key).map_or("", String::as_str);
        let limit: usize = if param("limit").is_empty() {
            20
        } else {
            param("limit").parse().context("评论数量无效")?
        };
        ensure!((1..=50).contains(&limit), "评论数量无效");
        let sort = match (platform, param("sort")) {
            (Provider::Qishui, "" | "default" | "hot") => "default",
            (_, "" | "hot") => "hot",
            (_, "new") => "new",
            _ => anyhow::bail!("评论排序方式无效"),
        };
        let cursor = param("cursor");
        ensure!(
            cursor.len() <= 2048 && !cursor.chars().any(char::is_control),
            "评论分页标识无效"
        );
        let account = accounts.account(platform);
        let data;
        let (rows, total, mut more, next) = match platform {
            Provider::Netease => {
                numeric_id(song)?;
                let offset: u64 = if cursor.is_empty() {
                    0
                } else {
                    cursor.parse().context("评论分页标识无效")?
                };
                ensure!(offset <= 99_999_999, "评论分页标识无效");
                let route = if sort == "hot" {
                    "hotcomments"
                } else {
                    "comments"
                };
                data = netease::web_get(
                    client,
                    &format!("/api/v1/resource/{route}/R_SO_4_{song}"),
                    &[
                        ("limit", limit.to_string()),
                        ("offset", offset.to_string()),
                        ("beforeTime", "0".into()),
                    ],
                    &account,
                )
                .await?;
                ensure!(code(&data["code"], 200), "网易云暂时无法返回评论");
                let rows = &data[if sort == "hot" {
                    "hotComments"
                } else {
                    "comments"
                }];
                let upcoming = offset + rows.as_array().map_or(0, Vec::len) as u64;
                (
                    rows,
                    uint(&data["total"]),
                    flag(&data[if sort == "hot" { "hasMore" } else { "more" }]),
                    upcoming.to_string(),
                )
            }
            Provider::Qq => {
                let (page, sequence): (u64, String) = if cursor.is_empty() {
                    (0, String::new())
                } else {
                    serde_json::from_str(cursor).context("评论分页标识无效")?
                };
                ensure!(
                    page <= 10000
                        && sequence.len() <= 256
                        && !sequence.chars().any(char::is_control),
                    "评论分页标识无效"
                );
                let id = match numeric_id(song) {
                    Ok(id) => id,
                    Err(_) => numeric_id(&text(&qq::detail(client, song, &account).await?["id"]))?,
                };
                let mut parameters = json!({"BizType":1,"BizId":id.to_string(),"LastCommentSeqNo":sequence,
                    "PageSize":limit.min(25),"PageNum":page,"PicEnable":1});
                if sort == "hot" {
                    parameters["HotType"] = json!(1);
                    parameters["WithAirborne"] = json!(0);
                }
                data = qq_request(
                    client,
                    &account,
                    "music.globalComment.CommentRead",
                    if sort == "hot" {
                        "GetHotCommentList"
                    } else {
                        "GetNewCommentList"
                    },
                    parameters,
                )
                .await?;
                ensure!(
                    data["SubCode"].is_null() || code(&data["SubCode"], 0),
                    "QQ 音乐暂时无法返回评论"
                );
                let list = &data["CommentList"];
                let rows = &list["Comments"];
                let tail = rows
                    .as_array()
                    .and_then(|values| values.last())
                    .map_or_else(String::new, |value| text(&value["SeqNo"]));
                (
                    rows,
                    uint(data.get("TotalCmNum").unwrap_or(&list["Total"])),
                    flag(&list["HasMore"]),
                    json!([page + 1, tail]).to_string(),
                )
            }
            Provider::Kugou => {
                let page: u64 = if cursor.is_empty() {
                    1
                } else {
                    numeric_id(cursor)?
                };
                ensure!(page <= 99999, "评论分页标识无效");
                data = kugou::comments::read(
                    client,
                    song,
                    param("albumAudioId"),
                    page,
                    limit,
                    sort == "hot",
                    &account,
                )
                .await?;
                let total = uint(&data["count"]);
                (
                    &data["list"],
                    total,
                    page * (limit as u64) < total,
                    (page + 1).to_string(),
                )
            }
            Provider::Qishui => {
                numeric_id(song)?;
                let group = match param("nativeMediaType") {
                    "ugc_clip" => "3",
                    "" | "track" => "0",
                    _ => anyhow::bail!("汽水音源类型无效"),
                };
                data = qishui::accepted(
                    qishui::signed_read(
                        client,
                        "comments",
                        &[
                            ("group_id", song.into()),
                            ("group_type", group.into()),
                            ("cursor", cursor.into()),
                            ("count", limit.to_string()),
                            ("image_strategy", "3".into()),
                        ],
                        None,
                        &account,
                    )
                    .await?,
                )?;
                (
                    &data["comments"],
                    uint(&data["count"]),
                    flag(&data["has_more"]),
                    text(&data["cursor"]),
                )
            }
        };
        ensure!(rows.is_array(), "评论响应格式无效");
        let normalized = object_rows(rows)
            .take(50)
            .filter_map(|row| normalize(platform, row, true))
            .collect::<Vec<_>>();
        more &= !normalized.is_empty() && !next.is_empty() && next != cursor;
        if platform == Provider::Kugou && account.configured() {
            let scope = accounts.scope(platform);
            let mut state = self.state.lock().await;
            for row in object_rows(rows).take(50) {
                let id = text(&row["id"]);
                let child = text(&row["special_child_id"]);
                if numeric_id(&id).is_err() || numeric_id(&child).is_err() {
                    continue;
                }
                state.targets.retain(|target| {
                    !(target.scope == scope
                        && target.id == id
                        && target.song.eq_ignore_ascii_case(song))
                });
                state.targets.push_front(Target {
                    created: Instant::now(),
                    scope,
                    id,
                    child,
                    song: song.to_ascii_uppercase(),
                    liked: flag(&row["like"]["haslike"]),
                    count: uint(row["like"].get("likenum").unwrap_or(&row["like"]["count"])),
                });
            }
            state.targets.truncate(512);
        }
        Ok(
            json!({"ok":true,"provider":platform.name(),"songId":song,"comments":normalized,"total":total,
            "hasMore":more,"nextCursor":if more {next} else {String::new()},"sort":sort,
            "capabilities":{"read":true,"like":true,"write":false,"sorts":if platform==Provider::Qishui {vec!["default"]} else {vec!["hot","new"]}}}),
        )
    }

    pub async fn like(
        &self,
        client: &reqwest::Client,
        platform: Provider,
        payload: &Value,
        accounts: &Accounts,
    ) -> Result<Value> {
        let song = text(&payload["songId"]);
        let comment = text(&payload["commentId"]);
        validate_id(&song, false)?;
        validate_id(&comment, true)?;
        let liked = payload["liked"].as_bool().context("点赞状态无效")?;
        let request = payload["requestId"].as_str().context("点赞操作标识无效")?;
        validate_id(request, false)?;
        ensure!((8..=100).contains(&request.len()), "点赞操作标识无效");
        let account = accounts.account(platform);
        ensure!(account.configured(), "请先登录当前音乐平台");
        let scope = accounts.scope(platform);
        let data = Sha256::digest(json!([song, comment, liked]).to_string()).into();
        let _write = self.changes[scope[0] as usize % self.changes.len()]
            .lock()
            .await;
        {
            let mut state = self.state.lock().await;
            state
                .replies
                .retain(|reply| reply.created.elapsed() < Duration::from_secs(180));
            if let Some(reply) = state
                .replies
                .iter()
                .find(|reply| reply.scope == scope && reply.request == request)
            {
                ensure!(reply.data == data, "该操作标识已经使用");
                return Ok(reply.response.clone());
            }
        }
        let target = if platform == Provider::Kugou {
            let mut state = self.state.lock().await;
            let index = state
                .targets
                .iter()
                .position(|target| {
                    target.created.elapsed() < Duration::from_secs(120)
                        && target.scope == scope
                        && target.id == comment
                        && target.song.eq_ignore_ascii_case(&song)
                        && target.liked != liked
                })
                .context("请先刷新评论，再为这条评论点赞")?;
            let target = state.targets.remove(index);
            state
                .targets
                .retain(|target| !(target.scope == scope && target.id == comment));
            target
        } else {
            None
        };
        let result = match platform {
            Provider::Netease => {
                numeric_id(&song)?;
                numeric_id(&comment)?;
                let route = if liked {
                    "/weapi/v1/comment/like"
                } else {
                    "/weapi/v1/comment/unlike"
                };
                netease::weapi(
                    client,
                    route,
                    &account,
                    json!({"threadId":format!("R_SO_4_{song}"),"commentId":comment,
                    "csrf_token":account.field("__csrf").unwrap_or_default()}),
                )
                .await
                .and_then(|data| {
                    ensure!(code(&data["code"], 200), "网易云未确认点赞");
                    Ok(None)
                })
            }
            Provider::Qq => {
                numeric_id(qq::identity(&account))?;
                qq_request(client,&account,"GlobalComment.GlobalCommentWriteServer","UpdateHotComment",
                    json!({"comment_id":comment,"type":if liked {3} else {4},"uin":qq::identity(&account)})).await
                    .and_then(|data|{ensure!(code(&data["code"],0) && code(&data["subcode"],0),"QQ 音乐未确认点赞"); Ok(None)})
            }
            Provider::Qishui => {
                numeric_id(&song)?;
                numeric_id(&comment)?;
                qishui::signed_read(
                    client,
                    "comments/action",
                    &[],
                    Some(json!({"comment_id":comment,"reply_id":"",
                    "group_id":song,"type":if liked {1} else {3},"scene_name":"comment_detail"})),
                    &account,
                )
                .await
                .and_then(qishui::accepted)
                .map(|_| None)
            }
            Provider::Kugou => {
                let target = target.expect("verified comment target");
                kugou::comments::toggle(client, &comment, &target.child, &account)
                    .await
                    .and_then(|actual| {
                        ensure!(actual == liked, "酷狗返回的点赞状态已变化");
                        Ok(Some(if liked {
                            target.count.saturating_add(1)
                        } else {
                            target.count.saturating_sub(1)
                        }))
                    })
            }
        };
        let response = match result {
            Ok(count) => {
                let mut response =
                    json!({"ok":true,"provider":platform.name(),"commentId":comment,"liked":liked});
                if let Some(count) = count {
                    response["likedCount"] = json!(count);
                }
                response
            }
            Err(_) => {
                json!({"ok":false,"error":"comment_like_unconfirmed","message":"未能确认点赞结果，请刷新评论查看实际状态"})
            }
        };
        let mut state = self.state.lock().await;
        state.replies.push_front(Reply {
            created: Instant::now(),
            scope,
            request: request.to_owned(),
            data,
            response: response.clone(),
        });
        state.replies.truncate(512);
        Ok(response)
    }
}
