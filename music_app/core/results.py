"""公共结果字段和带账号代次的缓存读取。"""

import time
from music_app.core import cache as core_cache
from music_app.core import request_lifecycle
from music_app.core.cache import cache_platforms


def cached_result(cache, key, ttl, loader, *args, **kwargs):
    """从指定缓存读取结果，过期或不存在时调用 loader 获取。

    cache 的结构为 {请求键: (写入时间戳, 返回值)}；ttl 的单位是秒。
    loader 只会在未命中时执行，因此不能先计算上游结果再作为参数传入。
    异常直接交给调用方处理，不缓存异常；字典等返回值仍沿用原来的引用语义。
    此函数保持原来的并发行为：同一个键并发未命中时可能重复请求上游。
    特殊的播放地址缓存（成功/失败 TTL 不同、逐档降级）仍在各平台内处理。
    """
    request_lifecycle.check()
    platform = cache_platforms.get(id(cache))
    if platform:
        key = core_cache.credential_cache_key(platform, key)
    cached_entry = cache.get(key)
    if cached_entry and time.time() - cached_entry[0] < ttl:
        return cached_entry[1]
    result = loader(*args, **kwargs)
    request_lifecycle.check()
    cache[key] = (time.time(), result)
    return result


def new_music_result(target, quality):
    """创建一首歌的基础返回字段；由 kg/ne/qq_get_music 分别填充。

    target 保存原始输入；hash 是兼容字段：酷狗存 hash，网易云存歌曲 ID，QQ 存 songmid。
    duration_s 为秒，bitrate 通常为 kbps，filesize 为字节；具体数值由平台适配器提供。
    qualities 保存所有档位，quality/url 等字段保存本次选中的档位。
    lrc/tlyric/roma 对应原文/翻译/罗马音；error 用于累计局部失败信息。
    每次调用都创建新字典和新列表，避免不同请求互相覆盖歌曲数据。
    """
    return {
        "input": target,
        "source": None,
        "title": "",
        "author": "",
        "album": "",
        "album_id": "",
        "duration_s": 0,
        "hash": "",
        "privilege": None,
        "bitrate": None,
        "kind": "",
        "url": "",
        "backup_url": "",
        "filesize": None,
        "quality": "",
        "quality_key": "",
        "qualities": [],
        "requested_quality": quality,
        "cover": "",
        "cover_hd": "",
        "cover_tpl": "",
        "singer_avatar": "",
        "singer_avatar_tpl": "",
        "lrc": "",
        "tlyric": "",
        "roma": "",
        "lrc_lines": 0,
        "lyric_id": "",
        "lyric_title": "",
        "lyric_singer": "",
        "krc_base64": None,
        "error": "",
    }
