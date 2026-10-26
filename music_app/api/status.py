"""本地健康状态和 API 能力说明。"""

import os
from music_app.api import aggregate as api_aggregate
from music_app.auth import router as auth_router
from music_app.core import cookies as core_cookies
from music_app.providers.kugou import transport as kugou_transport
from music_app.providers.netease import config as netease_config
from music_app.providers.netease import transport as netease_transport
from music_app.providers.qishui import api as qishui_api
from music_app.providers.qqmusic import transport as qqmusic_transport


def health():
    """/health 的本地状态信息；只检查 Cookie 必要字段和加密依赖，不请求上游。
    logged_in 仅表示相关字段已配置，不能证明 Cookie 有效或账号拥有播放权限。"""
    return {
        "ok": True,
        "credentials": "client-per-request",
        "platforms": {
            "qishui": qishui_api.local_status(),
            "kugou": {
                "upstream": [
                    "wwwapi.kugou.com/play/songinfo",
                    "mobiles.kugou.com/api/v3/song/info",
                    "krcs.kugou.com",
                    "lyrics.kugou.com",
                    "complexsearch.kugou.com",
                ],
            },
            "netease": {
                "crypto": bool(netease_config.AES is not None),
                "upstream": [
                    "music.163.com/weapi/v3/song/detail",
                    "music.163.com/weapi/song/enhance/player/url/v1",
                    "music.163.com/api/song/lyric",
                    "music.163.com/api/cloudsearch/pc",
                ],
            },
            "qqmusic": {
                "upstream": [
                    "u.y.qq.com/cgi-bin/musicu.fcg",
                    "c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg",
                ],
            },
        },
    }


def platforms_info():
    """/platforms 的静态接口说明；列出平台 ID/别名、搜索上限、歌曲标识和音质选项。"""
    return {
        "login": auth_router.info(),
        "artists": {
            "endpoint": "/artist",
            "aliases": ["/artist/detail", "/api/artist"],
            "platforms": ["netease", "qqmusic", "kugou", "qishui"],
            "params": ["platform", "id", "mid", "song_id", "name", "offset", "limit"],
            "limit_max": 100,
            "note": "只读歌手资料与热门目录；旧歌曲可通过同平台歌曲元数据恢复歌手 ID，网易热门目录最多约 50 首",
        },
        "albums": {
            "endpoint": "/album",
            "aliases": ["/album/detail", "/api/album"],
            "platforms": ["netease", "qqmusic", "kugou", "qishui"],
            "params": ["platform", "id", "mid", "offset", "limit"],
            "limit_max": 200,
            "note": "只读专辑资料及有序曲目；QQ 支持专辑 mid 或数字 ID，汽水沿用请求级设备会话",
        },
        "platforms": [
            {
                "id": "qishui",
                "name": "汽水音乐",
                "types": ["search", "music"],
                "aliases": ["qishui", "soda", "汽水", "汽水音乐"],
                "search": {"size_max": 100, "max_items": 100, "play": False},
                "music": {
                    "ids": ["track_id"],
                    "quality": [
                        "medium",
                        "higher",
                        "highest",
                        "lossless",
                        "spatial",
                        "hi_res",
                        "auto",
                    ],
                },
                "capabilities": {
                    "search": True,
                    "lyrics": True,
                    "qualities": True,
                    "direct_playback": qishui_api.local_status()["direct_playback"],
                    "charts": True,
                },
                "note": "本机客户端 SDK 签名；账号返回的 CENC 音源经本地解密入口播放",
            },
            {
                "id": "kugou",
                "name": "酷狗音乐",
                "types": ["search", "music"],
                "aliases": ["kugou", "kg", "酷狗", "酷狗音乐"],
                "search": {"size_max": 480, "max_items": 480, "sub_type": False, "play": True},
                "music": {
                    "ids": ["encode_album_audio_id", "32位hash", "mixsong链接"],
                    "quality": ["sq", "320", "high", "128", "auto"],
                },
            },
            {
                "id": "netease",
                "name": "网易云音乐",
                "types": ["search", "music"],
                "aliases": ["netease", "ne", "wy", "163", "网易云", "网易云音乐"],
                "search": {"size_max": 100, "sub_type": True, "play": True},
                "music": {
                    "ids": ["song_id", "music.163.com/song?id=", "歌名"],
                    "quality": ["sq/lossless", "320/exhigh", "high/higher", "128/standard", "auto"],
                },
            },
            {
                "id": "qqmusic",
                "name": "QQ音乐",
                "types": ["search", "music"],
                "aliases": ["qqmusic", "qq", "qqm", "tx", "qq音乐"],
                "search": {"size_max": 50, "sub_type": True, "play": True},
                "music": {
                    "ids": ["songmid", "数字songid", "y.qq.com songDetail 链接", "歌名"],
                    "quality": ["flac/sq", "320", "128", "aac", "auto"],
                },
            },
        ],
        "aggregate": {
            "id": "all",
            "endpoint": "/all",
            "aliases": ["/aggregate"],
            "type": "all",
            "platforms": list(api_aggregate._AGG_PLATFORMS),
            "methods": ["GET"],
            "params": ["search", "size", "max_results", "prefer", "sort", "simple"],
            "note": "独立聚合接口：四平台搜索 + 跨平台去重（按平台轮询顺序），platform 参数只认真实平台，不参与聚合",
        },
    }
