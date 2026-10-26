"""本机汽水音频下载、解密缓存和 HTTP Range 输出；不接受客户端指定的 URL/密钥。"""
import concurrent.futures
import hashlib
import json
import os
import re
import shutil
import subprocess
import threading
import time
import urllib.parse
import urllib.request
import uuid

from music_app.paths import CACHE_DIR
from music_app.core import request_credentials
CACHE = CACHE_DIR / 'qishui' / 'audio'
MAX_BYTES = 128 * 1024 * 1024
CACHE_BYTES = 512 * 1024 * 1024
_LOCK = threading.Lock()
_PENDING = {}


def allowed_cdn(url):
    try:
        p = urllib.parse.urlsplit(url)
        host = (p.hostname or '').lower()
        return (p.scheme == 'https' and p.port in (None, 443) and not p.username and
                not p.password and any(host.endswith('.' + d) or host == d
                                      for d in ('douyinvod.com', 'bytecdn.cn')))
    except (ValueError, TypeError):
        return False


class CDNRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if not allowed_cdn(newurl):
            raise ValueError('汽水媒体重定向地址无效')
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def download(url, size):
    if not allowed_cdn(url):
        raise ValueError('汽水媒体地址无效')
    if not isinstance(size, int) or size < 0 or size > MAX_BYTES:
        raise ValueError('汽水音频文件超出大小限制')
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0', 'Accept-Encoding': 'identity'})
    with urllib.request.build_opener(CDNRedirect).open(req, timeout=45) as response:
        if response.status != 200:
            raise ValueError('汽水音频下载未完成')
        length = response.headers.get('Content-Length')
        if length and int(length) > MAX_BYTES:
            raise ValueError('汽水音频文件超出大小限制')
        data = response.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES or (size and len(data) != size):
        raise ValueError('汽水音频文件大小不符')
    return data


def prune_cache(keep):
    files = [p for p in CACHE.glob('*') if p.suffix in ('.m4a', '.flac')]
    sizes = []
    for path in files:
        try:
            stat = path.stat()
            sizes.append((stat.st_mtime, stat.st_size, path))
        except OSError:
            pass
    total = sum(size for _, size, _ in sizes)
    for modified, size, path in sorted(sizes):
        if path == keep:
            continue
        if total <= CACHE_BYTES and time.time() - modified < 86400:
            continue
        try:
            path.unlink()
            total -= size
        except OSError:
            pass


