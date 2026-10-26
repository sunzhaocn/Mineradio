"""平台适配：netease / search。"""

import json
import threading
import urllib.parse
from music_app.core import results as core_results
from music_app.core import cache as core_cache
from music_app.providers.netease import config as netease_config
from music_app.providers.netease import search_play as netease_search_play
from music_app.providers.netease import search_views as netease_search_views
from music_app.providers.netease import transport as netease_transport


def nes_build_search_url(keyword, stype=1, limit=30, offset=0):
    """生成网易云 cloudsearch 的明文查询 URL；stype 是搜索对象类型，offset 是记录偏移。"""
    q = {"s": keyword, "type": stype, "limit": limit, "offset": offset, "csrf_token": ""}
    return netease_config.nes_SEARCH_API + "?" + urllib.parse.urlencode(q)


def nes_fetch_search(keyword, stype=1, limit=30, offset=0, timeout=15):
    """cloudsearch/pc 优先（有封面/时长/音质），异常时退老接口。"""
    body = urllib.parse.urlencode(
        {"s": keyword, "type": stype, "limit": limit, "offset": offset, "csrf_token": ""}
    ).encode()
    try:
        raw = netease_transport.ne_http_get(
            netease_config.nes_SEARCH_API,
            data=body,
            hdrs={
                **netease_transport.ne_headers(),
                "Content-Type": "application/x-www-form-urlencoded",
                "User-Agent": netease_config.nes_UA,
                "Referer": netease_config.nes_BASE + "/",
            },
            timeout=timeout,
        )
        j = json.loads(raw.decode("utf-8", "replace"))
        if j.get("code") == 200:
            j["_api"] = "cloudsearch"
            return j
    except Exception:
        pass
    q = urllib.parse.urlencode({"s": keyword, "type": stype, "limit": limit, "offset": offset})
    j = netease_transport.ne_http_json(
        netease_config.nes_SEARCH_LEGACY + "?" + q, timeout=timeout
    )
    j["_api"] = "legacy"
    return j


nes__SEARCH_CACHE, nes__SEARCH_TTL = ({}, 300)


nes__LOCK = threading.Lock()


def nes_cached_search(keyword, stype, limit, offset):
    """网易云搜索缓存入口；键包含关键词、对象类型、数量与记录偏移。"""
    key = (keyword, stype, limit, offset)
    return core_results.cached_result(
        nes__SEARCH_CACHE, key, nes__SEARCH_TTL, nes_fetch_search, keyword, stype, limit, offset
    )


def nes_simple_view(j, keyword, stype, limit, offset, with_play=False, level="exhigh"):
    """按 stype 将网易云搜索 result 转成统一精简视图。
    歌曲使用 nes__song_row，其他对象使用 nes__generic_row；with_play 只为歌曲补直链。"""
    r = j.get("result") or {}
    out = {
        "code": j.get("code"),
        "api": j.get("_api"),
        "keyword": keyword,
        "type": stype,
        "type_name": netease_config.nes_TYPES.get(stype, str(stype)),
        "offset": offset,
        "pagesize": limit,
        "page": offset // limit + 1 if limit else 1,
    }
    if stype == 1:
        songs = r.get("songs") or []
        rows = [netease_search_views.nes__song_row(s) for s in songs]
        total = r.get("songCount")
        out.update(
            {
                "total": total,
                "count": len(rows),
                "has_more": bool(total) and offset + len(rows) < int(total),
                "songs": rows,
            }
        )
        if with_play:
            netease_search_play.nes_attach_play(rows, level=level)
    else:
        key = {
            10: "albums",
            100: "artists",
            1000: "playlists",
            1002: "userprofiles",
            1004: "mvs",
        }.get(stype)
        rows = (
            [netease_search_views.nes__generic_row(stype, s) for s in r.get(key) or []]
            if key
            else []
        )
        total = {
            10: r.get("albumCount"),
            100: r.get("artistCount"),
            1000: r.get("playlistCount"),
            1002: r.get("userprofileCount"),
            1004: r.get("mvCount"),
        }.get(stype)
        out.update({"total": total, "count": len(rows), "items": rows})
    return out


nes__DETAIL_CACHE = {}


def nes_song_detail(ids):
    """weapi v3/song/detail：歌名、歌手、专辑、封面、时长。"""
    ids = [int(i) for i in ids]
    if not ids:
        return {}
    key = lambda song_id: core_cache.credential_cache_key('netease', song_id)
    missing = [i for i in ids if key(i) not in nes__DETAIL_CACHE]
    if missing:
        payload = {"c": json.dumps([{"id": i} for i in missing]), "ids": json.dumps(missing)}
        j = netease_transport.nes_weapi_post(netease_config.nes_DETAIL_API, payload)
        for s in j.get("songs") or []:
            al, ar = (s.get("al") or {}, s.get("ar") or [])
            names = [a.get("name") for a in ar if a.get("name")]
            nes__DETAIL_CACHE[key(s.get("id"))] = {
                "id": s.get("id"),
                "name": s.get("name"),
                "singer": "/".join(names),
                "artists": names,
                "album": al.get("name"),
                "cover": al.get("picUrl"),
                "duration": netease_search_views.nes_fmt_duration(s.get("dt")),
                "duration_ms": int(s.get("dt") or 0),
                "page": netease_search_views.nes_song_page(s.get("id")),
            }
    return {i: nes__DETAIL_CACHE.get(key(i)) for i in ids}


nes_KEY_ALIAS = ("search", "seach", "keyword", "k", "q", "wd", "s")


nes__ACCOUNT = {"at": 0.0, "val": None}
