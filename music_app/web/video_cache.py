"""Bounded, complete MP4 cache so byte ranges never depend on CDN behaviour."""
import hashlib
import os
from pathlib import Path
import tempfile
import threading
import time
from music_app.paths import CACHE_DIR

ROOT = CACHE_DIR / 'mv-v1'
MAX_FILE = 128 * 1024 * 1024
MAX_TOTAL = 512 * 1024 * 1024
MAX_AGE = 6 * 3600
_LOCK = threading.Lock()


def complete_video(url, scope, fetch):
    key = hashlib.sha256((str(scope) + '\n' + url).encode()).hexdigest()
    with _LOCK:
        ROOT.mkdir(parents=True, exist_ok=True)
        target = ROOT / (key + '.mp4')
        if target.is_file() and 0 < target.stat().st_size <= MAX_FILE and time.time() - target.stat().st_mtime < MAX_AGE:
            os.utime(target, None)
            return target
        temporary = None
        try:
            with fetch() as response:
                expected = int(response.headers.get('Content-Length') or 0)
                if response.status != 200 or expected > MAX_FILE:
                    raise ValueError('MV 响应不是完整视频或超过缓存大小限制')
                with tempfile.NamedTemporaryFile(dir=ROOT, prefix=key + '-', suffix='.part', delete=False) as output:
                    temporary = Path(output.name)
                    size = 0
                    while chunk := response.read(65536):
                        size += len(chunk)
                        if size > MAX_FILE:
                            raise ValueError('MV 超过缓存大小限制')
                        output.write(chunk)
                if not size or expected and size != expected:
                    raise ValueError('MV 下载不完整，请重试')
                with temporary.open('rb') as source:
                    if source.read(12)[4:8] != b'ftyp':
                        raise ValueError('MV 响应不是有效 MP4')
            temporary.replace(target)
            temporary = None
            rows = sorted(ROOT.glob('*.mp4'), key=lambda p: p.stat().st_mtime)
            total = sum(p.stat().st_size for p in rows)
            for path in rows:
                if path == target:
                    continue
                if total <= MAX_TOTAL and time.time() - path.stat().st_mtime < MAX_AGE:
                    continue
                total -= path.stat().st_size
                path.unlink(missing_ok=True)
            return target
        finally:
            if temporary is not None:
                temporary.unlink(missing_ok=True)
