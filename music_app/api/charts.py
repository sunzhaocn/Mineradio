"""公开榜单目录、完整曲目和缓存。"""

import json
import re
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from music_app.core import request_credentials
from music_app.api import aggregate as api_aggregate
from music_app.api import params as api_params
from music_app.providers.kugou import transport as kugou_transport
from music_app.providers.netease import config as netease_config
from music_app.providers.netease import search_views as netease_search_views
from music_app.providers.netease import transport as netease_transport
from music_app.providers.qishui import api as qishui_api
from music_app.providers.qqmusic import search_views as qqmusic_search_views
from music_app.providers.qqmusic import transport as qqmusic_transport
from music_app.api.chart_cache import chart_cached

CHART_EXCLUDED = re.compile(
    "说唱|嘻哈|hip[\\s-]?hop|(?:^|[^a-z])rap(?:$|[^a-z])|有声|听书|小说|评书|相声|脱口秀|广播剧|播客|audiobooks?|podcasts?|spoken[\\s-]?word|故事榜|儿童故事|MV榜|视频榜|歌手榜|艺人榜|专辑榜",
    re.I,
)


CHART_PLATFORMS = ("netease", "qqmusic", "kugou", "qishui")


def chart_allowed(name, category=""):
    """只筛榜单名和分类，不拿简介筛选，避免简介提及说唱就误删综合音乐榜。"""
    return bool(name) and (not CHART_EXCLUDED.search(name + " " + category))


def chart_cover(value):
    """酷狗使用 {size} 图片模板；统一替换为 400，并升级公开图片到 HTTPS。"""
    return str(value or "").replace("{size}", "400").replace("http://", "https://", 1)


def chart_catalog_platform(platform):
    """从平台真实目录发现全部榜单，保留平台 ID，不维护容易过期的硬编码榜单表。"""
    rows = []
    if platform == "netease":
        payload = netease_transport.ne_http_json(netease_config.ne_BASE + "/api/toplist/detail")
        if payload.get("code") != 200 or not isinstance(payload.get("list"), list):
            raise ValueError("网易云榜单目录暂时不可用")
        for item in payload["list"]:
            rows.append(
                {
                    "id": str(item["id"]),
                    "name": item.get("name", ""),
                    "category": "音乐榜",
                    "cover": chart_cover(item.get("coverImgUrl")),
                    "update": item.get("updateFrequency") or "",
                    "track_count": item.get("trackCount", 0),
                    "description": item.get("description") or "",
                }
            )
    elif platform == "qqmusic":
        payload = qqmusic_transport.qq_musicu(
            {
                "comm": {"ct": 24, "cv": 0},
                "req_1": {
                    "module": "musicToplist.ToplistInfoServer",
                    "method": "GetAll",
                    "param": {},
                },
            }
        )
        result = payload.get("req_1") or {}
        groups = (result.get("data") or {}).get("group")
        if result.get("code") != 0 or not isinstance(groups, list):
            raise ValueError("QQ 音乐榜单目录暂时不可用")
        for group in groups:
            for item in group.get("toplist") or []:
                rows.append(
                    {
                        "id": str(item["topId"]),
                        "name": item.get("title", ""),
                        "category": group.get("groupName", ""),
                        "cover": chart_cover(item.get("frontPicUrl") or item.get("headPicUrl")),
                        "update": item.get("updateTips") or item.get("updateTime") or "",
                        "track_count": item.get("totalNum", 0),
                        "description": item.get("intro") or "",
                    }
                )
    elif platform == "qishui":
        rows = qishui_api.chart_catalog()
    elif platform == "kugou":
        payload = kugou_transport.kg_http_json(
            "https://mobiles.kugou.com/api/v3/rank/list?version=9108&plat=0&showtype=2&withsong=0"
        )
        data = payload.get("data") or {}
        if payload.get("status") != 1 or not isinstance(data.get("info"), list):
            raise ValueError("酷狗榜单目录暂时不可用")

        def visit(items):
            for item in items:
                if item.get("rankid"):
                    rows.append(
                        {
                            "id": str(item["rankid"]),
                            "name": item.get("rankname", ""),
                            "category": "音乐榜",
                            "cover": chart_cover(
                                item.get("img_cover")
                                or item.get("imgurl")
                                or item.get("banner7url")
                            ),
                            "update": item.get("update_frequency") or "",
                            "description": item.get("intro") or "",
                            "track_count": ((item.get("extra") or {}).get("resp") or {}).get(
                                "all_total", 0
                            ),
                        }
                    )
                visit(item.get("children") or [])

        visit(data["info"])
    charts, excluded, seen = ([], [], set())
    for row in rows:
        if row["id"] in seen:
            continue
        seen.add(row["id"])
        row["platform"] = platform
        row["description"] = re.sub("<[^>]+>", " ", row["description"]).strip()
        (charts if chart_allowed(row["name"], row["category"]) else excluded).append(row)
    result = {
        "platform": platform,
        "charts": charts,
        "total": len(charts),
        "upstream_total": len(seen),
        "excluded": [{"id": row["id"], "name": row["name"]} for row in excluded],
        "complete": True,
    }
    return result


