"""平台适配：kugou / api。"""

from music_app.api import params as api_params
from music_app.api import views as api_views
from music_app.providers.kugou import music as kugou_music_module
from music_app.providers.kugou import search as kugou_search_module
from music_app.providers.kugou import transport as kugou_transport


def kugou_search(one, flag):
    """处理酷狗搜索参数：关键词必填、size≤480，分页窗口不得超过前 480 条。
    调用 kgs_cached_search；simple=1 转精简结果，play/url=1 可补直链。"""
    kw = one(*api_params.KG_SEARCH_ALIAS).strip()
    if not kw:
        return (
            400,
            {
                "error_code": 400,
                "msg": "缺少参数 search，例: /?platform=kugou&type=search&search=周杰伦",
            },
        )
    page = max(1, api_params._int(one("page"), 1))
    size = min(480, max(1, api_params._int(one("size", "pagesize", "limit"), 30)))
    if (page - 1) * size + size > 480:
        return (
            400,
            {
                "error_code": 149,
                "msg": "酷狗最多只能翻到前 480 条：(page-1)*size+size 必须 <= 480",
                "hint": "把 size 调小，或减小 page",
            },
        )
    data = kugou_search_module.kgs_cached_search(kw, page, size)
    if flag("simple"):
        return (200, kugou_search_module.kgs_simple_view(data, with_url=flag("play", "url")))
    return (200, data)


def kugou_link(one):
    """/link 的酷狗实现；校验关键词和 480 条窗口，只生成上游搜索 URL，不执行搜索。"""
    kw = one(*api_params.KG_SEARCH_ALIAS).strip()
    if not kw:
        return (400, {"error_code": 400, "msg": "缺少参数 search"})
    page = max(1, api_params._int(one("page"), 1))
    size = min(480, max(1, api_params._int(one("size", "pagesize", "limit"), 30)))
    if (page - 1) * size + size > 480:
        return (400, {"error_code": 149, "msg": "酷狗最多只能翻到前 480 条"})
    return (200, {"url": kugou_transport.kgs_build_upstream(kw, page, size)})


def kugou_music(one, flag, path):
    """处理酷狗歌曲入口参数，保留 eid/hash/emix 等别名优先级。
    quality/q 默认 auto；lyric/lrc 为 0/false/no 时关闭歌词；结果交给 music_response。"""
    target = one("url", "eid", "hash", "emix", "encode_album_audio_id", "id").strip()
    if not target:
        return (
            400,
            {
                "error_code": 400,
                "msg": "缺少参数 url/eid/hash，例: /?platform=kugou&type=music&url=j410q60",
            },
        )
    quality = (one("quality", "q") or "auto").strip().lower()
    with_lyric = one("lyric", "lrc").lower() not in ("0", "false", "no")
    if flag('playback'):
        result = kugou_music_module.kg_cached_playback(target, quality, flag('allowQualityFallback'))
    else:
        result = kugou_music_module.kg_cached_music(target, quality, with_lyric)
    return api_views.music_response(result, path, flag("simple"), kugou_music_module.kg_simple_view)


def kugou_handle(one, flag, path):
    """platform=kugou：按老脚本的规则分到搜索 / 歌曲。"""
    if api_params.resolve_mode(path, one) == "search":
        return kugou_link(one) if path == "/link" else kugou_search(one, flag)
    return kugou_music(one, flag, path)
