"""汽水音乐搜索、榜单、歌词、音质和播放资料公共接口。"""

import base64
from music_app.core.artists import fields as artist_fields
import json
import re
import shutil
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from music_app.core.labels import song_labels
from music_app.core import request_credentials
from music_app.providers.qishui.client import QishuiError, load_session, read_track, request_json, sdk_directory, session_path


QUALITY_NAMES = {"medium": "标准", "higher": "较高", "highest": "极高",
                 "lossless": "无损", "spatial": "空间音频", "hi_res": "Hi-Res"}


QUALITY_ALIASES = {"standard": "medium", "128": "higher", "high": "higher",
                   "320": "highest", "flac": "lossless", "sq": "lossless"}


_CACHE = {}


_SOURCES = {}


_LOCK = threading.Lock()


QUALITY_ORDER = ('lossless', 'hi_res', 'spatial', 'highest', 'higher', 'medium')


def media_capable():
    try:
        from music_app import platform_runtime
        from . import media as qishui_media
        return qishui_media.is_available() and (platform_runtime.is_mobile() or bool(shutil.which('ffmpeg')))
    except ImportError:
        return False


def detail_key(song_id):
    return (song_id, request_credentials.fingerprint('qishui'))


def local_status():
    """只报告配置是否存在，不能据此断言登录仍有效或账号有播放权限。"""
    from music_app import platform_runtime
    if platform_runtime.is_ios():
        try:
            from mineradio.signer import status as native_status
            native = native_status()
        except (ImportError, RuntimeError):
            native = {}
        try:
            configured = not load_session().get('guest', False)
        except QishuiError:
            configured = False
        available = bool(native.get('libraryAvailable'))
        ready = bool(native.get('initialized') and native.get('httpCallbackInstalled') and not native.get('error'))
        return dict(session_configured=configured, sdk_available=available, native_signing=available,
                    native_muxer=True, node_available=False, direct_playback=ready and media_capable(),
                    local_decryption=media_capable(), ffmpeg_available=False, available=available,
                    signer_initialized=bool(native.get('initialized')),
                    signer_ready=ready,
                    reason=('qishui_signer_missing' if not available else
                            'qishui_signer_failed' if native.get('error') else
                            'qishui_activation_required' if not ready else ''))
    status = {"session_configured": False, "sdk_available": False,
              "native_signing": platform_runtime.is_android(), "native_muxer": platform_runtime.is_android(),
              "node_available": bool(shutil.which("node")), "direct_playback": media_capable(),
              "local_decryption": media_capable(), "ffmpeg_available": bool(shutil.which('ffmpeg'))}
    try:
        status["session_configured"] = not load_session().get('guest', False)
    except QishuiError:
        pass
    try:
        sdk_directory()
        status["sdk_available"] = True
    except QishuiError:
        pass
    return status


def cover_url(album):
    """url_cover 是 CDN 地址、资源路径和缩略图模板三个部分，不能只返回 CDN 根地址。"""
    info = album.get("url_cover") or {}
    urls, uri = info.get("urls") or [], info.get("uri", "")
    if not urls or not uri:
        return ""
    return urls[0] + uri + "~" + info.get("template_prefix", "tplv-b829550vbb") + "-crop-center:400:400.jpg"


def normalize_track(track):
    album = track.get("album") or {}
    artist = " / ".join(x.get("name", "") for x in track.get("artists", []) if x.get("name"))
    song_id = str(track.get("id", ""))
    return {"platform": "qishui", "id": song_id, "song_id": song_id, "target": song_id,
            "nativeMediaType": str(track.get("media_type") or "track"),
            "title": track.get("name", ""), "name": track.get("name", ""),
            "author": artist, "artist": artist, "album": album.get("name", ""),
            **artist_fields(track.get('artists')),
            "album_id": str(album.get("id", "")), "duration_s": int(track.get("duration", 0)) / 1000,
            "cover": cover_url(album), **song_labels('qishui', track)}


