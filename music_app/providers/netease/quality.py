"""平台适配：netease / quality。"""

import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from music_app.providers.netease import config as netease_config
from music_app.providers.netease import transport as netease_transport
from music_app.core.playback_quality import candidate_keys
from music_app.core import request_lifecycle


def ne_clean_link(url):
    """去掉 ?vuutv=...&authSecret=...，否则 CDN Tengine 直接 403。"""
    return (url or "").split("?", 1)[0]


def ne_matches_quality(data, level, encode):
    """播放器会静默降档；返回档位和媒体信息必须能证明本次请求的音质。"""
    actual_level = str(data.get("level") or "").lower()
    if actual_level and actual_level != level:
        return False
    codec = str(encode or "").lower()
    lossless_codecs = {"flac", "wav", "alac"}
    if level == "lossless":
        # 无损使用可变码率，不能用 PCM 的 1411 kbps 作为判断门槛。
        return codec in lossless_codecs or (actual_level == level and not codec)
    if codec in lossless_codecs:
        return False
    try:
        bitrate = float(data.get("br") or 0)
    except (TypeError, ValueError):
        bitrate = 0
    target = dict((k, b) for k, _, _, b in netease_config.ne_QUALITY_LADDER).get(level)
    if bitrate > 0:
        return target is not None and abs(bitrate - target) <= target * 0.01
    return actual_level == level


def ne_source_qualities(song_detail):
    """歌曲元数据证明音源是否存在；缺少字段时保留未知，不把权限失败当作无音源。"""
    songs = (song_detail or {}).get("songs") or []
    song = songs[0] if songs else {}
    fields = {"lossless": ("sq", "sqMusic"), "exhigh": ("h", "hMusic"),
              "higher": ("m", "mMusic"), "standard": ("l", "lMusic")}
    result = {}
    for level, names in fields.items():
        field = next((name for name in names if name in song), None)
        if field is None:
            result[level] = None
            continue
        audio = song[field]
        if not audio:
            result[level] = False
        elif isinstance(audio, dict):
            bitrate = audio.get("br", audio.get("bitrate"))
            if level == "lossless":
                result[level] = True
            elif bitrate is not None:
                result[level] = ne_matches_quality({"br": bitrate}, level, "mp3")
            else:
                result[level] = True
        else:
            result[level] = None
    return result


def ne_play_url_of_quality(song_id, level="exhigh", cookie=None):
    """单档直链；返回 {"url","backup_url","filesize","bitrate","kind","encode"}；拿不到返回 {}。"""
    sid = int(song_id)
    br = dict(((k, b) for k, _, _, b in netease_config.ne_QUALITY_LADDER)).get(level, 320000)
    payload = {
        "ids": json.dumps([sid]),
        "br": br,
        "level": level,
        "encodeType": "flac" if level == "lossless" else "mp3",
        "csrf_token": netease_transport.ne_cookie_fields(cookie)["csrf"],
    }
    try:
        js = netease_transport.ne_weapi_post("/weapi/song/enhance/player/url/v1", payload, cookie)
    except Exception:
        js = {}
    arr = js.get("data") or []
    if not arr:
        try:
            js = netease_transport.ne_http_json(
                "%s?ids=%s&br=%s"
                % (netease_config.ne_PLAYER_OLD, urllib.parse.quote(json.dumps([sid])), br),
                netease_transport.ne_headers(cookie),
            )
            arr = js.get("data") or []
        except Exception:
            arr = []
    if not arr:
        return {}
    d = arr[0]
    raw = d.get("url") or ""
    if not raw:
        return {}
    clean = ne_clean_link(raw)
    trial = (d.get("freeTrialPrivilege") or {}).get("resConsumable") or bool(
        (d.get("freeTrialInfo") or {}).get("start") is not None
    )
    m = re.search("\\.(mp3|flac|m4a|aac|ogg|wav)$", clean, re.I)
    enc = (m.group(1).lower() if m else "") or (d.get("encodeType") or d.get("type") or "")
    if not ne_matches_quality(d, level, enc):
        return {}
    return {
        "url": clean,
        "backup_url": raw,
        "filesize": d.get("size") or 0,
        "bitrate": round((d.get("br") or 0) / 1000) or None,
        "kind": "试听片段" if trial else "完整版",
        "encode": enc,
        "expire_at": int(time.time()) + int(d.get("expi") or 0),
    }


def ne_get_qualities(song_id, cookie=None, song_detail=None, *, playback_quality=None, allow_quality_fallback=False):
    """逐档检查真实音质；source_available 与当前账号能否取到直链分别表示。"""
    sources = ne_source_qualities(song_detail)
    items = []
    wanted = netease_config.ne_QUALITY_KEY.get(playback_quality, playback_quality)
    candidates = candidate_keys('netease', wanted, allow_fallback=allow_quality_fallback) if playback_quality is not None else None
    for key, label, level, _target in netease_config.ne_QUALITY_LADDER:
        request_lifecycle.check()
        if candidates is not None and key not in candidates:
            continue
        item = {
            "key": key,
            "quality": label,
            "hash": str(song_id),
            "filesize": 0,
            "privilege": None,
            "available": False,
            "source_available": sources.get(key),
            "url": "",
            "backup_url": "",
            "bitrate": None,
            "encode": "",
            "kind": "",
        }
        got = ne_play_url_of_quality(song_id, level, cookie)
        if got:
            item.update(got)
            item["available"] = True
            item["source_available"] = True
        items.append(item)
        if candidates is not None and item['available']:
            break
    return items


def ne_quality_key_of(want):
    """把入参（sq/320/high/128/lossless/exhigh...）翻成内部键；不认识返回 auto。"""
    w = (want or "auto").strip().lower()
    if w in ("", "auto", "best"):
        return "auto"
    return netease_config.ne_QUALITY_KEY.get(w, "auto")


def ne_pick_quality(items, want="auto"):
    """auto = 取最高可用；指定档位不可用时返回 None（与酷狗版语义一致）。"""
    if not items:
        return None
    key = ne_quality_key_of(want)
    if key == "auto":
        for it in items:
            if it["available"]:
                return it
        return None
    for it in items:
        if it["key"] == key:
            return it if it["available"] else None
    return None
