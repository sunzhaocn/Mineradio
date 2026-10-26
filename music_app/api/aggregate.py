"""多平台搜索聚合、歌曲归一化和去重。"""

import re
import time
import unicodedata
from concurrent.futures import ThreadPoolExecutor
from music_app.core import request_credentials
from music_app.api import params as api_params
from music_app.providers.kugou import search as kugou_search
from music_app.providers.kugou import transport as kugou_transport
from music_app.providers.netease import search as netease_search
from music_app.providers.qishui import api as qishui_api
from music_app.providers.qqmusic import search as qqmusic_search

_BRACKET_TEXT = re.compile("[（(\\[【]([^）)\\]】]*)[）)\\]】]")


_TITLE_METADATA = re.compile(
    "原唱|原唱版|原版|original|无损|flac|hi[ -]?res|\\d+\\s*k(?:bps)?", re.I
)


_ARTIST_SEP = re.compile("[/、,，&;；]|\\bfeat\\.?\\s+|\\bft\\.?\\s+", re.I)


_AGG_SEARCH_ALIAS = ("search", "seach", "keyword", "k", "q", "wd", "s", "w")


_AGG_PLATFORMS = ("netease", "kugou", "qqmusic", "qishui")


def norm_full(text):
    """统一全角/半角、大小写、标点与空白，与网页的同曲识别保持一致。"""
    value = unicodedata.normalize("NFKC", str(text or "")).lower()
    return "".join(
        (
            char
            for char in value
            if not char.isspace() and unicodedata.category(char)[0] not in ("P", "Z")
        )
    )


def norm_dedupe(text):
    """只剔除明确音质/原唱说明；Live、粤语、翻唱和场次等标题信息必须保留。"""
    value = unicodedata.normalize("NFKC", str(text or ""))
    return norm_full(
        _BRACKET_TEXT.sub(
            lambda match: "" if _TITLE_METADATA.fullmatch(match[1].strip()) else match[0], value
        )
    )


def artist_tokens(artists):
    """把歌手列表按 /、逗号、& 等分隔符拆开，返回规范化后的歌手名集合。"""
    out = set()
    for artist in artists or []:
        value = unicodedata.normalize("NFKC", str(artist or ""))
        for part in _ARTIST_SEP.split(value):
            key = norm_full(part)
            if key and key not in {
                "未知",
                "未知歌手",
                "佚名",
                "群星",
                "unknown",
                "unknownartist",
                "variousartists",
            }:
                out.add(key)
    return out


def _duration_text(text):
    """将 分:秒 字符串转换为秒；不符合格式时返回 0。"""
    match = re.fullmatch("(\\d+):(\\d{2})", str(text or "").strip())
    return int(match.group(1)) * 60 + int(match.group(2)) if match else 0


def song_meta(platform, item):
    """从各平台 simple 视图的一条 song 里取 (标题, 歌手列表, 专辑, 秒)。"""
    if platform == "qishui":
        artists = [
            name for name in (item.get("artist") or item.get("author") or "").split(" / ") if name
        ]
        try:
            duration = max(0, int(float(item.get("duration_s") or 0)))
        except (TypeError, ValueError, OverflowError):
            duration = 0
        return (
            item.get("title") or item.get("name") or "",
            artists,
            item.get("album") or "",
            duration,
        )
    if platform == "kugou":
        artists = [item.get("singer")] if item.get("singer") else []
        return (
            item.get("name") or "",
            artists,
            item.get("album") or "",
            api_params._int(item.get("duration"), 0),
        )
    if platform == "netease":
        artists = item.get("artists") or ([item.get("singer")] if item.get("singer") else [])
        duration = api_params._int((item.get("duration_ms") or 0) / 1000, 0) or _duration_text(
            item.get("duration")
        )
        return (item.get("name") or "", artists, item.get("album") or "", duration)
    artists = item.get("singers") or ([item.get("singer")] if item.get("singer") else [])
    duration = api_params._int(item.get("duration_s"), 0) or _duration_text(item.get("duration"))
    return (item.get("name") or "", artists, item.get("album") or "", duration)


def _aggregate_song(platform, item, rank):
    """将某平台的一条精简搜索记录转为聚合 songs 的统一字段。
    sources 保存原平台、歌曲标识、标识参数名与搜索排名，便于后续按来源请求详情。"""
    title, artists, album, duration = song_meta(platform, item)
    if platform == "kugou":
        key = item.get("emix_id") or item.get("hash") or ""
        key_param = "url" if item.get("emix_id") else "hash"
    elif platform in ("netease", "qishui"):
        key, key_param = (str(item.get("id") or ""), "id")
    else:
        key, key_param = (item.get("mid") or "", "url")
    artists = [a for a in artists if a]
    result = {
        "title": title,
        "artists": artists,
        "artist": "/".join(artists),
        "album": album,
        "duration": duration,
        "cover": item.get("cover") or "",
        "sources": [{"platform": platform, "key": key, "key_param": key_param, "rank": rank}],
        "platforms": [platform],
    }
    if platform == "qishui":
        for name in ("vipRequired", "paid", "qualityVip", "qualityVipKeys", "isOriginal", "badges"):
            if name in item:
                result[name] = item[name]
    if platform == 'kugou':
        for name in ('album_audio_id', 'mixsongid', 'emix_id'):
            if item.get(name):
                result[name] = item[name]
                if name != 'emix_id':
                    result['sources'][0][name] = item[name]
    for name in ('artist_refs', 'artist_id', 'artist_mid', 'album_id', 'album_mid'):
        if item.get(name):
            result[name] = item[name]
    for name in ("version", "versionName", "version_name"):
        if item.get(name):
            result["version"] = str(item[name])
            break
    return result


