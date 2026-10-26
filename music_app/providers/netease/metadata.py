"""平台适配：netease / metadata。"""

import json
import re
import urllib.error
import urllib.parse
import urllib.request
from music_app.providers.netease import config as netease_config
from music_app.providers.netease import transport as netease_transport


def ne_parse_target(s):
    """
    返回 ("id"|"search", 值)；无法识别返回 (None, "")。
        纯数字 / 带 ?id= 的链接 -> id
        其它文本 -> search（按歌名搜索取首条）
    """
    s = (s or "").strip().strip('"').strip("'")
    if not s:
        return (None, "")
    if re.fullmatch("\\d{3,}", s):
        return ("id", s)
    m = re.search("[?&]id=(\\d+)", s)
    if m:
        return ("id", m.group(1))
    m = re.search("music\\.163\\.com/(?:#/)?song\\?id=(\\d+)", s)
    if m:
        return ("id", m.group(1))
    if s.startswith("http") and "163" not in s:
        return (None, "")
    return ("search", s)


def ne__norm_url(u):
    """将网易云图片等普通资源地址升级为 HTTPS；播放直链由单独函数处理。"""
    return (u or "").replace("http://", "https://")


def ne_cover_fields(pic_url):
    """网易封面是完整 URL，用 ?param=WxH 取不同尺寸（480 / 1080）。"""
    u = ne__norm_url((pic_url or "").split("?", 1)[0])
    if not u:
        return {"cover": "", "cover_hd": "", "cover_tpl": ""}
    tpl = u + "?param={size}y{size}"
    return {
        "cover": tpl.replace("{size}", "480"),
        "cover_hd": tpl.replace("{size}", "1080"),
        "cover_tpl": tpl,
    }


def ne_singer_avatar_fields(ar_list, pic_url=""):
    """
    v3/song/detail 的 ar[] 只给 id/name/tns/alias，不再下发 img1v1Url/avatar，
    网易也没有独立的歌手头像接口：优先用 ar[].img1v1Url（老接口可能带），
    拿不到就退回专辑封面（字段有值，但来源是专辑图）。
    """
    av = ""
    for a in ar_list or []:
        if isinstance(a, dict) and (a.get("img1v1Url") or a.get("avatar")):
            av = a.get("img1v1Url") or a.get("avatar")
            break
    u = ne__norm_url((av or pic_url or "").split("?", 1)[0])
    if not u:
        return {"singer_avatar": "", "singer_avatar_tpl": ""}
    tpl = u + "?param={size}y{size}"
    return {"singer_avatar": tpl.replace("{size}", "400"), "singer_avatar_tpl": tpl}


def ne_song_detail(song_id, cookie=None):
    """对应网易云 /weapi/v3/song/detail；把单个歌曲 ID 打包成上游要求的 c/ids 列表。"""
    sid = int(song_id)
    payload = {"c": json.dumps([{"id": sid}]), "ids": json.dumps([sid])}
    try:
        return netease_transport.ne_weapi_post("/weapi/v3/song/detail", payload, cookie)
    except Exception:
        return netease_transport.ne_http_json(
            "%s?ids=%s"
            % (netease_config.ne_BASE + "/api/song/detail", urllib.parse.quote(json.dumps([sid]))),
            netease_transport.ne_headers(cookie),
        )


def ne__from_detail(js):
    """从网易云 songs[0] 提取统一详情字段。
    name→title，ar→歌手，al→专辑/封面，dt 毫秒→秒，id→兼容字段 hash。"""
    songs = js.get("songs") or []
    if not songs:
        return {}
    s = songs[0]
    al = s.get("al") or {}
    ar = s.get("ar") or []
    prv = {}
    for p in js.get("privileges") or []:
        if str(p.get("id")) == str(s.get("id")):
            prv = p
            break
    out = {
        "source": "weapi/v3/song/detail",
        "title": s.get("name") or "",
        "author": "/".join([a.get("name") for a in ar if a.get("name")]),
        "album": al.get("name") or "",
        "album_id": str(al.get("id") or ""),
        "duration_s": round((s.get("dt") or 0) / 1000.0, 3),
        "hash": str(s.get("id") or ""),
        "privilege": prv.get("fee") if prv else s.get("fee"),
    }
    out.update(ne_cover_fields(al.get("picUrl") or ""))
    out.update(ne_singer_avatar_fields(ar, al.get("picUrl") or ""))
    return out


def ne_search_songs(keyword, limit=5, cookie=None):
    """用网易云搜索接口将歌名转换为候选歌曲列表，供 ne_get_music 取首条定位 ID。"""
    q = urllib.parse.urlencode({"s": keyword, "type": 1, "limit": limit, "offset": 0})
    js = netease_transport.ne_http_json(
        netease_config.ne_SEARCH_API + "?" + q, netease_transport.ne_headers(cookie)
    )
    out = []
    for s in (js.get("result") or {}).get("songs") or []:
        al = s.get("album") or {}
        out.append(
            {
                "id": s.get("id"),
                "name": s.get("name"),
                "singers": [a.get("name") for a in s.get("artists") or [] if a.get("name")],
                "album": al.get("name"),
                "cover": al.get("picUrl"),
                "duration_ms": s.get("duration") or 0,
            }
        )
    return out