def prepare_audio(song_id, quality):
    from .api import QishuiError, playback_source
    from .media import decrypt_mp4
    # 即使磁盘已有文件，也先验证当前账号本次能取得所选音源。
    source = playback_source(song_id, quality)
    identity = hashlib.sha256(('clear-container-v3:' + request_credentials.fingerprint('qishui') + ':' + song_id + ':' + quality + ':' + str(source['identity'])).encode() + source['key']).hexdigest()
    CACHE.mkdir(parents=True, exist_ok=True)
    with _LOCK:
        for extension in ('.flac', '.m4a'):
            path = CACHE / (identity + extension)
            if path.is_file():
                os.utime(path, None)
                return path
        future = _PENDING.get(identity)
        owner = future is None
        if owner:
            future = concurrent.futures.Future()
            _PENDING[identity] = future
    if not owner:
        try:
            return future.result(timeout=110)
        except concurrent.futures.TimeoutError:
            raise QishuiError(504, 'decryption_timeout', '汽水音频处理超时，请重试') from None
    temporary = []
    try:
        for attempt in range(3):
            try:
                data = download(source['url'], source['size'])
                break
            except (OSError, ValueError):
                if attempt == 2:
                    raise
                time.sleep(.3 * (attempt + 1))
        output, codec = decrypt_mp4(data, source['key'])
        partial = CACHE / (uuid.uuid4().hex + '.part')
        temporary.append(partial)
        partial.write_bytes(output)
        extension = '.m4a'
        ffmpeg = shutil.which('ffmpeg')
        from music_app import platform_runtime
        if platform_runtime.is_mobile():
            remuxed = CACHE / (uuid.uuid4().hex + '.part')
            temporary.append(remuxed)
            extension = '.' + platform_runtime.remux_audio(partial, remuxed)
            partial = remuxed
        elif ffmpeg:
            remuxed = CACHE / (uuid.uuid4().hex + '.part')
            temporary.append(remuxed)
            # 重封装去掉 CENC 辅助盒，避免浏览器继续把已解密样本识别为受保护媒体。
            # stream copy 保留原音频编码和音质。
            arguments = [ffmpeg, '-nostdin', '-v', 'error', '-y', '-i', str(partial),
                         '-map', '0:a:0', '-c:a', 'copy']
            arguments += ['-f', 'flac'] if codec == 'flac' else ['-movflags', '+faststart', '-f', 'ipod']
            result = subprocess.run(arguments + [str(remuxed)],
                                    capture_output=True, timeout=35,
                                    creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
            if result.returncode:
                raise ValueError('汽水音频封装失败')
            partial = remuxed
            extension = '.flac' if codec == 'flac' else '.m4a'
        else:
            raise ValueError('汽水音频封装需要 FFmpeg')
        path = CACHE / (identity + extension)
        os.replace(partial, path)
        with _LOCK:
            prune_cache(path)
        future.set_result(path)
        return path
    except Exception:
        error = QishuiError(502, 'qishui_decryption_failed', '汽水音频下载或解密失败，请重试或更换音质')
        future.set_exception(error)
        raise error from None
    finally:
        for path in temporary:
            path.unlink(missing_ok=True)
        with _LOCK:
            _PENDING.pop(identity, None)


def parse_range(value, size):
    if not value:
        return 0, size - 1, False
    match = re.fullmatch(r'bytes=(\d*)-(\d*)', value)
    if not match or (not match[1] and not match[2]) or size <= 0:
        raise ValueError('Invalid Range')
    if not match[1]:
        suffix = int(match[2])
        if suffix == 0:
            raise ValueError('Invalid Range')
        start, end = max(0, size - suffix), size - 1
    else:
        start, end = int(match[1]), min(int(match[2]), size - 1) if match[2] else size - 1
    if start >= size or end < start:
        raise ValueError('Invalid Range')
    return start, end, True


def serve_audio(handler, song_id, quality, head=False):
    from .api import QishuiError
    headers_sent = False

    def fail(status, code, message):
        if headers_sent:
            handler.close_connection = True
            return
        if not head:
            return handler._send(status, {'code': code, 'msg': message})
        raw = json.dumps({'code': code, 'msg': message}, ensure_ascii=False).encode('utf-8')
        handler.send_response(status)
        handler.send_header('Content-Type', 'application/json; charset=utf-8')
        handler.send_header('Content-Length', str(len(raw)))
        handler.end_headers()
    try:
        for attempt in range(2):
            path = prepare_audio(song_id, quality)
            try:
                with _LOCK:
                    stream = path.open('rb')
                break
            except FileNotFoundError:
                if attempt:
                    raise
        # 打开后缓存清理不会打断已开始的读取。
        with stream:
            size = os.fstat(stream.fileno()).st_size
            try:
                start, end, partial = parse_range(handler.headers.get('Range'), size)
            except ValueError:
                handler.send_response(416)
                handler.send_header('Content-Range', f'bytes */{size}')
                handler.send_header('Content-Length', '0')
                handler.end_headers()
                return
            handler.send_response(206 if partial else 200)
            handler.send_header('Content-Type', 'audio/flac' if path.suffix == '.flac' else 'audio/mp4')
            handler.send_header('Content-Length', str(end - start + 1))
            handler.send_header('Accept-Ranges', 'bytes')
            handler.send_header('Access-Control-Allow-Origin', '*')
            handler.send_header('Cache-Control', 'private, no-store')
            if partial:
                handler.send_header('Content-Range', f'bytes {start}-{end}/{size}')
            handler.end_headers()
            headers_sent = True
            if head:
                return
            stream.seek(start)
            remaining = end - start + 1
            while remaining:
                chunk = stream.read(min(65536, remaining))
                if not chunk:
                    break
                handler.wfile.write(chunk)
                remaining -= len(chunk)
    except QishuiError as error:
        fail(error.status, error.code, str(error))
    except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
        handler.close_connection = True
    except OSError:
        fail(502, 'qishui_audio_io_failed', '汽水音频缓存读取失败，请重试')