def chart_catalog():
    """官方发现页 → 榜单目录；推荐电台和普通歌单不当作排行榜。

    DiscoverView 的实际协议是 POST /luna/pc/discover，空 JSON 请求体即可。
    不传 pc_new_discover_request：新版听歌模式只返回电台推荐，没有排行榜。
    每个 inner_block 对应一个榜单，resources 是客户端展示的有序歌曲列表。
    这里只用第一首歌的专辑封面作缩略图；完整曲目通过 chart_tracks 单独获取。
    """
    result = request_json("discover", body={})
    if not isinstance(result.get("blocks"), list):
        raise QishuiError(502, "qishui_charts_invalid", "汽水榜单目录格式异常，请稍后重试")
    rows, seen = [], set()
    for block in result["blocks"]:
        if block.get("type") != "discover_top_song_list":
            continue
        for item in block.get("inner_block") or []:
            if item.get("type") != "discover_track_top_list":
                continue
            chart_id = str(item.get("inner_block_id") or "")
            if not re.fullmatch(r"[A-Za-z0-9_-]{1,80}", chart_id) or not item.get("title"):
                raise QishuiError(502, "qishui_charts_invalid", "汽水榜单标识格式异常，请稍后重试")
            if chart_id in seen:
                continue
            seen.add(chart_id)
            resources = item.get("resources") or []
            cover = ""
            for resource in resources:
                ranked = (resource.get("entity") or {}).get("ranked_track") or {}
                track = ranked.get("track") or {}
                if track:
                    cover = cover_url(track.get("album") or {})
                    break
            rows.append({"id": chart_id, "name": item["title"], "category": "音乐榜",
                         "cover": cover,
                         "description": item.get("desc") or "", "update": "",
                         "track_count": len(resources)})
    if not rows:
        raise QishuiError(502, "qishui_charts_empty", "汽水暂未返回官方音乐榜单，请稍后重试")
    return rows


def chart_tracks(chart_id):
    """官方榜单详情 → (归一化歌曲列表, 平台声明的总数)。

    GET /luna/pc/charts/{id} 返回 chart.track_ranks 全集，没有分页参数。
    数组顺序就是排名；其中 rank 是涨跌描述对象，不能转换成名次数字。
    count_tracks 用于主 API 的 complete 校验，缺歌时不能声称已获取完整榜单。
    仅提取歌曲元信息，既不请求音频地址，也不获取音质或解密数据。
    """
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,80}", str(chart_id)):
        raise QishuiError(400, "qishui_chart_id_invalid", "汽水榜单 ID 格式不正确")
    result = request_json("charts/" + str(chart_id))
    chart = result.get("chart") or {}
    if str(chart.get("id") or "") != str(chart_id) or not isinstance(chart.get("track_ranks"), list):
        raise QishuiError(502, "qishui_chart_invalid", "汽水榜单详情格式异常，请稍后重试")
    rows = chart["track_ranks"]
    try:
        total = int(chart["count_tracks"])
        if total < 0:
            raise ValueError()
    except (KeyError, TypeError, ValueError):
        raise QishuiError(502, "qishui_chart_invalid", "汽水未返回有效的榜单总数，请稍后重试") from None
    songs, seen = [], set()
    for item in rows:
        track = item.get("track") or {}
        song_id = str(track.get("id") or "")
        if song_id and song_id not in seen:
            seen.add(song_id)
            songs.append(normalize_track(track))
    return songs, max(total, len(rows))


def search(keyword, size=20, page=1):
    """歌曲页固定每批约 20 首；沿用上游 next_cursor，按本地 page/size 截取。

    不用综合搜索的六首预览冒充分页；最多读五批，防止一次请求无限抓取。
    上游只给 has_more，没有可靠总数，因此不编造 total。
    """
    offset, end = (page - 1) * size, page * size
    if end > 100:
        raise QishuiError(400, "qishui_page_limit", "汽水单次搜索支持前 100 条，请调整 page/size")
    cursor, rows, seen, has_more = "0", [], set(), False
    search_id = str(uuid.uuid4())
    public_search = False
    for _ in range(5):
        query = {"q": keyword, "cursor": cursor,
                              "search_id": search_id, "search_method": "input",
                              "debug_params": "", "from_search_id": "", "search_scene": ""}
        from music_app import platform_runtime
        if public_search:
            with request_credentials.bind({}): result = request_json('search/track',query)
        else:
            try: result = request_json('search/track',query)
            except QishuiError as error:
                if (not platform_runtime.is_mobile() or not request_credentials.cookie('qishui') or
                        error.code not in ('qishui_upstream_rejected','qishui_upstream_error')):
                    raise
                # PC Passport cookies can be valid for the account yet rejected
                # by Android public search. Use its normal public catalogue read
                # without changing the saved login or credentials for playback.
                with request_credentials.bind({}): result = request_json('search/track',query)
                public_search = True
        # EmptySearchType is a service outcome, not an empty song catalogue.
        # 1=BlockedByShark, 2=HitAntiDirt in the shipped search contract.
        empty_type = (result.get('extra') or {}).get('empty_search')
        if empty_type in (1, '1'):
            raise QishuiError(429, 'qishui_search_verification_required',
                '汽水暂时限制了本次搜索，请验证汽水登录后重试')
        if empty_type in (2, '2'):
            raise QishuiError(422, 'qishui_search_keyword_rejected',
                '汽水未接受当前搜索词，请更换搜索词后重试')
        group = next((g for g in result.get("result_groups", []) if g.get("id") == "tracks"), {})
        for item in group.get("data", []):
            entity = item.get('entity') or {}
            # The current Android search contract wraps Track in TrackWrapper;
            # older PC responses still return entity.track directly.
            track = entity.get('track') or (entity.get('track_wrapper') or {}).get('track')
            if track and str(track.get("id")) not in seen:
                rows.append(normalize_track(track))
                seen.add(str(track.get("id")))
        has_more, next_cursor = bool(group.get("has_more")), str(group.get("next_cursor", ""))
        if len(rows) >= end or not has_more or not next_cursor or next_cursor == cursor:
            break
        cursor = next_cursor
    songs = rows[offset:end]
    return {"keyword": keyword, "page": page, "size": size, "songs": songs, "count": len(songs),
            "total": None, "has_more": len(rows) > end or has_more, 'publicSearch':public_search}


