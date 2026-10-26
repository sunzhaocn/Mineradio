"""请求参数、平台别名与严格路由规则。"""

import urllib.error
import urllib.parse
import urllib.request

PLATFORM_IDS = ("kugou", "netease", "qqmusic", "qishui")


PLATFORM_NAMES = {
    "kugou": "酷狗音乐",
    "netease": "网易云音乐",
    "qqmusic": "QQ音乐",
    "qishui": "汽水音乐",
}


PLATFORM_WORDS = {
    "qishui": "qishui",
    "soda": "qishui",
    "汽水": "qishui",
    "汽水音乐": "qishui",
    "kugou": "kugou",
    "kg": "kugou",
    "kgmusic": "kugou",
    "酷狗": "kugou",
    "酷狗音乐": "kugou",
    "netease": "netease",
    "ne": "netease",
    "neteasecloud": "netease",
    "163": "netease",
    "wangyi": "netease",
    "wy": "netease",
    "网易": "netease",
    "网易云": "netease",
    "网易云音乐": "netease",
    "qqmusic": "qqmusic",
    "qq": "qqmusic",
    "qqm": "qqmusic",
    "tx": "qqmusic",
    "tencent": "qqmusic",
    "qq音乐": "qqmusic",
    "腾讯": "qqmusic",
}


MODE_SEARCH = {"search", "s", "find", "query", "list", "搜", "搜索", "查找"}


MODE_MUSIC = {"music", "m", "song", "detail", "play", "url", "track", "歌曲", "详情", "播放"}


KG_SEARCH_ALIAS = ("search", "seach", "keyword", "k", "q", "wd")


NE_SEARCH_ALIAS = ("search", "seach", "keyword", "k", "q", "wd", "s")


QQ_SEARCH_ALIAS = ("search", "seach", "keyword", "k", "q", "wd", "w", "s")


PATHS = (
    "/",
    "/music",
    "/api",
    "/api/music",
    "/search",
    "/api/search",
    "/song",
    "/album",
    "/artist",
    "/artist/detail",
    "/api/artist",
    "/album/detail",
    "/api/album",
    "/qualities",
    "/best",
    "/lyric",
    "/stream",
    "/link",
    "/all",
    "/aggregate",
    "/charts",
    "/chart",
    "/radio/metadata",
)


PLATFORM_PARAM_NAMES = ("platform", "pf", "plat", "p", "source", "src", "provider", "app", "site")


TYPE_PARAM_NAMES = ("type", "t", "mode", "action", "req", "req_type")


class RequestParams:
    """封装查询字符串；保留旧接口对参数别名、空值和布尔开关的解释。"""

    def __init__(self, query_string):
        """query_string 是 URL 中 ? 后的部分，保留 search= 这样的空值。"""
        self.values = urllib.parse.parse_qs(query_string, keep_blank_values=True)

    def one(self, *names):
        """按别名顺序取首个出现的参数的第一个值；显式空值也会优先返回。

        例如 id=&url=123，one("id", "url") 得到空串，不会越过 id 回退到 url。
        同名参数出现多次时仅取第一次；都不存在时返回空串。
        """
        for name in names:
            if self.values.get(name):
                return self.values[name][0]
        return ""

    def flag(self, *names):
        """任意一个别名值为 1/true/yes/on 时开启；忽略大小写，不剔除空格。"""
        return any((self.one(name).lower() in ("1", "true", "yes", "on") for name in names))


def platform_of(word):
    """把 HTTP platform 的别名转为 kugou/netease/qqmusic；未知输入返回空串。
    all 是独立聚合接口类型，不是平台 ID。"""
    s = (word or "").strip().lower().replace(" ", "")
    return PLATFORM_WORDS.get(s, "")


def resolve_mode(path, one):
    """严格模式：专用路径自己决定类型；通用路径必须显式传 type，不做任何推断。

    - /qualities /best /lyric /stream /song  → music
    - /search /api/search /link              → search
    - 其它（/ /music /api ...）               → 必须带 type=search|music，否则返回空串由上层报错
    """
    if path in ("/qualities", "/best", "/lyric", "/stream", "/song"):
        return "music"
    if path in ("/search", "/api/search", "/link"):
        return "search"
    raw = (one(*TYPE_PARAM_NAMES) or "").strip().lower()
    if raw in MODE_SEARCH:
        return "search"
    if raw in MODE_MUSIC:
        return "music"
    return ""


def _int(value, default):
    """尝试将输入转为整数；类型或格式错误时返回 default，避免参数解析直接中断请求。"""
    try:
        return int(str(value).strip())
    except (TypeError, ValueError):
        return default


def with_meta(pf, mode, body):
    """新建响应并补 platform/request_type 元信息，再合并 body；body 已有同名键时优先。"""
    out = {"platform": pf, "request_type": mode}
    if isinstance(body, dict):
        out.update(body)
    return out
