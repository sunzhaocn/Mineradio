"""已授权平台媒体与登记成品的流式传输，保留 Range/206。"""
import os
from pathlib import Path
import re
import urllib.error
import urllib.parse
import urllib.request
from music_app.core import request_credentials

from . import client as _web_client
from . import state as _web_state
from . import image_cache as _image_cache


def allowed_media(url):
    parsed = urllib.parse.urlsplit(url)
    host = (parsed.hostname or '').lower()
    return parsed.scheme in ('http', 'https') and parsed.port in (None, 80, 443) and not parsed.username and any(
        host == domain or host.endswith('.' + domain)
        # QQ / 微信账号头像与歌曲封面使用不同的官方 CDN。
        for domain in ('126.net', 'qq.com', 'qlogo.cn', 'qpic.cn', 'gtimg.cn', 'gtimg.com', 'kugou.com', 'kugou.net', 'kgimg.com', 'douyinpic.com', 'douyinvod.com', 'bytecdn.cn', 'byteacctimg.com', 'qishui.com'))

class MediaRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if not allowed_media(newurl):
            raise ValueError('媒体重定向地址不在音乐平台域名内')
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def cover_candidates(url):
    """Same public image on official sibling CDN hosts; retain its exact path."""
    target = urllib.parse.urlsplit(url)
    host = (target.hostname or '').lower()
    hosts = [host]
    if re.fullmatch(r'p[1-4]\.music\.126\.net', host):
        hosts += ['p1.music.126.net', 'p2.music.126.net', 'p3.music.126.net', 'p4.music.126.net']
    elif host in ('y.gtimg.cn', 'y.gtimg.com'):
        hosts += ['y.gtimg.cn', 'y.gtimg.com']
    elif re.fullmatch(r'imge?\.kugou\.com', host):
        hosts += ['imge.kugou.com', 'img.kugou.com']
    return list(dict.fromkeys(urllib.parse.urlunsplit(('https', item, target.path, target.query, '')) for item in hosts))


def fetch_cover_image(url, *, timeout=12):
    """Shared by visible images and the quiet, public-asset initializer."""
    if not allowed_media(url):
        raise ValueError('图片地址不在音乐平台域名内')
    last_error = None
    for candidate in cover_candidates(url):
        try:
            return _fetch_cover_candidate(candidate, timeout=timeout)
        except (OSError, ValueError) as error:
            last_error = error
    raise last_error or ValueError('图片暂时无法读取')


def _fetch_cover_candidate(url, *, timeout):
    host = (urllib.parse.urlsplit(url).hostname or '').lower()
    headers = {'User-Agent':'Mozilla/5.0', 'Accept-Encoding':'identity',
               'Referer': 'https://y.qq.com/' if host.endswith(('qq.com', 'qlogo.cn', 'qpic.cn', 'gtimg.cn', 'gtimg.com'))
               else 'https://www.kugou.com/' if host.endswith(('kugou.com', 'kgimg.com', 'kugou.net'))
               else 'https://www.qishui.com/' if host.endswith('qishui.com') else 'https://music.163.com/'}
    request = urllib.request.Request(url, headers=headers)
    with urllib.request.build_opener(MediaRedirect).open(request, timeout=timeout) as response:
        body = response.read(_image_cache.MAX_IMAGE_BYTES + 1)
        expected = response.headers.get('Content-Length')
        if expected and int(expected) != len(body):
            raise ValueError('图片响应不完整')
        _image_cache._image_type(body)
        return body


def bundled_platform_icon(provider, web_root=None):
    from music_app import paths
    try:
        icon = (web_root or paths.WEB_ROOT) / 'player' / 'assets' / 'platforms' / (provider + '.png')
        if not 0 < icon.stat().st_size <= _image_cache.MAX_IMAGE_BYTES:
            return False
        return _image_cache._image_type(icon.read_bytes()) == 'image/png'
    except (OSError, ValueError):
        return False


def platform_icon(provider, fetch=None, *, web_root=None):
    from music_app import paths
    fetch = fetch or fetch_cover_image
    primary = _image_cache.PLATFORM_ICONS[provider][0]
    def load(_url):
        if bundled_platform_icon(provider, web_root):
            return ((web_root or paths.WEB_ROOT) / 'player' / 'assets' / 'platforms' / (provider + '.png')).read_bytes()
        for candidate in (primary, *_image_cache.PLATFORM_ICON_BACKUPS.get(provider, ())):
            try:
                body = fetch(candidate)
                _image_cache._image_type(body)
                return body
            except (OSError, ValueError):
                continue
        raise OSError('平台图标暂时无法补全')
    return _image_cache.cached_image(primary, load, icon=provider)


