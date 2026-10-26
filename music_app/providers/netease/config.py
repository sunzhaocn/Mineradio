"""平台适配：netease / config。"""

from music_app.core import cookies as core_cookies

try:
    from music_app.runtime_crypto import AES
except Exception:
    AES = None


nes__HAS_CRYPTO = AES is not None


ne_COOKIE = ""


ne_BASE = "https://music.163.com"


ne_SEARCH_API = ne_BASE + "/api/search/get/"


ne_DETAIL_API = ne_BASE + "/weapi/v3/song/detail"


ne_PLAYER_API = ne_BASE + "/weapi/song/enhance/player/url/v1"


ne_PLAYER_OLD = ne_BASE + "/api/song/enhance/player/url"


ne_LYRIC_API = ne_BASE + "/api/song/lyric"


ne_ACCOUNT_API = ne_BASE + "/weapi/w/nuser/account/get"


ne_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"


ne_REFERER = "https://music.163.com/"


ne_HOST, ne_PORT = ("127.0.0.1", 18099)


ne_CBC_KEY = b"0CoJUm6Qyw8W8jud"


ne_CBC_IV = b"0102030405060708"


ne_RSA_EXP = "010001"


ne_RSA_MOD = "00e0b509f6259df8642dbc35662901477df22677ec152b5ff68ace615bb7b725152b3ab17a876aea8a5aa76d2e417629ec4ee341f56135fccf695280104e0312ecbda92557c93870114af6c9d05c4f7f0c3685b7a46bee255932575cce10b424d813cfe4875d3e82047b97ddef52741d546b8e289dc6935b3ece0462db0a22b8e7"


ne_QUALITY_LADDER = [
    ("lossless", "SQ(无损)", "lossless", 999000),
    ("exhigh", "320k", "exhigh", 320000),
    ("higher", "192k", "higher", 192000),
    ("standard", "128k", "standard", 128000),
]


ne_QUALITY_KEY = {
    "sq": "lossless",
    "flac": "lossless",
    "lossless": "lossless",
    "无损": "lossless",
    "320": "exhigh",
    "320k": "exhigh",
    "exhigh": "exhigh",
    "极高": "exhigh",
    "high": "higher",
    "高品": "higher",
    "higher": "higher",
    "192": "higher",
    "较高": "higher",
    "128": "standard",
    "128k": "standard",
    "standard": "standard",
    "标准": "standard",
}


nes_BASE = "https://music.163.com"


nes_SEARCH_API = nes_BASE + "/api/cloudsearch/pc"


nes_SEARCH_LEGACY = nes_BASE + "/api/search/get/"


nes_PLAY_API = "/weapi/song/enhance/player/url/v1"


nes_DETAIL_API = "/weapi/v3/song/detail"


nes_ACCOUNT_API = "/weapi/w/nuser/account/get"


nes_HOST, nes_PORT = ("127.0.0.1", 18100)


nes_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"


nes_TYPES = {1: "song", 10: "album", 100: "artist", 1000: "playlist", 1002: "user", 1004: "mv"}


nes_LEVELS = {"standard": 128000, "higher": 192000, "exhigh": 320000, "lossless": 999000}


nes__ORDER = ["lossless", "exhigh", "higher", "standard"]


nes_MAX_SIZE = 100


nes__AES_KEY = b"0CoJUm6Qyw8W8jud"


nes__AES_IV = b"0102030405060708"


nes__RSA_E = 65537


nes__RSA_N = int(
    "00e0b509f6259df8642dbc35662901477df22677ec152b5ff68ace615bb7b725152b3ab17a876aea8a5aa76d2e417629ec4ee341f56135fccf695280104e0312ecbda92557c93870114af6c9d05c4f7f0c3685b7a46bee255932575cce10b424d813cfe4875d3e82047b97ddef52741d546b8e289dc6935b3ece0462db0a22b8e7",
    16,
)


nes_COOKIE = ""
