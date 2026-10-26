"""平台适配：kugou / metadata。"""

import re
import time
import urllib.error
import urllib.parse
import urllib.request
from music_app.providers.kugou import config as kugou_config
from music_app.providers.kugou import transport as kugou_transport


def kg_parse_target(s):
    """返回 ("eid"|"hash"|"mp3", 值)；无法识别返回 (None, "")"""
    s = (s or "").strip().strip('"').strip("'")
    if not s:
        return (None, "")
    if s.startswith("http"):
        m = re.search("/v3/([0-9a-fA-F]{32})/", s)
        if m:
            return ("mp3", m.group(1).lower())
        m = re.search("#([0-9A-Za-z]{4,12})", s)
        if m:
            return ("eid", m.group(1))
        m = re.search("/mixsong/([0-9A-Za-z]+)\\.html", s)
        if m:
            return ("eid", m.group(1))
        return (None, "")
    if re.fullmatch("[0-9a-fA-F]{32}", s):
        return ("hash", s)
    if re.fullmatch("[0-9A-Za-z]{4,12}", s):
        return ("eid", s)
    return (None, "")


def kg_songinfo(value, cookie=None, key="encode_album_audio_id", extra=None):
    """对应酷狗 /play/songinfo：根据歌曲标识获取详情和当前播放地址。
    key 决定 value 的含义，默认 encode_album_audio_id，也可传 album_audio_id。
    extra 补充音质 hash 等上游参数；最终统一签名并附带 Cookie。缺 token/uid 时抛异常。"""
    ck = kugou_transport.kg_cookie_fields(cookie)
    if not ck["token"] or not ck["uid"]:
        raise RuntimeError("COOKIE 里缺 t / KugooID（登录态）")
    p = {
        "srcappid": "2919",
        "clientver": "20000",
        "clienttime": str(int(time.time() * 1000)),
        "mid": ck["mid"],
        "uuid": ck["mid"],
        "dfid": ck["dfid"] or "-",
        "appid": "1014",
        "platid": "4",
        "token": ck["token"],
        "userid": ck["uid"],
        key: value,
    }
    if extra:
        p.update({k: str(v) for k, v in extra.items() if v not in (None, "")})
    p["signature"] = kugou_transport.kg_kg_sign(p)
    return kugou_transport.kg_http_json(
        kugou_config.kg_SONGINFO_API + "?" + urllib.parse.urlencode(p), {"Cookie": ck["raw"]}
    )


def kg__norm_url(u):
    """把图片等普通资源地址中的 http:// 替换为 https://；空输入返回空串。"""
    return (u or "").replace("http://", "https://")


def kg__cover_fields(tpl, fixed_img="", avatar_tpl="", avatar=""):
    """将酷狗封面/头像模板转成统一字段：cover=480、cover_hd=1080、头像=400。
    优先使用带 {size} 的模板，缺模板时使用现成图片地址，并保留 *_tpl 供调用方换尺寸。"""
    tpl = kg__norm_url(tpl)
    img = kg__norm_url(fixed_img)
    atpl = kg__norm_url(avatar_tpl)
    av = kg__norm_url(avatar)
    if not tpl and "/stdmusic/" in img:
        tpl = img.replace("/stdmusic/", "/stdmusic/{size}/")
    return {
        "cover": tpl.replace("{size}", "480") if tpl else img,
        "cover_hd": tpl.replace("{size}", "1080") if tpl else img,
        "cover_tpl": tpl or img,
        "singer_avatar": av or (atpl.replace("{size}", "400") if atpl else ""),
        "singer_avatar_tpl": atpl or av,
    }


def kg__cover_from_info(info):
    """从 songinfo 的图片字段及首位歌手 authors[0] 提取封面和头像。"""
    authors = info.get("authors") or []
    a0 = (
        authors[0] if isinstance(authors, list) and authors and isinstance(authors[0], dict) else {}
    )
    return kg__cover_fields(
        info.get("sizable_cover") or "",
        info.get("img") or "",
        a0.get("sizable_avatar") or "",
        a0.get("avatar") or "",
    )


def kg__from_songinfo(d):
    """将酷狗 data 下的上游字段转换为统一歌曲字段。
    song_name→title，author_name→author，timelength 毫秒→duration_s 秒；
    根据播放路径区分完整版/试听切片，并补上封面和头像。"""
    info = d.get("data") or {}
    if not isinstance(info, dict):
        info = {}
    url = info.get("play_url") or ""
    out = {
        "source": "play/songinfo",
        "title": info.get("song_name") or "",
        "author": info.get("author_name") or "",
        "album": info.get("album_name") or "",
        "album_id": str(info.get("album_id") or ""),
        "album_audio_id": str(info.get("album_audio_id") or ""),
        "mixsongid": str(info.get("mixsongid") or info.get("album_audio_id") or ""),
        "emix_id": str(info.get("encode_album_audio_id") or ""),
        "duration_s": round((info.get("timelength") or 0) / 1000.0, 3),
        "hash": info.get("hash") or "",
        "privilege": info.get("privilege"),
        "bitrate": info.get("bitrate"),
        "kind": "完整版" if "/yp/full/" in url else "试听切片" if "/yp/p_" in url else "未知",
        "url": url,
        "backup_url": info.get("play_backup_url") or "",
        "filesize": info.get("filesize"),
    }
    out.update(kg__cover_from_info(info))
    return out


def kg_songinfo_by_hash(song_hash):
    """hash -> song/info 取 album_audio_id -> songinfo 全量"""
    try:
        data = (
            kugou_transport.kg_http_json(
                kugou_config.kg_SONGINFO_BY_HASH + "?hash=" + song_hash
            ).get("data")
            or {}
        )
    except Exception:
        return {}
    alb = data.get("album") or []
    aaid = ""
    if isinstance(alb, list) and alb and isinstance(alb[0], dict):
        aaid = str(alb[0].get("album_audio_id") or "")
    if not aaid:
        return {}
    try:
        meta = kg__from_songinfo(kg_songinfo(aaid, key="album_audio_id"))
    except Exception:
        return {}
    if not meta.get("hash"):
        meta["hash"] = song_hash.upper()
    return meta


def kg_info_by_hash(song_hash):
    """通过酷狗 hash 读取最小元信息，作为完整 songinfo 失败时的回退。
    仅填标题/歌手/时长/hash；必要时从 filename 的“歌手 - 歌名”拆出名称。"""
    try:
        data = (
            kugou_transport.kg_http_json(
                kugou_config.kg_SONGINFO_BY_HASH + "?hash=" + song_hash
            ).get("data")
            or {}
        )
    except Exception:
        return {}
    if not data:
        return {}
    filename = data.get("filename") or ""
    author = data.get("singername") or ""
    song = data.get("songname") or ""
    if not song and " - " in filename:
        author, song = filename.split(" - ", 1)
    return {
        "source": "api/v3/song/info",
        "title": song,
        "author": author,
        "duration_s": data.get("duration") or 0,
        "hash": (data.get("hash") or song_hash).upper(),
    }
