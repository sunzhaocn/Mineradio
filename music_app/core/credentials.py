"""注册平台缓存；旧凭据热加载入口已停用，凭据仅随客户端请求传入。"""

import os
import threading

from music_app.core import cache
from music_app.core.cookies import unified_cookie, unified_cookie_paths
from music_app.paths import resolve_project_path
from music_app.providers.kugou import config as kugou_config
from music_app.providers.kugou import music as kugou_music
from music_app.providers.kugou import search as kugou_search
from music_app.providers.netease import config as netease_config
from music_app.providers.netease import music as netease_music
from music_app.providers.netease import search as netease_search
from music_app.providers.netease import search_play as netease_search_play
from music_app.providers.netease import transport as netease_transport
from music_app.providers.qqmusic import config as qqmusic_config
from music_app.providers.qqmusic import music as qqmusic_music
from music_app.providers.qqmusic import quality as qqmusic_quality
from music_app.providers.qqmusic import search as qqmusic_search
from music_app.providers.qqmusic import search_play as qqmusic_search_play
from music_app.providers.qqmusic import search_transport as qqmusic_search_transport
from music_app.providers.qqmusic import transport as qqmusic_transport

KG_COOKIE = NE_COOKIE = QQ_COOKIE = ""

kugou_config.kg_COOKIE = kugou_config.kgs_COOKIE = KG_COOKIE
netease_config.ne_COOKIE = NE_COOKIE
netease_config.nes_COOKIE = ""
qqmusic_config.qq_COOKIE = ""
qqmusic_config.qqs_COOKIE = ""

cache.bind_caches(
    {
        "netease": (
            netease_music.ne__CACHE,
            netease_search.nes__SEARCH_CACHE,
            netease_search_play.nes__PLAY_CACHE,
            netease_search.nes__DETAIL_CACHE,
        ),
        "qqmusic": (
            qqmusic_music.qq__CACHE,
            qqmusic_quality.qq__VKEY_CACHE,
            qqmusic_search.qqs__SRCH_CACHE,
            qqmusic_search_play.qqs__URL_CACHE,
        ),
        "kugou": (
            kugou_music.kg__CACHE,
            kugou_search.kgs__CACHE,
            kugou_search.kgs__URL_CACHE,
        ),
    }
)

_credential_reload_lock = threading.Lock()


def _credential_files_version():
    return ()


_credential_files_loaded = ()


def reload_credentials_if_changed():
    """兼容旧调用，不读取本机文件或更改任何请求的账号。"""
    # Cookie 随请求使用；保留旧入口仅兼容导入者，不检查共享文件。
    return []
