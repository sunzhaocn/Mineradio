"""平台适配：netease / api。"""

from music_app.api import params as api_params
from music_app.api import views as api_views
from music_app.providers.netease import config as netease_config
from music_app.providers.netease import music as netease_music_module
from music_app.providers.netease import search as netease_search_module
from music_app.providers.netease import search_play as netease_search_play


def netease_search(one, flag):
    """处理网易云搜索：size≤100，page 转 offset，stype 决定搜索对象，level 决定补链音质。
    simple=1 使用精简视图；原始模式 play=1 时为歌曲结果补 ID 到播放信息的映射。"""
    kw = one(*api_params.NE_SEARCH_ALIAS).strip()
    if not kw:
        return (
            400,
            {
                "error_code": 400,
                "msg": "缺少参数 search，例: /?platform=netease&type=search&search=周杰伦",
            },
        )
    page = max(1, api_params._int(one("page"), 1))
    size = min(100, max(1, api_params._int(one("size", "pagesize", "limit"), 30)))
    offset = (
        api_params._int(one("offset"), (page - 1) * size) if one("offset") else (page - 1) * size
    )
    offset = max(0, offset)
    stype = api_params._int(one("stype", "sub_type", "subtype", "type"), 1)
    if stype not in netease_config.nes_TYPES:
        return (
            400,
            {"error_code": 400, "msg": "stype 只支持 %s" % sorted(netease_config.nes_TYPES)},
        )
    level = (one("level", "quality") or "exhigh").lower()
    if level != "best" and level not in netease_config.nes_LEVELS:
        return (
            400,
            {"error_code": 400, "msg": "level 只支持 lossless/exhigh/higher/standard 或 best"},
        )
    j = netease_search_module.nes_cached_search(kw, stype, size, offset)
    if j.get("code") != 200:
        return (
            400,
            {
                "code": j.get("code") or 400,
                "error_code": j.get("code") or 400,
                "msg": "上游返回 %s" % j.get("code"),
                "hint": "关键词为空或 size 超限（最大 100）",
            },
        )
    if flag("simple"):
        return (
            200,
            netease_search_module.nes_simple_view(
                j, kw, stype, size, offset, with_play=flag("play", "url"), level=level
            ),
        )
    out = dict(j)
    if flag("play", "url") and stype == 1:
        ids = [s.get("id") for s in (j.get("result") or {}).get("songs") or [] if s.get("id")]
        out["play"] = {i: netease_search_play.nes_play_url(i, level=level) for i in ids}
    return (200, out)


def netease_link(one):
    """/link 的网易云实现；将分页转成 offset，校验 stype 后返回可重放的搜索 URL。"""
    kw = one(*api_params.NE_SEARCH_ALIAS).strip()
    if not kw:
        return (400, {"error_code": 400, "msg": "缺少参数 search"})
    page = max(1, api_params._int(one("page"), 1))
    size = min(100, max(1, api_params._int(one("size", "pagesize", "limit"), 30)))
    offset = (
        api_params._int(one("offset"), (page - 1) * size) if one("offset") else (page - 1) * size
    )
    stype = api_params._int(one("stype", "sub_type", "subtype", "type"), 1)
    if stype not in netease_config.nes_TYPES:
        return (
            400,
            {"error_code": 400, "msg": "stype 只支持 %s" % sorted(netease_config.nes_TYPES)},
        )
    return (
        200,
        {
            "url": netease_search_module.nes_build_search_url(kw, stype, size, max(0, offset)),
            "method": "GET/POST",
            "note": "可直接重放，无需 Cookie/签名",
        },
    )


def netease_music(one, flag, path):
    """处理网易云详情参数并调用 ne_cached_music；支持 ID、链接或关键词。
    歌曲子接口均由 music_response 统一组织响应，保留网易云自己的精简字段。"""
    target = one("url", "id", "kw", "search", "hash").strip()
    if not target:
        return (
            400,
            {
                "error_code": 400,
                "msg": "缺少参数 url/id，例: /?platform=netease&type=music&id=347230",
            },
        )
    quality = (one("quality", "q") or "auto").strip().lower()
    with_lyric = one("lyric", "lrc").lower() not in ("0", "false", "no")
    if flag('playback'):
        result = netease_music_module.ne_cached_playback(target, quality, flag('allowQualityFallback'))
    else:
        result = netease_music_module.ne_cached_music(target, quality, with_lyric)
    return api_views.music_response(
        result, path, flag("simple"), netease_music_module.ne_simple_view
    )


def netease_handle(one, flag, path):
    """platform=netease：按老脚本的规则分到搜索 / 歌曲。"""
    if api_params.resolve_mode(path, one) == "search":
        return netease_link(one) if path == "/link" else netease_search(one, flag)
    return netease_music(one, flag, path)
