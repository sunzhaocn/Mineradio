"""平台适配：netease / search_play。"""

import json
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from music_app.core import cache as core_cache
from music_app.core import request_credentials
from music_app.providers.netease import config as netease_config
from music_app.providers.netease import transport as netease_transport

nes__PLAY_CACHE, nes__PLAY_TTL = ({}, 600)


def nes_clean_link(url):
    """带 ?vuutv=...&authSecret=... 的原始直链会 403，砍掉 query 留裸路径。"""
    return url.split("?", 1)[0] if url else ""


def nes__play_once(song_id, level):
    """仅请求网易云某一档播放地址；weapi 没返回 data 时回退旧接口。
    返回 url/raw_url、码率 br（bps）、size（字节）和 expire_at；本函数不逐档降级。"""
    br = netease_config.nes_LEVELS[level]
    data = {
        "ids": json.dumps([int(song_id)]),
        "br": br,
        "level": level,
        "encodeType": "flac" if level == "lossless" else "mp3",
        "csrf_token": netease_transport.nes_csrf_token(),
    }
    j = netease_transport.nes_weapi_post(netease_config.nes_PLAY_API, data)
    arr = j.get("data") or []
    if not arr:
        q = urllib.parse.urlencode({"ids": "[%d]" % int(song_id), "br": br})
        req = urllib.request.Request(
            netease_config.nes_BASE + "/api/song/enhance/player/url?" + q,
            headers=netease_transport.ne_headers(),
        )
        with urllib.request.urlopen(req, timeout=10) as r:
            arr = json.loads(r.read().decode("utf-8", "replace")).get("data") or []
    if not arr:
        return {
            "url": None,
            "raw_url": None,
            "level": level,
            "br": 0,
            "size": 0,
            "encode_type": None,
            "expire_at": 0,
            "note": "data 为空 (code=%s)" % j.get("code"),
        }
    d = arr[0]
    raw = d.get("url") or ""
    return {
        "url": nes_clean_link(raw) or None,
        "raw_url": raw or None,
        "level": d.get("level") or level,
        "br": int(d.get("br") or 0),
        "size": int(d.get("size") or 0),
        "encode_type": d.get("encodeType") or d.get("type"),
        "expire_at": int(time.time()) + int(d.get("expi") or 0) if raw else 0,
        "note": "" if raw else d.get("message") or "url=null（无版权 / 需会员 / 地区限制）",
    }


def nes_play_url(song_id, level="exhigh", fallback=True):
    """逐档降级取直链；返回首个有 url 的档位。"""
    if level == "best":
        level, fallback = ("lossless", True)
    if level not in netease_config.nes_LEVELS:
        raise ValueError("level 必须是 %s 或 best" % "/".join(netease_config.nes__ORDER))
    key = (int(song_id), level, fallback, bool(request_credentials.cookie('netease')))
    key = core_cache.credential_cache_key("netease", key)
    hit = nes__PLAY_CACHE.get(key)
    if hit and time.time() - hit[0] < nes__PLAY_TTL:
        return hit[1]
    order = (
        netease_config.nes__ORDER[netease_config.nes__ORDER.index(level) :] if fallback else [level]
    )
    out, tried = (None, [])
    for lv in order:
        try:
            rec = nes__play_once(song_id, lv)
        except Exception as e:
            rec = {
                "url": None,
                "raw_url": None,
                "level": lv,
                "br": 0,
                "size": 0,
                "encode_type": None,
                "expire_at": 0,
                "note": "请求异常: %s" % e,
            }
        tried.append(lv)
        out = rec
        if rec["url"]:
            break
    out["tried"] = tried
    if not out["url"] and (not request_credentials.cookie('netease')):
        out["note"] = "游客模式：直链需要 MUSIC_U Cookie（--cookie ne_cookie.txt）"
    nes__PLAY_CACHE[key] = (time.time(), out)
    return out


def nes_attach_play(rows, level="exhigh", workers=8):
    """并行为每条记录挂 play 字段。"""

    def one(item):
        try:
            item["play"] = nes_play_url(item["id"], level=level)
        except Exception as e:
            item["play"] = {"url": None, "note": "异常: %s" % e, "level": level}
        return item

    if rows:
        with ThreadPoolExecutor(max_workers=workers) as ex:
            request_credentials.map_with_context(ex, one, rows)
    return rows