def _same_aggregate_song(a, b):
    """同标题、完整歌手集合和明确版本才合并；缺歌手时不猜。

    专辑名与剪辑时长不用于判断版本，避免平台编辑差异破坏同曲去重。
    明确的现场、翻唱、伴奏等说明保留在标题中，不能把不同录音变成同一音源。
    """
    ta, tb = (norm_dedupe(a.get("title") or ""), norm_dedupe(b.get("title") or ""))
    if not ta or ta != tb:
        return False
    av, bv = (norm_full(a.get("version")), norm_full(b.get("version")))
    if av != bv:
        return False
    aa, bb = (artist_tokens(a.get("artists")), artist_tokens(b.get("artists")))
    return bool(aa) and aa == bb


def merge_aggregate(by_platform, platforms):
    """跨平台轮询去重：同一首只留一条，sources 记录它在各平台的 ID。"""
    merged = []
    max_rank = max((len(rows) for rows in by_platform.values()), default=0)
    for rank in range(max_rank):
        for platform in platforms:
            rows = by_platform.get(platform) or []
            if rank >= len(rows):
                continue
            track = rows[rank]
            same = None
            for candidate in merged:
                if not _same_aggregate_song(candidate, track):
                    continue
                if any((src["platform"] == platform for src in candidate["sources"])):
                    continue
                same = candidate
                break
            if same is None:
                merged.append(track)
                continue
            same["sources"].extend(track["sources"])
            same["platforms"] = list(dict.fromkeys((src["platform"] for src in same["sources"])))
    return merged


def aggregate_search(one, flag):
    """/all（type=all）：四平台并发搜索，同曲合并且保留每个平台的歌曲 ID。"""
    kw = one(*_AGG_SEARCH_ALIAS).strip()
    if not kw:
        return (400, {"error_code": 400, "msg": "缺少参数 search，例: /all?type=all&search=周杰伦"})
    size = min(100, max(1, api_params._int(one("size", "pagesize", "limit"), 30)))
    raw_prefer = one("prefer") or ",".join(_AGG_PLATFORMS)
    prefer = [
        api_params.platform_of(p.strip()) for p in re.split("[,，\\s]+", raw_prefer) if p.strip()
    ]
    prefer = list(dict.fromkeys((p for p in prefer if p in _AGG_PLATFORMS))) or list(_AGG_PLATFORMS)

    def fetch(platform):
        rows = 0
        try:
            if platform == "kugou":
                data = kugou_transport.kgs_fetch_upstream(
                    kugou_transport.kgs_build_upstream(kw, 1, min(size, 480))
                )
                view = kugou_search.kgs_simple_view(data, with_url=False)
            elif platform == "netease":
                rows = min(size, 100)
                view = netease_search.nes_simple_view(
                    netease_search.nes_fetch_search(kw, 1, rows, 0), kw, 1, rows, 0
                )
            elif platform == "qishui":
                view = qishui_api.search(kw, size=min(size, 100), page=1)
            else:
                rows = min(size, 50)
                view = qqmusic_search.qqs_simple_view(
                    qqmusic_search.qqs_fetch_search(kw, 1, rows, 0), kw, 1, 1, rows
                )
            songs = view.get("songs") or []
            if not songs and platform == "qqmusic":
                time.sleep(1.2)
                view = qqmusic_search.qqs_simple_view(
                    qqmusic_search.qqs_fetch_search(kw, 1, rows, 0), kw, 1, 1, rows
                )
                songs = view.get("songs") or []
            normalized = [
                _aggregate_song(platform, item, index + 1) for index, item in enumerate(songs)
            ]
            return (platform, normalized, "")
        except Exception:
            return (platform, [], api_params.PLATFORM_NAMES[platform] + "搜索暂时不可用")

    with ThreadPoolExecutor(max_workers=len(prefer)) as pool:
        results = request_credentials.map_with_context(pool, fetch, prefer)
    by_platform, counts, errors = ({}, {}, {})
    for platform, rows, error in results:
        counts[platform] = len(rows)
        by_platform[platform] = rows
        if error:
            errors[platform] = error
    merged = merge_aggregate(by_platform, prefer)
    if not merged and (not any(counts.values())):
        return (
            502,
            {
                "error_code": 502,
                "msg": "所选平台均未搜到歌曲（无匹配结果、上游限流或接口异常）",
                "counts": counts,
                "errors": errors,
                "complete": not errors,
            },
        )
    for track in merged:
        track["platforms"] = list(dict.fromkeys((src["platform"] for src in track["sources"])))
    max_results = api_params._int(one("max_results", "top"), 0)
    if max_results > 0:
        merged = merged[:max_results]
    return (
        200,
        {
            "type": "all",
            "keyword": kw,
            "counts": counts,
            "errors": errors,
            "complete": not errors,
            "total": len(merged),
            "songs": merged,
            "picked": merged[0] if merged else None,
            "scored": False,
            "note": "已跨平台去重，按平台轮询顺序输出（不做权重排序）",
        },
    )