def charts_response(one, flag):
    """目录允许单平台或全部；单个平台失败时保留其他结果，并明确给出错误与完整性。"""
    raw = one("platform").strip()
    selected = list(CHART_PLATFORMS) if raw in ("", "all") else [api_params.platform_of(raw)]
    if not all(selected):
        return (400, {"msg": "未知 platform，请使用 all/netease/qqmusic/kugou/qishui"})

    def fetch(platform):
        try:
            result = chart_cached(
                "catalog_" + platform,
                3600,
                lambda: chart_catalog_platform(platform),
                flag("refresh"),
            )
            return (platform, result, "")
        except Exception:
            return (
                platform,
                None,
                api_params.PLATFORM_NAMES[platform] + "榜单目录暂时不可用，请重试",
            )

    with ThreadPoolExecutor(max_workers=len(selected)) as pool:
        results = request_credentials.map_with_context(pool, fetch, selected)
    charts, counts, excluded, errors = ([], {}, {}, {})
    for platform, result, error in results:
        if error:
            errors[platform] = error
            counts[platform] = 0
        else:
            charts.extend(result["charts"])
            counts[platform] = result["total"]
            excluded[platform] = result["excluded"]
    return (
        200 if charts or not errors else 502,
        {
            "charts": charts,
            "total": len(charts),
            "counts": counts,
            "excluded": excluded,
            "errors": errors,
            "complete": not errors,
            "request_type": "charts",
        },
    )


def chart_netease_tracks(chart_id):
    """详情的 tracks 可能截断；始终用 trackIds 的完整顺序补齐缺失歌曲。"""
    payload = netease_transport.ne_http_json(
        netease_config.ne_BASE
        + "/api/v6/playlist/detail?"
        + urllib.parse.urlencode({"id": chart_id, "n": 100000, "s": 0})
    )
    playlist = payload.get("playlist") or {}
    if payload.get("code") != 200 or not playlist:
        raise ValueError("网易云榜单歌曲暂时不可用")
    ids = [str(item["id"]) for item in playlist.get("trackIds") or []]
    tracks = {str(item["id"]): item for item in playlist.get("tracks") or []}
    missing = [song_id for song_id in ids if song_id not in tracks]
    for offset in range(0, len(missing), 200):
        batch = missing[offset : offset + 200]
        detail = netease_transport.ne_http_json(
            netease_config.ne_BASE
            + "/api/v3/song/detail?"
            + urllib.parse.urlencode({"c": json.dumps([{"id": song_id} for song_id in batch])})
        )
        tracks.update({str(item["id"]): item for item in detail.get("songs") or []})
    ordered = (
        [tracks[song_id] for song_id in ids if song_id in tracks] if ids else list(tracks.values())
    )
    songs = [
        api_aggregate._aggregate_song(
            "netease", netease_search_views.nes__song_row(item), index + 1
        )
        for index, item in enumerate(ordered)
    ]
    total = max(len(ids), api_params._int(playlist.get("trackCount"), 0), len(songs))
    return (songs, total)