def native_to_lrc(content):
    """把 [起始毫秒,时长]<逐字偏移,时长,标记>文字 转成普通播放器认识的行时间 LRC。"""
    lines = []
    for line in (content or "").splitlines():
        match = re.match(r"^\[(\d+),\d+\](.*)$", line)
        if match:
            milliseconds = int(match[1])
            text = re.sub(r"<[^>]*>", "", match[2])
            lines.append(f"[{milliseconds // 60000:02}:{milliseconds // 1000 % 60:02}.{milliseconds % 1000:03}]{text}")
        else:
            lines.append(re.sub(r"<[^>]*>", "", line))
    return "\n".join(lines)


def media_url(value):
    """部分未加密源的地址使用 Base64 封装；这只是地址编码，不处理媒体加密。"""
    if not value:
        return ""
    if not value.startswith(("http://", "https://")):
        try:
            value = base64.b64decode(value).decode("utf-8")
        except (ValueError, UnicodeError):
            return ""
    return value if value.startswith(("http://", "https://")) else ""


def details(song_id):
    """短缓存减少重复签名/请求；登录配置更新时自然使用新的缓存键。"""
    key = detail_key(song_id)
    now = time.monotonic()
    with _LOCK:
        cached = _CACHE.get(key)
        if cached and now - cached[0] < 90:
            return cached[1]
    result = read_track(song_id, requester=request_json)
    track = result.get("track")
    if not track:
        raise QishuiError(404, "qishui_track_missing", "未找到歌曲，或当前账号无法获取该歌曲资料")
    item = normalize_track(track)
    lyric = result.get("lyric") or {}
    item.update(lrc=native_to_lrc(lyric.get("content", "")),
                native_lyric=lyric.get("content", ""),
                tlyric=native_to_lrc((lyric.get("translations") or {}).get("cn", "")))
    try:
        model = (result.get("track_player") or {}).get("video_model") or "{}"
        model = json.loads(model) if isinstance(model, str) else model
    except ValueError:
        raise QishuiError(502, "qishui_invalid_media", "汽水音质信息格式异常") from None
    qualities, sources = [], {}
    for video in model.get("video_list", []):
        meta, encryption = video.get("video_meta") or {}, video.get("encrypt_info") or {}
        key_name = meta.get("quality", "unknown")
        # 缺少加密标志时不能假定普通播放器可用。仅明确 encrypt=false 才返回地址。
        encrypted = encryption.get("encrypt") is not False
        url = "" if encrypted else media_url(video.get("main_url", ""))
        decryptable = False
        if (encrypted and media_capable() and
                encryption.get('encryption_method') == 'cenc-aes-ctr'):
            try:
                from .media import decode_spade
                from .playback import allowed_cdn
                source_url = media_url(video.get('main_url', ''))
                media_key = decode_spade(encryption.get('spade_a', ''))
                if allowed_cdn(source_url):
                    sources[key_name] = {'url': source_url, 'key': media_key,
                                         'identity': meta.get('file_hash') or meta.get('file_id'),
                                         'size': meta.get('size', 0), 'codec': meta.get('codec_type', '')}
                    decryptable = True
                    url = '/qishui/audio?' + urllib.parse.urlencode({'id': song_id, 'quality': key_name})
            except (ValueError, TypeError, ImportError):
                pass
        qualities.append({"key": key_name, "quality": QUALITY_NAMES.get(key_name, key_name),
                          "bitrate": round(float(meta.get("bitrate", 0)) / 1000),
                          "filesize": meta.get("size", 0), "encode": meta.get("codec_type", ""),
                          "sample_rate": meta.get("audio_sample_rate", ""),
                          "source_available": True, "available": bool(url), "url": url,
                          "encrypted": encrypted, "decryption_supported": decryptable,
                          "encryption_method": encryption.get("encryption_method", ""),
                          "vip_required": key_name in item.get("qualityVipKeys", []) or item.get("vipRequired", False)})
    item.update(qualities=qualities, encrypted=any(q["encrypted"] for q in qualities),
                playback_supported=any(q["available"] for q in qualities))
    with _LOCK:
        # 清除到期条目并限制内存；不把带签名的原始响应落盘。
        for old in list(_CACHE):
            if now - _CACHE[old][0] >= 90:
                del _CACHE[old]
                _SOURCES.pop(old, None)
        if len(_CACHE) >= 128:
            oldest = next(iter(_CACHE))
            _CACHE.pop(oldest)
            _SOURCES.pop(oldest, None)
        _CACHE[key] = (now, item)
        _SOURCES[key] = sources
    return item


