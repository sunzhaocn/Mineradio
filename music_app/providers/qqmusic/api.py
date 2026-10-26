"""平台适配：qqmusic / api。"""

from music_app.api import params as api_params
from music_app.api import views as api_views
from music_app.providers.qqmusic import config as qqmusic_config
from music_app.providers.qqmusic import music as qqmusic_music
from music_app.providers.qqmusic import search as qqmusic_search


def qq_search(one, flag):
    """处理 QQ 搜索参数，size≤50；将通用 stype 转成 QQ 上游 0～4 编号。
    simple=1 时使用 qqs_simple_view，play=1 补直链，默认 level=128。"""
    kw = one(*api_params.QQ_SEARCH_ALIAS).strip()
    if not kw:
        return (
            400,
            {
                "error_code": 400,
                "msg": "缺少参数 search，例: /?platform=qqmusic&type=search&search=周杰伦",
            },
        )
    page = max(1, api_params._int(one("page"), 1))
    size = min(50, max(1, api_params._int(one("size", "pagesize", "limit"), 30)))
    stype = qqmusic_search.qqs_type_of(one("stype", "sub_type", "subtype", "type"))
    body = qqmusic_search.qqs_cached_search(
        kw, page, size, qqmusic_config.qqs_TYPE_UPSTREAM.get(stype, 0)
    )
    if flag("simple"):
        return (
            200,
            qqmusic_search.qqs_simple_view(
                body,
                kw,
                stype,
                page,
                size,
                with_play=flag("play", "url"),
                level=one("level") or "128",
            ),
        )
    return (
        200,
        {
            "keyword": kw,
            "type": stype,
            "type_name": qqmusic_config.qqs_TYPE_NAME.get(stype, str(stype)),
            "page": page,
            **body,
        },
    )


def qq_link(one):
    """/link 的 QQ 实现；只构造 musicu 搜索重放 URL，并说明所需 Referer。"""
    kw = one(*api_params.QQ_SEARCH_ALIAS).strip()
    if not kw:
        return (400, {"error_code": 400, "msg": "缺少参数 search"})
    page = max(1, api_params._int(one("page"), 1))
    size = min(50, max(1, api_params._int(one("size", "pagesize", "limit"), 30)))
    stype = qqmusic_search.qqs_type_of(one("stype", "sub_type", "subtype", "type"))
    return (
        200,
        {
            "url": qqmusic_search.qqs_build_upstream(
                kw, page, size, qqmusic_config.qqs_TYPE_UPSTREAM.get(stype, 0)
            ),
            "method": "GET/POST",
            "note": "可直接重放；无需签名，只需 Referer: https://y.qq.com/",
        },
    )


def qq_music(one, flag, path):
    """处理 QQ 歌曲入口参数：优先读 url/id/songmid/mid，再兼容关键词别名。
    调用 qq_cached_music 后交给 music_response，平台自己的歌曲解析规则保持独立。"""
    target = one("url", "id", "songmid", "mid", "kw", "search", "hash").strip()
    if not target:
        return (
            400,
            {
                "error_code": 400,
                "msg": "缺少参数 url/songmid，例: /?platform=qqmusic&type=music&url=0039MnYb0qxYhV",
            },
        )
    quality = (one("quality", "q") or "auto").strip().lower()
    with_lyric = one("lyric", "lrc").lower() not in ("0", "false", "no")
    if flag('playback'):
        result = qqmusic_music.qq_cached_playback(target, quality, flag('allowQualityFallback'))
    else:
        result = qqmusic_music.qq_cached_music(target, quality, with_lyric)
    return api_views.music_response(result, path, flag("simple"), qqmusic_music.qq_simple_view)


def qq_handle(one, flag, path):
    """platform=qqmusic：按老脚本的规则分到搜索 / 歌曲。"""
    if api_params.resolve_mode(path, one) == "search":
        return qq_link(one) if path == "/link" else qq_search(one, flag)
    return qq_music(one, flag, path)
