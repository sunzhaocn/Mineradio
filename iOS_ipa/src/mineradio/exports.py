"""Bounded chunked export from WebKit Blobs to a native share sheet."""
import base64
from pathlib import Path
import re
import secrets
import time


class ExportStore:
    MAX_BYTES = 512 * 1024 * 1024
    MAX_PENDING = 3
    MAX_CHUNK = 49152
    TTL = 600

    def __init__(self, root):
        self.root = Path(root).resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        self.pending = {}

    def prune(self):
        for token, entry in tuple(self.pending.items()):
            if time.monotonic() - entry['updated'] > self.TTL:
                self.cancel(token)

    def begin(self, name, size):
        self.prune()
        if type(size) is not int or not 0 <= size <= self.MAX_BYTES:
            raise ValueError('文件过大，单次导出最多 512 MiB')
        if len(self.pending) >= self.MAX_PENDING:
            raise ValueError('请等待当前导出结束')
        # Treat both Windows and POSIX separators as unsafe on every platform.
        name = re.sub(r'[\\/:\x00-\x1f]', '_', str(name)).strip(' .')[:160] or 'Mineradio-export'
        token = secrets.token_hex(16)
        folder = self.root / token
        folder.mkdir()
        path = folder / name
        path.touch(exist_ok=False)
        self.pending[token] = dict(path=path, size=size, written=0, updated=time.monotonic())
        return token

    def append(self, token, offset, data):
        self.prune()
        entry = self.pending[token]
        if type(offset) is not int or offset != entry['written']:
            raise ValueError('导出分块顺序错误')
        if not isinstance(data, str) or len(data) > self.MAX_CHUNK * 4 // 3:
            raise ValueError('导出分块过大')
        raw = base64.b64decode(data, validate=True)
        if len(raw) > self.MAX_CHUNK or entry['written'] + len(raw) > entry['size']:
            raise ValueError('导出文件大小不匹配')
        with entry['path'].open('ab') as stream:
            stream.write(raw)
        entry['written'] += len(raw)
        entry['updated'] = time.monotonic()
        return entry['written']

    def finish(self, token):
        entry = self.pending[token]
        if entry['written'] != entry['size']:
            raise ValueError('导出文件不完整')
        del self.pending[token]
        return entry['path']

    def cancel(self, token):
        entry = self.pending.pop(token, None)
        if entry:
            self.remove(entry['path'])

    def remove(self, path):
        path = Path(path).resolve()
        if path.is_relative_to(self.root) and path.parent.parent == self.root:
            path.unlink(missing_ok=True)
            path.parent.rmdir()