def chart_paged_tracks(platform, chart_id):
    """QQ 按 offset/num，酷狗按 page/pagesize，持续翻页直到达到上游 total。

    去重仅用于防止上游重复页造成死循环；不会跨榜单合并，也不会按歌曲名删版本。
    酷狗固定第一页给出的 rank_cid，保证后续页属于同一期榜单。
    """
    songs, seen, offset, period_id, page = ([], set(), 0, None, 1)
    total = None
    while total is None or offset < total:
        if platform == "qqmusic":
            payload = qqmusic_transport.qq_musicu(
                {
                    "comm": {"ct": 24, "cv": 0},
                    "req_1": {
                        "module": "musicToplist.ToplistInfoServer",
                        "method": "GetDetail",
                        "param": {"topId": int(chart_id), "offset": offset, "num": 100},
                    },
                }
            )
            result = payload.get("req_1") or {}
            data = result.get("data") or {}
            if result.get("code") != 0:
                raise ValueError("QQ 音乐榜单歌曲暂时不可用")
            rows = data.get("songInfoList") or []
            total = api_params._int((data.get("data") or {}).get("totalNum"), len(rows))
            converted = [
                api_aggregate._aggregate_song(
                    platform, qqmusic_search_views.qqs_song_row(row), offset + index + 1
                )
                for index, row in enumerate(rows)
            ]
        else:
            params = {"rankid": chart_id, "page": page, "pagesize": 100, "plat": 0, "version": 9108}
            if period_id:
                params["rank_cid"] = period_id
            payload = kugou_transport.kg_http_json(
                "https://mobiles.kugou.com/api/v3/rank/song?" + urllib.parse.urlencode(params)
            )
            if payload.get("status") != 1:
                raise ValueError("酷狗榜单歌曲暂时不可用")
            data = payload.get("data") or {}
            rows = data.get("info") or []
            total = api_params._int(data.get("total"), len(rows))
            if rows and period_id is None:
                period_id = rows[0].get("rank_cid")
            converted = []
            for index, row in enumerate(rows):
                filename = row.get("filename") or ""
                title = row.get("songname") or filename.split(" - ", 1)[-1]
                artist = "/".join(
                    (author.get("author_name", "") for author in row.get("authors") or [])
                )
                artist = artist or (filename.split(" - ", 1)[0] if " - " in filename else "")
                converted.append(
                    api_aggregate._aggregate_song(
                        platform,
                        {
                            "name": title,
                            "singer": artist,
                            "hash": row.get("hash"),
                            "album_audio_id": str(row.get('album_audio_id') or row.get('mixsongid') or ''),
                            "mixsongid": str(row.get('mixsongid') or row.get('album_audio_id') or ''),
                            "duration": row.get("duration", 0),
                            "album": row.get("album_name") or "",
                            "cover": chart_cover(
                                row.get("album_sizable_cover")
                                or (row.get("trans_param") or {}).get("union_cover")
                            ),
                        },
                        offset + index + 1,
                    )
                )
        before = len(songs)
        for song in converted:
            key = song["sources"][0]["key"]
            if key and key not in seen:
                seen.add(key)
                songs.append(song)
        if not rows or len(songs) == before:
            break
        offset += len(rows)
        page += 1
    return (songs, max(total or 0, len(songs)))


def chart_detail_response(one, flag):
    """仅开放目录内允许的音乐榜；显式请求被过滤的说唱/有声榜也返回 404。"""
    platform = api_params.platform_of(one("platform"))
    chart_id = one("id", "chart_id").strip()
    pattern = "[A-Za-z0-9_-]{1,80}" if platform == "qishui" else "[1-9][0-9]{0,19}"
    if not platform or not re.fullmatch(pattern, chart_id):
        return (400, {"msg": "榜单需指定 platform=netease/qqmusic/kugou/qishui 和目录中的 id"})
    try:
        catalog = chart_cached(
            "catalog_" + platform, 3600, lambda: chart_catalog_platform(platform)
        )
        chart = next((row for row in catalog["charts"] if row["id"] == chart_id), None)
        if chart is None:
            return (404, {"msg": "未找到可用音乐榜单，该榜单可能已下架或属于已过滤分类"})

        def load():
            if platform == "qishui":
                rows, total = qishui_api.chart_tracks(chart_id)
                songs = [
                    api_aggregate._aggregate_song(platform, row, index + 1)
                    for index, row in enumerate(rows)
                ]
            else:
                songs, total = (
                    chart_netease_tracks(chart_id)
                    if platform == "netease"
                    else chart_paged_tracks(platform, chart_id)
                )
            complete = len(songs) >= total
            return {
                "platform": platform,
                "request_type": "chart",
                "chart": chart,
                "songs": songs,
                "total": total,
                "count": len(songs),
                "complete": complete,
                "msg": "" if complete else "上游未返回完整榜单，请稍后重试",
            }

        return (
            200,
            chart_cached("tracks_" + platform + "_" + chart_id, 900, load, flag("refresh")),
        )
    except Exception:
        return (
            502,
            {
                "msg": api_params.PLATFORM_NAMES[platform] + "榜单歌曲加载失败，请重试",
                "complete": False,
            },
        )
