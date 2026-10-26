"""Persistent image-only cache. Missing/corrupt files are fetched again on demand."""
from hashlib import sha256
from io import BytesIO
import json
import os
import threading
import uuid

from PIL import Image
from music_app import paths

MAX_IMAGE_BYTES = 8 * 1024 * 1024
_LOCKS = [threading.Lock() for _ in range(32)]
PLATFORM_ICONS = {
    'netease': ('https://s1.music.126.net/style/favicon.ico', None),
    'qq': ('https://y.qq.com/favicon.ico', None),
    'kugou': ('https://www.kugou.com/common/images/icon_logo_v20.png', (0, 0, 76, 76)),
    'qishui': ('https://lf-luna.qishui.com/obj/music-luna-fe/luna/home/1.0.0.274/favicon.png', None),
}
PLATFORM_ICON_BACKUPS = {
    'netease': ('https://music.163.com/favicon.ico',),
    'qq': ('https://y.qq.com/mediastyle/global/img/qqmusic.ico',),
    'kugou': ('https://www.kugou.com/favicon.ico',),
    'qishui': ('https://www.qishui.com/favicon.ico',),
}


def _image_type(body):
    # Decode before publishing: HTML error pages, partial images and oversized
    # images must never become permanent successful cache entries.
    try:
        with Image.open(BytesIO(body)) as image:
            if image.format not in ('PNG', 'JPEG', 'GIF', 'WEBP', 'AVIF', 'ICO'):
                raise ValueError('图片格式不受支持')
            if image.width * image.height > 24_000_000:
                raise ValueError('图片尺寸过大')
            image.verify()
            return {'PNG':'image/png', 'JPEG':'image/jpeg', 'GIF':'image/gif',
                    'WEBP':'image/webp', 'AVIF':'image/avif', 'ICO':'image/x-icon'}[image.format]
    except (SyntaxError, Image.DecompressionBombError) as error:
        raise ValueError('图片内容不完整或无效') from error


def cached_image(url, fetch, *, force=False, icon=None):
    """fetch(url) returns image bytes; no cookies or remote URL are written to disk."""
    key = sha256((('icon:' + icon + ':') if icon else 'cover:').encode() + url.encode()).hexdigest()
    directory = paths.CACHE_DIR / 'images-v1' / key[:2]
    image_path, info_path = directory / (key + '.img'), directory / (key + '.json')
    with _LOCKS[int(key[:2], 16) % len(_LOCKS)]:
        if not force:
            try:
                info = json.loads(info_path.read_text(encoding='utf-8'))
                size = image_path.stat().st_size
                if 0 < size <= MAX_IMAGE_BYTES and size == info['size']:
                    body = image_path.read_bytes()
                    if sha256(body).hexdigest() == info['digest'] and str(info['type']).startswith('image/'):
                        return body, info['type'], info['digest']
            except (OSError, ValueError, KeyError, TypeError):
                pass
        body = fetch(url)
        if not body or len(body) > MAX_IMAGE_BYTES:
            raise ValueError('图片为空或超过缓存大小限制')
        content_type = _image_type(body)
        if icon:
            with Image.open(BytesIO(body)) as image:
                image = image.convert('RGBA')
                crop = PLATFORM_ICONS[icon][1]
                if crop and image.width >= crop[2] and image.height >= crop[3]:
                    image = image.crop(crop)
                output = BytesIO()
                image.save(output, format='PNG')
                body, content_type = output.getvalue(), 'image/png'
        digest = sha256(body).hexdigest()
        info = {'type':content_type, 'size':len(body), 'digest':digest}
        temp_image = directory / (key + '.' + uuid.uuid4().hex + '.tmp')
        temp_info = temp_image.with_suffix('.json.tmp')
        try:
            directory.mkdir(parents=True, exist_ok=True)
            temp_image.write_bytes(body)
            temp_info.write_text(json.dumps(info), encoding='utf-8')
            os.replace(temp_image, image_path)
            os.replace(temp_info, info_path)
        except OSError:
            # A full/read-only cache must not prevent displaying the image.
            pass
        finally:
            try:
                temp_image.unlink(missing_ok=True)
                temp_info.unlink(missing_ok=True)
            except OSError:
                pass
        return body, content_type, digest
