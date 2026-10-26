"""平台适配：qqmusic / quality。"""

import time
import urllib.parse
from music_app.core import cache as core_cache
from music_app.core.playback_quality import candidate_keys
from music_app.core import request_lifecycle
from music_app.providers.qqmusic import config as qqmusic_config
from music_app.providers.qqmusic import state as qqmusic_state
from music_app.providers.qqmusic import transport as qqmusic_transport

qq__VKEY_CACHE, qq__VKEY_TTL = ({}, 600)


def qq_matches_file(value, prefix, ext):
    """vkey 返回的文件必须仍属于申请的原生音质，拒绝其它档位的回落地址。"""
    filename = urllib.parse.urlsplit(str(value or "")).path.rsplit("/", 1)[-1]
    return filename.startswith(prefix) and filename.lower().endswith("." + ext.lower())


def qq__guid_order():
    """生成 QQ vkey 请求的 GUID 尝试顺序；最近成功的 GUID 优先，候选去重。"""
    good = qqmusic_state.playback_guid.get("good") or qqmusic_config.qq_GUID
    return [good] + [g for g in qqmusic_config.qq_GUID_POOL if g != good]


def qq_vkey(mid, media_mid, prefix, ext, cookie=None, timeout=8):
    """
    单档直链；返回 {"url","backup_url","filename","sip","purl"}；拿不到返回 {}。
    url = sip[0] + purl（原样拼接，不要改 https）。
    """
    return qq_vkeys(mid, media_mid, [(prefix, ext)], cookie, timeout).get((prefix, ext), {})


def qq_vkeys(mid, media_mid, formats, cookie=None, timeout=8):
    """Request the eligible native formats together, rather than exhausting quota per tier.

    Only matching filenames prove a format. A confirmed per-file denial is
    cached briefly; network, malformed and quota errors remain retryable.
    """
    request_lifecycle.check()
    formats = list(dict.fromkeys(formats))
    if not mid or not formats:
        return {}
    ck = qqmusic_transport.qq_cookie_fields(cookie)
    uin = ck['uin'] or '0'
    result, pending, keys = {}, {}, {}
    for prefix, ext in formats:
        filename = '%s%s.%s' % (prefix, media_mid or mid, ext)
        key = core_cache.credential_cache_key('qqmusic', (mid, filename, uin))
        keys[(prefix, ext)] = key
        cached = qq__VKEY_CACHE.get(key)
        if cached and time.time() - cached[0] < (qq__VKEY_TTL if cached[1] else 60):
            result[(prefix, ext)] = cached[1]
        else:
            pending[(prefix, ext)] = filename
    last_error = None
    for guid in qq__guid_order():
        if not pending:
            break
        request_lifecycle.check()
        wanted = list(pending.items())
        data = {
            "req_1": {
                "module": "vkey.GetVkeyServer",
                "method": "CgiGetVkey",
                "param": {
                    "filename": [name for _, name in wanted],
                    "guid": guid,
                    "songmid": [mid] * len(wanted),
                    "songtype": [0] * len(wanted),
                    "uin": uin,
                    "loginflag": 1,
                    "platform": "20",
                },
            },
            "comm": {"uin": int(uin) if uin.isdigit() else 0, "format": "json", "ct": 24, "cv": 0},
        }
        try:
            j = qqmusic_transport.qq_musicu(data, cookie, timeout, retries=0)
        except Exception as error:
            request_lifecycle.check()
            last_error = error
            continue
        node = j.get('req_1') or {}
        if j.get('code') not in (0, None) or node.get('code') not in (0, None):
            last_error = RuntimeError('QQ 音源服务暂时未确认请求')
            continue
        rd = node.get('data') or {}
        rows = rd.get('midurlinfo')
        if not isinstance(rows, list):
            last_error = RuntimeError('QQ 音源响应不完整')
            continue
        sip = [s for s in rd.get('sip') or [] if isinstance(s, str) and s]
        for index, (format_, filename) in enumerate(wanted):
            prefix, ext = format_
            # Batch order is normally preserved; match named rows explicitly
            # so a missing/reordered result cannot attach another song's URL.
            row = next((r for r in rows if isinstance(r, dict) and r.get('filename') == filename), None)
            if row is None and len(wanted) == 1 and len(rows) == 1 and isinstance(rows[0], dict) and not rows[0].get('filename'):
                row = rows[0]
            if row is None:
                continue
            purl = row.get('purl') or ''
            if not purl:
                if row.get('result') == 104003 and row.get('filename') == filename:
                    request_lifecycle.check()
                    result[format_] = {}
                    qq__VKEY_CACHE[keys[format_]] = (time.time(), {})
                    pending.pop(format_, None)
                continue
            if not qq_matches_file(purl, prefix, ext) or (row.get('filename') and not qq_matches_file(row['filename'], prefix, ext)):
                continue
            actual = urllib.parse.urlsplit(purl).path.rsplit('/', 1)[-1]
            if actual != filename:
                continue
            request_lifecycle.check()
            info = dict(purl=purl, filename=row.get('filename') or filename, sip=sip,
                        url=(sip[0] if sip else 'http://aqqmusic.tc.qq.com/') + purl,
                        backup_url=sip[1] + purl if len(sip) > 1 else '')
            result[format_] = info
            qq__VKEY_CACHE[keys[format_]] = (time.time(), info)
            qqmusic_state.playback_guid['good'] = guid
            pending.pop(format_, None)
    request_lifecycle.check()
    if pending and not any(result.values()):
        raise RuntimeError('QQ 音源暂未确认，请稍后重试') from last_error
    if len(qq__VKEY_CACHE) > 1600:
        for key in list(qq__VKEY_CACHE)[:400]:
            qq__VKEY_CACHE.pop(key, None)
    return result


