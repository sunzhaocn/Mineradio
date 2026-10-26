"""平台适配：kugou / music。"""

import base64
from music_app.core import results as core_results
from music_app.providers.kugou import lyrics as kugou_lyrics
from music_app.providers.kugou import metadata as kugou_metadata
from music_app.providers.kugou import quality as kugou_quality


def kg_get_music(target, quality="auto", with_lyric=True, with_krc=False, cookie=None, *, playback_only=False, allow_quality_fallback=False):
    """酷狗歌曲主流程；由 kugou_music 调用，结果交给 music_response 输出。
    1. kg_parse_target 识别 eid、hash 或已有 MP3 直链。
    2. songinfo/按 hash 回退接口填充标题、歌手、专辑及图片。
    3. kg_get_qualities 枚举音质，kg_pick_quality 选择本次播放档位。
    4. with_lyric=True 时补歌词；with_krc=True 时额外输出原始 KRC 的 Base64。
    局部失败尽量保留已得到的数据，并写入 error；传入直链的 auto 模式保留原地址。"""
    kind, val = kugou_metadata.kg_parse_target(target)
    out = core_results.new_music_result(target, quality)
    out['qualitiesComplete'] = not playback_only
    if not kind:
        out["error"] = (
            "无法识别输入（player.htm#锚点 / mixsong 页 / encode id / 签名直链 / 32位hash）"
        )
        return out
    base_info = {}
    if kind == "eid":
        try:
            raw = kugou_metadata.kg_songinfo(val, cookie)
            base_info = raw.get("data") or {}
            if not isinstance(base_info, dict):
                base_info = {}
            out.update(kugou_metadata.kg__from_songinfo(raw))
            if not out["title"] and (not out["url"]):
                out["error"] = "songinfo 无数据（id 无效 / 曲库无此曲）"
                return out
        except Exception as e:
            out["error"] = "songinfo 失败: %s" % e
            return out
    elif kind == "mp3":
        out.update(
            {
                "source": "input-url",
                "url": target.strip(),
                "hash": val.upper(),
                "kind": (
                    "完整版"
                    if "/yp/full/" in target
                    else "试听切片" if "/yp/p_" in target else "未知"
                ),
            }
        )
        meta = kugou_metadata.kg_songinfo_by_hash(val)
        if meta:
            for k in ("url", "backup_url", "kind"):
                meta.pop(k, None)
            out.update({k: v for k, v in meta.items() if v not in ("", None)})
        else:
            out.update(
                {
                    k: v
                    for k, v in kugou_metadata.kg_info_by_hash(val).items()
                    if v not in ("", None)
                }
            )
    else:
        out["hash"] = val.upper()
        meta = kugou_metadata.kg_songinfo_by_hash(val)
        if meta:
            out.update({k: v for k, v in meta.items() if v not in ("", None)})
        else:
            out.update(
                {
                    k: v
                    for k, v in kugou_metadata.kg_info_by_hash(val).items()
                    if v not in ("", None)
                }
            )
    album_id = str(base_info.get("album_id") or out.get("album_id") or "")
    hash_128 = out.get("hash") or ""
    if hash_128:
        if not album_id:
            album_id = kugou_quality.kg_album_id_of(hash_128, cookie)
            if album_id:
                out["album_id"] = album_id
        try:
            if playback_only:
                items = kugou_quality.kg_get_qualities(hash_128, album_id, cookie,
                    playback_quality=quality, allow_quality_fallback=allow_quality_fallback)
            else:
                items = kugou_quality.kg_get_qualities(hash_128, album_id, cookie)
        except Exception:
            items = []
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
        chosen = next((item for item in items if item['available']), None) if playback_only else kugou_quality.kg_pick_quality(items, quality)
        if chosen:
            out["quality"] = chosen["quality"]
            out["quality_key"] = chosen["key"]
            if kind != "mp3" or (quality or "auto") not in ("", "auto"):
                out["url"] = chosen["url"]
                out["backup_url"] = chosen["backup_url"]
                out["filesize"] = chosen["filesize"]
                out["bitrate"] = chosen["bitrate"]
                out["kind"] = chosen["kind"]
            out["hash"] = chosen["hash"]
        elif items:
            out["error"] = (
                out["error"] + " | " if out["error"] else ""
            ) + "音质 %s 不可用（可用: %s）" % (
                quality,
                ",".join((x["quality"] for x in items if x["available"])) or "无",
            )
    if with_lyric and out["hash"]:
        try:
            ly = kugou_lyrics.kg_get_lyric(out["hash"], int(out.get("duration_s") or 0))
            out["lrc"] = ly.get("lrc") or ""
            out["tlyric"] = ly.get("tlyric") or ""
            out["roma"] = ly.get("roma") or ""
            out["lrc_lines"] = (
                len([x for x in out["lrc"].splitlines() if x.strip()]) if out["lrc"] else 0
            )
            out["lyric_id"] = ly.get("id") or ""
            out["lyric_title"] = ly.get("title") or ""
            out["lyric_singer"] = ly.get("singer") or ""
            if with_krc and ly.get("krc"):
                out["krc_base64"] = base64.b64encode(ly["krc"]).decode()
            if not out["title"] and out["lyric_title"]:
                out["title"] = out["lyric_title"]
            if not out["author"] and out["lyric_singer"]:
                out["author"] = out["lyric_singer"]
        except Exception as e:
            out["error"] = (out["error"] + " | " if out["error"] else "") + "歌词失败: %s" % e
    return out


def kg_simple_view(r):
    """精简视图：接入端只取这几个字段"""
    return {
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


kg__CACHE, kg__CACHE_TTL = ({}, 300)


def kg_cached_music(target, quality, with_lyric):
    """酷狗详情的缓存入口；键包含输入、目标音质和歌词开关，TTL 见 kg__CACHE_TTL。"""
    key = (target, quality, with_lyric)
    return core_results.cached_result(
        kg__CACHE, key, kg__CACHE_TTL, kg_get_music, target, quality=quality, with_lyric=with_lyric
    )


def kg_cached_playback(target, quality, allow_quality_fallback=False):
    return core_results.cached_result(kg__CACHE, ('playback', target, quality, allow_quality_fallback), kg__CACHE_TTL,
        kg_get_music, target, quality=quality, with_lyric=False, playback_only=True,
        allow_quality_fallback=allow_quality_fallback)
