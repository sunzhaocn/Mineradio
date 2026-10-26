"""平台适配：netease / music。"""

import base64
from music_app.core import results as core_results
from music_app.providers.netease import lyrics as netease_lyrics
from music_app.providers.netease import metadata as netease_metadata
from music_app.providers.netease import quality as netease_quality


def ne_get_music(target, quality="auto", with_lyric=True, with_krc=False, cookie=None, *, playback_only=False, allow_quality_fallback=False):
    """网易云歌曲主流程；由 netease_music 调用。
    1. 数字 ID/分享链接直接定位；关键词则搜索并取第一条。
    2. ne_song_detail 补元信息，ne_get_qualities 获取各音质直链。
    3. ne_pick_quality 选档，补原文 lrc、翻译 tlyric 和 romalrc→roma。
    4. 按需将 klyric 编为 Base64；局部异常追加到 error。
    统一字段 hash 在此平台存歌曲 ID，不是文件 MD5。"""
    out = core_results.new_music_result(target, quality)
    out['qualitiesComplete'] = not playback_only
    kind, val = netease_metadata.ne_parse_target(target)
    if not kind:
        out["error"] = "无法识别输入（歌曲 id / music.163.com/song?id= / 歌名）"
        return out
    song_id = ""
    if kind == "id":
        song_id = val
        out["source"] = "netease"
    else:
        try:
            hits = netease_metadata.ne_search_songs(val, 5, cookie)
        except Exception as e:
            out["error"] = "搜索失败: %s" % e
            return out
        if not hits:
            out["error"] = "搜索无结果: %s" % val
            return out
        song_id = str(hits[0]["id"])
        out["source"] = "netease/api/search/get(取首条)"
        pre = hits[0]
        out.update(
            {
                "title": pre.get("name") or "",
                "author": "/".join(pre.get("singers") or []),
                "album": pre.get("album") or "",
                "duration_s": round((pre.get("duration_ms") or 0) / 1000.0, 3),
                "hash": song_id,
            }
        )
        out.update(netease_metadata.ne_cover_fields(pre.get("cover") or ""))
    song_detail = {}
    try:
        song_detail = netease_metadata.ne_song_detail(song_id, cookie)
        meta = netease_metadata.ne__from_detail(song_detail)
        if meta:
            src_tag = out["source"]
            out.update({k: v for k, v in meta.items() if v not in ("", None)})
            out["source"] = src_tag
    except Exception as e:
        out["error"] = (out["error"] + " | " if out["error"] else "") + "详情失败: %s" % e
    try:
        arguments = dict(playback_quality=quality, allow_quality_fallback=allow_quality_fallback) if playback_only else {}
        items = netease_quality.ne_get_qualities(song_id, cookie, song_detail=song_detail, **arguments)
    except Exception as e:
        items = []
        out["error"] = (out["error"] + " | " if out["error"] else "") + "音质失败: %s" % e
    out["qualities"] = [
        {
            "key": i["key"],
            "quality": i["quality"],
            "hash": i["hash"],
            "filesize": i["filesize"],
            "privilege": i["privilege"],
            "available": i["available"],
            "source_available": i.get("source_available"),
            "bitrate": i["bitrate"],
            "encode": i.get("encode", ""),
            "kind": i.get("kind", ""),
            "url": i["url"],
        }
        for i in items
    ]
    chosen = next((item for item in items if item['available']), None) if playback_only else netease_quality.ne_pick_quality(items, quality)
    if chosen:
        out.update(
            {
                "quality": chosen["quality"],
                "quality_key": chosen["key"],
                "url": chosen["url"],
                "backup_url": chosen["backup_url"] or "",
                "filesize": chosen["filesize"],
                "bitrate": chosen["bitrate"],
                "kind": chosen["kind"],
                "hash": chosen["hash"],
            }
        )
    elif items:
        out["error"] = (
            out["error"] + " | " if out["error"] else ""
        ) + "音质 %s 不可用（可用: %s）" % (
            quality,
            ",".join((x["quality"] for x in items if x["available"])) or "无",
        )
    if with_lyric and song_id:
        try:
            ly = netease_lyrics.ne_get_lyric(song_id, cookie)
            out["lrc"] = ly.get("lrc") or ""
            out["tlyric"] = ly.get("tlyric") or ""
            out["roma"] = ly.get("romalrc") or ""
            out["lrc_lines"] = (
                len([x for x in out["lrc"].splitlines() if x.strip()]) if out["lrc"] else 0
            )
            out["lyric_id"] = song_id if out["lrc"] else ""
            out["lyric_title"] = out["title"]
            out["lyric_singer"] = out["author"]
            if with_krc and ly.get("klyric"):
                out["krc_base64"] = base64.b64encode(ly["klyric"].encode("utf-8")).decode()
        except Exception as e:
            out["error"] = (out["error"] + " | " if out["error"] else "") + "歌词失败: %s" % e
    return out


def ne_simple_view(r):
    """精简视图：接入端只取这几个字段"""
    return {
        "source": r.get("source"),
        "title": r["title"],
        "author": r["author"],
        "album": r["album"],
        "duration": r["duration_s"],
        "hash": r["hash"],
        "quality": r["quality"],
        "bitrate": r["bitrate"],
        "filesize": r["filesize"],
        "url": r["url"],
        "cover": r["cover"],
        "lyric": r["lrc"],
        "qualities": [
            {
                "quality": q["quality"],
                "available": q["available"],
                "bitrate": q["bitrate"],
                "filesize": q["filesize"],
            }
            for q in r["qualities"]
        ],
        "error": r["error"],
    }


ne__CACHE, ne__CACHE_TTL = ({}, 300)


def ne_cached_playback(target, quality, allow_quality_fallback=False):
    return core_results.cached_result(ne__CACHE, ('playback', target, quality, allow_quality_fallback), ne__CACHE_TTL,
        ne_get_music, target, quality=quality, with_lyric=False, playback_only=True,
        allow_quality_fallback=allow_quality_fallback)


def ne_cached_music(target, quality, with_lyric):
    """网易云详情缓存入口；输入、音质和歌词开关不同的请求分别缓存。"""
    key = (target, quality, with_lyric)
    return core_results.cached_result(
        ne__CACHE, key, ne__CACHE_TTL, ne_get_music, target, quality=quality, with_lyric=with_lyric
    )
