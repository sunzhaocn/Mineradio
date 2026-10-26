"""解析缓存与已授权音频地址；登录变更同步使旧缓存失效。"""
import threading

AUDIO_URLS = set()
AUDIO_URL_OWNERS = {}
AUDIO_SCOPES = {}
DETAILS = {}
DETAIL_PENDING = {}
DETAIL_GENERATIONS = {}
SONG_LABELS = {}
LOCK = threading.Lock()


def invalidate_login_cache(provider):
    """新登录与退出后重新解析音源，进行中的旧请求不能写回新账号缓存。"""
    with LOCK:
        DETAIL_GENERATIONS[provider] = DETAIL_GENERATIONS.get(provider, 0) + 1
        for cache in (DETAILS, SONG_LABELS):
            for key in list(cache):
                if key[0] == provider:
                    del cache[key]
        for url, owners in list(AUDIO_URL_OWNERS.items()):
            owners.discard(provider)
            if not owners:
                AUDIO_URLS.discard(url)
                del AUDIO_URL_OWNERS[url]
                AUDIO_SCOPES.pop(url, None)