class MediaMixin:
    def cached_cover(self, url, *, icon=None):
        query = urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query)
        body, content_type, digest = _image_cache.cached_image(url, fetch_cover_image, force=bool(query.get('v')), icon=icon)
        return self.send_cached_image(body, content_type, digest)

    def send_cached_image(self, body, content_type, digest):
        etag = '"' + digest + '"'
        if self.headers.get('If-None-Match') == etag:
            self.send_response(304)
            self.send_header('ETag', etag)
            self.end_headers()
            return
        self.send_response(200)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'private, max-age=31536000, immutable')
        self.send_header('ETag', etag)
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.end_headers()
        self.wfile.write(body)

    def missing_platform_icon(self, provider):
        try:
            return self.send_cached_image(*platform_icon(provider, web_root=Path(self.directory).parent))
        except (OSError, ValueError):
            return self.json(dict(error='platform_icon_unavailable', message='平台图标暂时无法补全，请稍后重试'), 502)

    def attachment_header(self, name):
        extension = Path(name).suffix
        self.send_header('Content-Disposition', "attachment; filename=\"music" + extension +
                         "\"; filename*=UTF-8''" + urllib.parse.quote(name, safe=''))

    def existing_file(self, path, filename, content_type=None):
        """只流式读取清单已验证的成品，支持单段 Range；不会创建任何文件。"""
        try:
            audio_file = path.open('rb')
        except OSError:
            return self.json(dict(error='existing_file_unavailable', message='音频文件已移动或删除，请重新打开下载列表'), 409)
        with audio_file:
            size = os.fstat(audio_file.fileno()).st_size
            start, end = 0, size - 1
            range_header = self.headers.get('Range')
            if range_header:
                match = re.fullmatch(r'bytes=(\d{0,20})-(\d{0,20})', range_header.strip())
                if match and any(match.groups()):
                    first, last = match.groups()
                    if first:
                        start = int(first)
                        end = min(int(last), size - 1) if last else size - 1
                    elif int(last) > 0:
                        start = max(0, size - int(last))
                    else:
                        match = None
                if not match or not any(match.groups()) or start >= size or end < start:
                    self.send_response(416)
                    self.send_header('Content-Range', 'bytes */' + str(size))
                    self.send_header('Content-Length', '0')
                    self.send_header('Accept-Ranges', 'bytes')
                    self.end_headers()
                    return
            self.send_response(206 if range_header else 200)
            self.send_header('Content-Type', content_type or ('audio/flac' if path.suffix.lower() == '.flac' else 'audio/mp4'))
            self.send_header('Content-Length', str(end - start + 1))
            self.send_header('Accept-Ranges', 'bytes')
            if range_header:
                self.send_header('Content-Range', f'bytes {start}-{end}/{size}')
            if filename:
                self.attachment_header(filename)
            self.send_header('Cache-Control', 'private, no-store')
            self.end_headers()
            audio_file.seek(start)
            remaining = end - start + 1
            try:
                while remaining:
                    chunk = audio_file.read(min(65536, remaining))
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    remaining -= len(chunk)
            except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
                self.close_connection = True

    def media(self, url, audio=False, attachment=None, video=False):
        """同源流式转发保证 WebAudio 可分析；仅允许平台域名和已解析音频。

        Range/206 原样透传，进度拖动不会下载整首后再返回。客户端中断时立即停止读取。
        """
        local_audio = bool(audio and url and _web_client.local_qishui_audio_url(url) == url)
        scopes = _web_state.AUDIO_SCOPES.get(url, set()) if audio else set()
        account_allowed = not scopes or any(request_credentials.fingerprint(provider) == scope for provider, scope in scopes)
        if (not allowed_media(url) and not local_audio) or (audio and (url not in _web_state.AUDIO_URLS or not account_allowed)):
            return self.json(dict(error='媒体地址未获授权，请重新点击播放'), 403)
        if not audio and not video:
            return self.cached_cover(url)
        host = (urllib.parse.urlsplit(url).hostname or '').lower()
        qq_media = any(host == domain or host.endswith('.' + domain) for domain in ('qq.com', 'qlogo.cn', 'qpic.cn'))
        headers = {'User-Agent': 'Mozilla/5.0', 'Accept-Encoding': 'identity',
                   'Referer': 'https://y.qq.com/' if qq_media else 'https://music.163.com/'}
        if video:
            from .video_cache import complete_video
            request = urllib.request.Request(url, headers=headers)
            path = complete_video(url, request_credentials.fingerprint(),
                                  lambda: urllib.request.build_opener(MediaRedirect).open(request, timeout=45))
            return self.existing_file(path, None, content_type='video/mp4')
        if self.headers.get('Range'):
            headers['Range'] = self.headers['Range']
        if local_audio:
            headers['X-Music-Credentials'] = request_credentials.header_value()
        request = urllib.request.Request(url, headers=headers)
        try:
            response = urllib.request.build_opener(MediaRedirect).open(request, timeout=85 if local_audio else 30)
        except urllib.error.HTTPError as error:
            if error.code != 416 or not (local_audio or attachment):
                raise
            response = error
        with response:
            self.send_response(response.status)
            for name in ('Content-Type', 'Content-Length', 'Content-Range', 'Accept-Ranges'):
                if response.headers.get(name):
                    self.send_header(name, response.headers[name])
            if attachment:
                # ASCII 回退兼容旧客户端，filename* 保留中文；文件名已在生成时清理。
                self.attachment_header(attachment)
            if not response.headers.get('Content-Length'):
                self.send_header('Connection', 'close')
                self.close_connection = True
            self.send_header('Cache-Control', 'private, no-store' if local_audio or attachment else 'private, max-age=300')
            self.end_headers()
            try:
                while chunk := response.read(65536):
                    self.wfile.write(chunk)
            except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
                self.close_connection = True