def qq_get_qualities(mid, media_mid, sizes=None, cookie=None, probe=True, *, playback_quality=None, allow_quality_fallback=False):
    """4 档逐档真请求，拿到 purl 才算 available；字段与酷狗/网易版同形。"""
    sizes = sizes or {}
    logged = bool(qqmusic_transport.qq_cookie_fields(cookie)["uin"])
    items = []
    # 旧配置曾把 hires 当作 flac 别名；快速精确播放不能沿用这种降档。
    wanted = playback_quality if playback_quality in ('hires', 'jymaster') else qqmusic_config.qq_QUALITY_KEY.get(playback_quality, playback_quality)
    candidates = candidate_keys('qqmusic', wanted, allow_fallback=allow_quality_fallback) if playback_quality is not None else None
    formats = []
    for key, _label, prefix, ext, size_key, _br in qqmusic_config.qq_QUALITY_LADDER:
        if candidates is not None and key not in candidates:
            continue
        try:
            present = float(sizes[size_key]) > 0 if size_key in sizes and sizes[size_key] is not None else None
        except (TypeError, ValueError):
            present = None
        if present is not False:
            formats.append((prefix, ext))
    batch = qq_vkeys(mid, media_mid, formats, cookie) if probe and len(formats) > 1 else None
    for key, label, prefix, ext, size_key, br in qqmusic_config.qq_QUALITY_LADDER:
        request_lifecycle.check()
        if candidates is not None and key not in candidates:
            continue
        try:
            source_available = float(sizes[size_key]) > 0 if size_key in sizes and sizes[size_key] is not None else None
        except (TypeError, ValueError):
            source_available = None
        item = {
            "key": key,
            "quality": label,
            "hash": mid,
            "filesize": sizes.get(size_key) or 0,
            "privilege": None,
            "available": False,
            "source_available": source_available,
            "url": "",
            "backup_url": "",
            "bitrate": br,
            "encode": ext,
            "kind": "",
            "note": "",
        }
        got = (batch.get((prefix, ext), {}) if batch is not None else qq_vkey(mid, media_mid, prefix, ext, cookie)) if probe and source_available is not False else {}
        if got:
            item.update(
                {
                    "url": got["url"],
                    "backup_url": got["backup_url"],
                    "filename": got["filename"],
                    "available": True,
                    "source_available": True,
                    "kind": "完整版",
                }
            )
        else:
            item["kind"] = "无直链"
            item["note"] = "该歌曲未提供此音质" if source_available is False else (
                "游客模式只能取 128k/AAC 且仅限免费曲，登录后重试"
                if not logged
                else "该档位无 vkey（版权 / 会员 / 无此音质）"
            )
        items.append(item)
        if candidates is not None and item['available']:
            break
    return items


def qq_quality_key_of(want):
    """把入参（flac/sq/320/128/aac）翻成内部键；不认识返回 auto。"""
    w = (want or "auto").strip().lower()
    if w in ("", "auto", "best"):
        return "auto"
    return qqmusic_config.qq_QUALITY_KEY.get(w, "auto")


def qq_pick_quality(items, want="auto"):
    """auto = 取最高可用；指定档位不可用时返回 None（与酷狗/网易版语义一致）。"""
    if not items:
        return None
    key = qq_quality_key_of(want)
    if key == "auto":
        for it in items:
            if it["available"]:
                return it
        return None
    for it in items:
        if it["key"] == key:
            return it if it["available"] else None
    return None
