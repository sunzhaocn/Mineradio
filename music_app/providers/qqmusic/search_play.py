"""平台适配：qqmusic / search_play。"""

import time
from concurrent.futures import ThreadPoolExecutor
from music_app.core import cache as core_cache
from music_app.core import request_credentials
from music_app.providers.qqmusic import config as qqmusic_config
from music_app.providers.qqmusic import state as qqmusic_state
from music_app.providers.qqmusic import search_transport as qqmusic_search_transport

qqs__URL_CACHE, qqs__URL_TTL = ({}, 600)


def qqs__guid_order():
    """为搜索结果补直链时生成 GUID 尝试顺序，最近成功者优先。"""
    good = qqmusic_state.search_guid.get("good") or qqmusic_config.qqs_GUID
    return [good] + [g for g in qqmusic_config.qqs_GUID_POOL if g != good]


def qqs_vkey(mid, media_mid, prefix, ext, cookie=None):
    """单档 purl；返回 {"url","filename","sip","purl"} 或 {}。url 必须是 sip[0]+purl 原样拼接。"""
    if not mid:
        return {}
    ck = qqmusic_search_transport.qqs_cookie_fields(cookie)
    uin = ck["uin"] or "0"
    fn = "%s%s.%s" % (prefix, media_mid or mid, ext)
    cache_key = core_cache.credential_cache_key("qqmusic", (mid, fn, uin))
    hit = qqs__URL_CACHE.get(cache_key)
    if hit and time.time() - hit[0] < (qqs__URL_TTL if hit[1] else 60):
        return hit[1]
    for guid in qqs__guid_order():
        data = {
            "req_1": {
                "module": "vkey.GetVkeyServer",
                "method": "CgiGetVkey",
                "param": {
                    "filename": [fn],
                    "guid": guid,
                    "songmid": [mid],
                    "songtype": [0],
                    "uin": uin,
                    "loginflag": 1,
                    "platform": "20",
                },
            },
            "comm": {"uin": int(uin) if uin.isdigit() else 0, "format": "json", "ct": 24, "cv": 0},
        }
        try:
            j = qqmusic_search_transport.qqs_musicu(data, cookie)
        except Exception:
            continue
        rd = (j.get("req_1") or {}).get("data") or {}
        mi = (rd.get("midurlinfo") or [{}])[0] or {}
        purl = mi.get("purl") or ""
        sip = [s for s in rd.get("sip") or [] if s]
        if not purl:
            continue
        qqmusic_state.search_guid["good"] = guid
        info = {
            "purl": purl,
            "filename": mi.get("filename") or fn,
            "sip": sip,
            "url": (sip[0] if sip else "http://aqqmusic.tc.qq.com/") + purl,
        }
        qqs__URL_CACHE[cache_key] = (time.time(), info)
        return info
    qqs__URL_CACHE[cache_key] = (time.time(), {})
    return {}


def qqs_play_url(mid, media_mid, level="128", cookie=None):
    """按指定档位起逐档降级；返回 {"url","quality","ext","bitrate","filename"}；无则 url=None。"""
    want = qqmusic_config.qqs_LEVEL_ALIAS.get((level or "128").strip().lower(), "128")
    keys = [k for k, *_ in qqmusic_config.qqs_PLAY_LADDER]
    start = keys.index(want) if want in keys else keys.index("128")
    tried = []
    for key, prefix, ext, size_key, br in qqmusic_config.qqs_PLAY_LADDER[start:]:
        got = qqs_vkey(mid, media_mid, prefix, ext, cookie)
        tried.append(key)
        if got:
            return {
                "url": got["url"],
                "quality": key,
                "ext": ext,
                "bitrate": br,
                "filename": got["filename"],
                "tried": tried,
            }
    note = "该曲当前账号无直链"
    if not qqmusic_search_transport.qqs_cookie_fields(cookie)["uin"]:
        note = "游客只能取免费曲的 128k；320k/flac 需登录态 Cookie（qq_cookie.txt）"
    return {
        "url": None,
        "quality": None,
        "ext": None,
        "bitrate": None,
        "filename": None,
        "tried": tried,
        "note": note,
    }


def qqs_attach_play(rows, level="128", workers=6, cookie=None):
    """并发为 QQ 精简歌曲 rows 原地补 play 字段；单条失败写入该条 note。
    workers 控制线程数，level 指定请求音质；返回同一列表。"""

    def one(item):
        try:
            item["play"] = qqs_play_url(item["mid"], item.get("media_mid"), level, cookie)
        except Exception as e:
            item["play"] = {"url": None, "note": "异常: %s" % e}
        return item

    if rows:
        with ThreadPoolExecutor(max_workers=workers) as ex:
            request_credentials.map_with_context(ex, one, rows)
    return rows