def playback_source(song_id, quality):
    """内部读取；URL 和密钥不进入公开响应。"""
    if not re.fullmatch(r'[1-9]\d{0,24}', song_id) or quality not in QUALITY_NAMES:
        raise QishuiError(400, 'invalid_media_request', '无效的汽水音频参数')
    details(song_id)
    with _LOCK:
        source = _SOURCES.get(detail_key(song_id), {}).get(quality)
    if not source:
        raise QishuiError(409, 'decryption_unavailable', '当前账号未返回可解密的所选音源')
    return dict(source)


def pick_quality(options, quality):
    if quality not in ('auto', 'best'):
        return next((q for q in options if q['key'] == quality), None)
    for name in QUALITY_ORDER:
        selected = next((q for q in options if q['key'] == name and q['available']), None)
        if selected:
            return selected
    return options[0] if options else None


def handle(one, flag, path, mode):
    """适配主 API 的 (状态码, JSON) 协议；各路径都保留明确的加密状态。"""
    try:
        if mode == "search":
            keyword = one("search", "keyword", "q", "wd", "k", "seach").strip()
            if not keyword:
                raise QishuiError(400, "missing_keyword", "缺少搜索词 search")
            try:
                size, page = int(one("size", "limit") or 20), int(one("page") or 1)
            except ValueError:
                raise QishuiError(400, "invalid_pagination", "page/size 必须为正整数") from None
            if not 1 <= size <= 100 or page < 1:
                raise QishuiError(400, "invalid_pagination", "size 范围为 1–100，page 至少为 1")
            if flag("play") or path == "/link":
                raise QishuiError(400, "qishui_track_id_required", "汽水播放请先通过搜索获取歌曲 ID")
            return 200, search(keyword, size, page)
        song_id = one("id", "song_id", "track_id", "url").strip()
        if not re.fullmatch(r"[1-9]\d{0,24}", song_id):
            raise QishuiError(400, "invalid_track_id", "汽水歌曲需传入数字 id/track_id（可从搜索结果获取）")
        quality = one("quality").strip().lower() or "auto"
        quality = QUALITY_ALIASES.get(quality, quality)
        if quality not in ("auto", "best", *QUALITY_NAMES):
            raise QishuiError(400, "invalid_quality", "未知汽水音质，请使用 medium/higher/highest/lossless/spatial/hi_res/auto")
        item = dict(details(song_id))
        item['qualitiesComplete'] = not flag('playback')
        options = item["qualities"]
        selected = pick_quality(options, quality)
        item.update(requested_quality=quality, quality_key=selected["key"] if selected else "",
                    quality=selected["quality"] if selected else "", url=selected["url"] if selected else "",
                    bitrate=selected["bitrate"] if selected else 0,
                    error="当前账号未返回可解密的所选音源" if selected and selected['encrypted'] and not selected['available'] else "")
        if path in ("/stream", "/best"):
            if quality not in ("auto", "best") and not selected:
                raise QishuiError(404, "quality_unavailable", "该歌曲未提供所选音质")
            if selected and selected["encrypted"] and not selected['available']:
                return 409, {"code": "encrypted_media", "msg": item["error"], "id": song_id,
                             "encrypted": True, "playback_supported": False, "url": "", "qualities": options}
            if not item["url"]:
                raise QishuiError(404, "no_playable_source", "当前歌曲没有可直接播放的音源")
            if path == "/stream":
                return 302, {"_location": item["url"]}
        if path == "/lyric":
            return 200, {k: item[k] for k in ("id", "title", "author", "lrc", "tlyric", "native_lyric")}
        if path == "/qualities":
            return 200, {k: item[k] for k in ("id", "title", "qualities", "encrypted", "playback_supported", "error")}
        return 200, item
    except QishuiError as exc:
        return exc.status, {"error_code": exc.status, "code": exc.code, "msg": str(exc)}

