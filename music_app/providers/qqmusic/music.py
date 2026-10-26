"""平台适配：qqmusic / music。"""

from music_app.core import results as core_results
from music_app.providers.qqmusic import lyrics as qqmusic_lyrics
from music_app.providers.qqmusic import metadata as qqmusic_metadata
from music_app.providers.qqmusic import quality as qqmusic_quality
from music_app.providers.qqmusic import transport as qqmusic_transport


def qq_get_music(target, quality="auto", with_lyric=True, with_krc=False, cookie=None, *, playback_only=False, allow_quality_fallback=False):
    """QQ 音乐歌曲主流程；由 qq_music 调用。
    1. qq_parse_target 识别 songmid、数字 songid、分享链接或关键词。
    2. 歌名搜索取首条；详情补 media_mid（音频文件标识）及专辑/歌手信息。
    3. qq_get_qualities 通过 vkey 申请各档直链，qq_pick_quality 选择本次档位。
    4. 按需取原文、翻译、可读罗马音和假名；局部错误写入 error。
    with_krc 保留兼容签名，目前此流程不输出 QQ 加密逐字歌词。"""
    out = core_results.new_music_result(target, quality)
    out['qualitiesComplete'] = not playback_only
    out.update({"album_mid": "", "song_id": 0, "media_mid": "", "kana": "", "trans": ""})
    kind, val = qqmusic_metadata.qq_parse_target(target)
    if not kind:
        out["error"] = "无法识别输入（songmid / 数字 songid / y.qq.com songDetail 链接 / 歌名）"
        return out
    meta = {}
    if kind == "search":
        try:
            body = qqmusic_metadata.qq_search_body(val, 1, 5, 0, cookie)
        except Exception as e:
            if playback_only:
                raise
            out["error"] = "搜索失败: %s" % e
            return out
        rows = (body.get("song") or {}).get("list") or []
        if not rows:
            out["error"] = "搜索无结果: %s（上游有时会软限流，稍等 2 秒重试）" % val
            return out
        row = rows[0]
        mid = str(row.get("mid") or "")
        out["source"] = "musicu.fcg/DoSearchForQQMusicDesktop(取首条)"
        track = qqmusic_metadata.qq_song_detail(mid, cookie=cookie, strict=playback_only)
        meta = qqmusic_metadata.qq__from_track(track) if track else {}
        if not meta:
            meta = qqmusic_metadata.qq__from_row(row)
    else:
        if kind == "songid":
            mid = ""
            track = qqmusic_metadata.qq_song_detail(song_id=val, cookie=cookie, strict=playback_only)
        else:
            mid = val
            track = qqmusic_metadata.qq_song_detail(val, cookie=cookie, strict=playback_only)
        meta = qqmusic_metadata.qq__from_track(track) if track else {}
        if not meta:
            out["error"] = "详情为空（songmid 无效 / 曲库无此曲）"
            return out
        mid = meta.get("hash") or mid
        out["source"] = meta.get("source")
    if not mid:
        out["error"] = out["error"] or "没有解析到 songmid"
        return out
    out.update({k: v for k, v in meta.items() if v not in ("", None, [], {})})
    out["source"] = out["source"] or meta.get("source")
    out["hash"] = mid
    out.update(qqmusic_metadata.qq_cover_fields(out.get("album_mid") or ""))
    out.update(qqmusic_metadata.qq_singer_avatar_fields(meta.get("singers") or []))
    try:
        arguments = dict(playback_quality=quality, allow_quality_fallback=allow_quality_fallback) if playback_only else {}
        items = qqmusic_quality.qq_get_qualities(
            mid, out.get("media_mid") or mid, meta.get("sizes") or {}, cookie, **arguments)
    except Exception as e:
        if playback_only:
            # A transient transport failure must not become a cached negative
            # playback result or be mistaken for confirmed unavailable audio.
            raise
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
            "encode": i["encode"],
            "note": i["note"],
            "url": i["url"],
        }
        for i in items
    ]
    chosen = next((item for item in items if item['available']), None) if playback_only else qqmusic_quality.qq_pick_quality(items, quality)
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
            }
        )
    elif items:
        out["error"] = (
            out["error"] + " | " if out["error"] else ""
        ) + "音质 %s 不可用（可用: %s）" % (
            quality,
            ",".join((x["quality"] for x in items if x["available"])) or "无",
        )
        if not qqmusic_transport.qq_cookie_fields(cookie)["uin"]:
            out["error"] += "；未配置 Cookie，游客只有免费曲的 128k/AAC"
    if with_lyric and mid:
        try:
            ly = qqmusic_lyrics.qq_get_lyric(mid, cookie)
            out["lrc"] = ly.get("lrc") or ""
            out["trans"] = ly.get("trans") or ""
            out["tlyric"] = ly.get("tlyric") or out["trans"]
            out["roma"] = ly.get("roma") or ""
            out["kana"] = ly.get("kana") or ""
            out["lrc_lines"] = (
                len([x for x in out["lrc"].splitlines() if x.strip()]) if out["lrc"] else 0
            )
            out["lyric_id"] = mid if out["lrc"] else ""
            out["lyric_title"] = out["title"]
            out["lyric_singer"] = out["author"]
        except Exception as e:
            out["error"] = (out["error"] + " | " if out["error"] else "") + "歌词失败: %s" % e
    return out


def qq_simple_view(r):
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


qq__CACHE, qq__CACHE_TTL = ({}, 300)


def qq_cached_playback(target, quality, allow_quality_fallback=False):
    return core_results.cached_result(qq__CACHE, ('playback', target, quality, allow_quality_fallback), qq__CACHE_TTL,
        qq_get_music, target, quality=quality, with_lyric=False, playback_only=True,
        allow_quality_fallback=allow_quality_fallback)


def qq_cached_music(target, quality, with_lyric, cookie=None):
    """QQ 详情缓存入口；原缓存键区分游客/有 uin，不区分不同登录账号。
    保留原有行为；运行中更换账号时应清空缓存或重启。"""
    key = (target, quality, with_lyric, bool(qqmusic_transport.qq_cookie_fields(cookie)["uin"]))
    return core_results.cached_result(
        qq__CACHE,
        key,
        qq__CACHE_TTL,
        qq_get_music,
        target,
        quality=quality,
        with_lyric=with_lyric,
        cookie=cookie,
    )
