"""完整公开榜单的内存、磁盘缓存与并发加载隔离。"""

import json
import os
import threading
import time
from music_app.paths import CACHE_DIR
from music_app.core import request_credentials

CHART_CACHE_DIR = str(CACHE_DIR / "charts")

_chart_memory = {}

_chart_locks = {}

_chart_lock_guard = threading.Lock()


def chart_cached(key, ttl, loader, refresh=False):
    """同一个榜单只允许一个加载任务；磁盘缓存使重启后仍可使用已获取的公开数据。

    仅缓存完整结果。上游分页中断/重复时返回 complete=false，不把残缺结果冒充全量。
    key 只由内部固定前缀和已校验数字 ID 组成，不能传入任意文件路径。
    """
    scope = request_credentials.fingerprint()
    key = 'request-v2_' + (scope or 'public') + '_' + key
    with _chart_lock_guard:
        lock = _chart_locks.setdefault(key, threading.Lock())
    with lock:
        path = os.path.join(CHART_CACHE_DIR, key + ".json")
        value = _chart_memory.get(key)
        if value is None and not scope:
            try:
                with open(path, encoding="utf-8") as stream:
                    value = json.load(stream)
            except (OSError, ValueError):
                pass
        if not refresh and value and (time.time() - value.get("fetched_at", 0) < ttl):
            _chart_memory[key] = value
            return value
        value = loader()
        value["fetched_at"] = int(time.time())
        if value.get("complete", True):
            _chart_memory[key] = value
            try:
                if scope:
                    return value
                os.makedirs(CHART_CACHE_DIR, exist_ok=True)
                temporary = path + ".%s.tmp" % threading.get_ident()
                with open(temporary, "w", encoding="utf-8") as stream:
                    json.dump(value, stream, ensure_ascii=False, separators=(",", ":"))
                os.replace(temporary, path)
            except OSError:
                pass
        return value
