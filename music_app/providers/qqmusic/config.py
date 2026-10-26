"""平台适配：qqmusic / config。"""

from music_app.core import cookies as core_cookies

qq_COOKIE = ""


qq_COOKIE_FILE = "qq_cookie.txt"


qq_ENV_COOKIE = "QQMUSIC_COOKIE"


qq_BASE = "https://y.qq.com"


qq_MUSICU = "https://u.y.qq.com/cgi-bin/musicu.fcg"


qq_LYRIC_FCG = "https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg"


qq_SEARCH_FCG = "https://c.y.qq.com/soso/fcgi-bin/client_search_cp"


qq_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"


qq_REFERER = "https://y.qq.com/"


qq_LYRIC_REFERER = "https://y.qq.com/portal/player.html"


qq_HOST, qq_PORT = ("127.0.0.1", 18101)


qq_GUID = "6666666666"


qq_GUID_POOL = (qq_GUID, "8888888888", "1008610000")


qq_SEARCH_TYPE = {0: "song", 1: "singer", 2: "album", 3: "songlist", 4: "mv"}


qq_BODY_KEY = {0: "song", 1: "singer", 2: "album", 3: "songlist", 4: "mv"}


qq_QUALITY_LADDER = [
    ("flac", "SQ(无损)", "F000", "flac", "size_flac", None),
    ("320", "320k", "M800", "mp3", "size_320mp3", 320),
    ("128", "128k", "M500", "mp3", "size_128mp3", 128),
    ("aac", "96k AAC", "C400", "m4a", "size_96aac", 96),
]


qq_QUALITY_KEY = {
    "sq": "flac",
    "flac": "flac",
    "lossless": "flac",
    "无损": "flac",
    "hires": "flac",
    "320": "320",
    "320k": "320",
    "exhigh": "320",
    "高品": "320",
    "128": "128",
    "128k": "128",
    "standard": "128",
    "标准": "128",
    "aac": "aac",
    "96": "aac",
    "96k": "aac",
    "m4a": "aac",
}


qqs_COOKIE = ""


qqs_COOKIE_FILE = "qq_cookie.txt"


qqs_ENV_COOKIE = "QQMUSIC_COOKIE"


qqs_MUSICU = "https://u.y.qq.com/cgi-bin/musicu.fcg"


qqs_BASE = "https://y.qq.com"


qqs_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"


qqs_REFERER = "https://y.qq.com/"


qqs_HOST, qqs_PORT = ("127.0.0.1", 18102)


qqs_MAX_SIZE = 50


qqs_GUID = "6666666666"


qqs_GUID_POOL = (qqs_GUID, "8888888888", "1008610000")


qqs_TYPE_UPSTREAM = {1: 0, 10: 2, 100: 1, 1000: 3, 1004: 4, 0: 0, 2: 2, 3: 3, 4: 4}


qqs_TYPE_NAME = {
    1: "song",
    10: "album",
    100: "singer",
    1000: "songlist",
    1004: "mv",
    0: "song",
    2: "album",
    3: "songlist",
    4: "mv",
}


qqs_TYPE_WORD = {
    "song": 1,
    "music": 1,
    "歌曲": 1,
    "album": 10,
    "专辑": 10,
    "singer": 100,
    "artist": 100,
    "歌手": 100,
    "songlist": 1000,
    "playlist": 1000,
    "歌单": 1000,
    "mv": 1004,
    "视频": 1004,
}


qqs_BODY_KEY = {0: "song", 1: "singer", 2: "album", 3: "songlist", 4: "mv"}


qqs_PLAY_LADDER = [
    ("flac", "F000", "flac", "size_flac", None),
    ("320", "M800", "mp3", "size_320mp3", 320),
    ("128", "M500", "mp3", "size_128mp3", 128),
    ("aac", "C400", "m4a", "size_96aac", 96),
]


qqs_LEVEL_ALIAS = {
    "flac": "flac",
    "sq": "flac",
    "lossless": "flac",
    "无损": "flac",
    "320": "320",
    "320k": "320",
    "exhigh": "320",
    "128": "128",
    "128k": "128",
    "standard": "128",
    "aac": "aac",
    "96": "aac",
    "m4a": "aac",
    "auto": "128",
    "best": "flac",
    "": "128",
}
