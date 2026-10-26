"""平台适配：kugou / quality。"""

from music_app.providers.kugou import config as kugou_config
from music_app.providers.kugou import metadata as kugou_metadata
from music_app.providers.kugou import transport as kugou_transport
from music_app.core.playback_quality import candidate_keys
from music_app.core import request_lifecycle


def kg_quality_table(hash_128):
    """对应酷狗 /api/v3/song/info：从 extra 提取各音质自己的 hash、大小和权限。
    按 kg_QUALITY_LADDER 映射字段；这里只读取音质元数据，不保证能获得播放地址。"""
    try:
        data = (
            kugou_transport.kg_http_json(
                kugou_config.kg_SONGINFO_BY_HASH + "?hash=" + hash_128
            ).get("data")
            or {}
        )
    except Exception:
        return {}
    extra = data.get("extra") or {}
    out = {}
    for key, label, hk, sk, pk in kugou_config.kg_QUALITY_LADDER:
        h = (extra.get(hk) or "").strip()
        if not h:
            continue
        out[key] = {
            "label": label,
            "hash": h.upper(),
            "filesize": extra.get(sk) or 0,
            "privilege": extra.get(pk),
        }
    return out


def kg_album_id_of(song_hash, cookie=None, *, require_hash_match=False):
    """用歌曲 hash 查询所属专辑 ID；请求失败或没有数据时返回空串。"""
    try:
        info = kugou_metadata.kg_songinfo(song_hash, cookie, key="hash").get("data") or {}
    except Exception:
        return ""
    if require_hash_match and (not isinstance(info, dict) or str(info.get('hash') or '').lower() != str(song_hash).lower()):
        return ''
    return str(info.get("album_id") or "") if isinstance(info, dict) else ""


def kg_play_url_of_quality(qhash, album_id, cookie=None):
    """用某档音质的 hash 和专辑 ID 请求 songinfo，整理该档的播放字段。
    无播放地址时返回空字典；Cookie 只发给酷狗。"""
    d = kugou_metadata.kg_songinfo(qhash, cookie, key="hash", extra={"album_id": album_id})
    info = d.get("data") or {}
    if not isinstance(info, dict) or not info.get("play_url"):
        return {}
    url = info["play_url"]
    return {
        "url": url,
        "backup_url": info.get("play_backup_url") or "",
        "filesize": info.get("filesize"),
        "bitrate": info.get("bitrate"),
        "kind": "完整版" if "/yp/full/" in url else "试听切片" if "/yp/p_" in url else "未知",
    }


def kg_get_qualities(hash_128, album_id, cookie=None, probe=True, *, playback_quality=None, allow_quality_fallback=False):
    """按 kg_QUALITY_LADDER 从高到低列出酷狗音质。
    probe=True 时逐档请求直链，拿到播放数据才标记 available=True；单档失败不终止整曲。
    probe=False 仅列元数据，不能据此判断可播放。"""
    table = kg_quality_table(hash_128)
    items = []
    wanted = kugou_config.kg_QUALITY_ALIAS.get(playback_quality, playback_quality)
    candidates = candidate_keys('kugou', wanted, allow_fallback=allow_quality_fallback) if playback_quality is not None else None
    for key, _, _, _, _ in kugou_config.kg_QUALITY_LADDER:
        request_lifecycle.check()
        if candidates is not None and key not in candidates:
            continue
        q = table.get(key)
        if not q:
            continue
        item = {
            "key": key,
            "quality": q["label"],
            "hash": q["hash"],
            "filesize": q["filesize"],
            "privilege": q["privilege"],
            "available": False,
            "source_available": True,
            "url": "",
            "backup_url": "",
            "bitrate": None,
        }
        if probe:
            try:
                got = kg_play_url_of_quality(q["hash"], album_id, cookie)
                if got:
                    item.update(got)
                    item["available"] = True
            except Exception:
                pass
        items.append(item)
        if candidates is not None and item['available']:
            break
    return items


def kg_pick_quality(items, want="auto"):
    """在酷狗音质列表中选择一档：auto/未知别名按原规则取首个可用档，显式档位则匹配 key。
    items 需要已经按从高到低排列；没有可选项时返回 None。"""
    if not items:
        return None
    want_key = kugou_config.kg_QUALITY_ALIAS.get((want or "auto").strip().lower(), "auto")
    if want_key != "auto":
        for it in items:
            if it["key"] == want_key:
                return it if it["available"] else None
        return None
    for it in items:
        if it["available"]:
            return it
    return None
