"""按登录账号代次隔离平台缓存，避免旧请求污染切换后的账号。"""

generations = {"netease": 0, "qqmusic": 0, "kugou": 0}
cache_groups = {}
cache_platforms = {}


def bind_caches(groups):
    """注册各平台持有的缓存对象；映射对象保持稳定供调用方引用。"""
    cache_groups.clear()
    cache_groups.update(groups)
    cache_platforms.clear()
    cache_platforms.update(
        (id(cache), platform) for platform, caches in groups.items() for cache in caches
    )


def credential_cache_key(platform, key):
    """进行中的旧请求只可写入旧代缓存，原始第一代键格式保持不变。"""
    from music_app.core.request_credentials import fingerprint
    return (fingerprint(platform), generations.get(platform, 0), key)


def invalidate_platform(platform):
    generations[platform] += 1
    for cache in cache_groups.get(platform, ()):
        cache.clear()
