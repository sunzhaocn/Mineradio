"""平台适配：kugou / config。"""

from music_app.core import cookies as core_cookies

kg_COOKIE = ""


kg_SALT = "NVPh5oo715z5DIWAeQlhMDsWXXQV4hwt"


kg_SONGINFO_API = "https://wwwapi.kugou.com/play/songinfo"


kg_SONGINFO_BY_HASH = "https://mobiles.kugou.com/api/v3/song/info"


kg_LYRIC_SEARCH = "https://krcs.kugou.com/search"


kg_LYRIC_DOWNLOAD = "https://lyrics.kugou.com/download"


kg_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"


kg_REFERER = "https://www.kugou.com/"


kg_HOST, kg_PORT = ("127.0.0.1", 18098)


kg_KRC_TAB = bytes([64, 71, 97, 119, 94, 50, 116, 71, 81, 54, 49, 45, 206, 210, 110, 105])


kg_QUALITY_LADDER = [
    ("sq", "SQ(无损)", "sqhash", "sqfilesize", "sqprivilege"),
    ("320", "320k", "320hash", "320filesize", "320privilege"),
    ("high", "高品", "highhash", "highfilesize", "highprivilege"),
    ("128", "128k", "128hash", "128filesize", "128privilege"),
]


kg_QUALITY_ALIAS = {
    "sq": "sq",
    "flac": "sq",
    "lossless": "sq",
    "无损": "sq",
    "320": "320",
    "320k": "320",
    "high": "high",
    "高品": "high",
    "128": "128",
    "128k": "128",
    "auto": "auto",
    "": "auto",
}


kgs_COOKIE = ""


kgs_SALT = "NVPh5oo715z5DIWAeQlhMDsWXXQV4hwt"


kgs_UPSTREAM = "https://complexsearch.kugou.com/v2/search/song?"


kgs_HOST, kgs_PORT = ("127.0.0.1", 18099)


kgs_MIN_PARAMS = {
    "srcappid": "2919",
    "clientver": "1000",
    "clienttime": "1",
    "mid": "1",
    "dfid": "-",
    "keyword": "",
    "page": "1",
    "pagesize": "100",
    "platform": "WebFilter",
    "appid": "1014",
}
