"""评论适配器的公开错误、数值和展示资源约束。"""
import base64
import binascii
import re
from urllib.parse import urlsplit, urlunsplit


class CommentError(Exception):
    def __init__(self, code, message, status=400):
        super().__init__(message)
        self.code, self.message, self.status = code, message, status


def number(value, default=0):
    try:
        return max(0, int(value if value is not None else default))
    except (TypeError, ValueError, OverflowError):
        return default


def text(value, maximum=20000):
    return str(value if value is not None else '')[:maximum].replace('\x00', '')


_IMAGE_DOMAINS = ('126.net', '127.net', '163.com', 'music.163.com', 'qq.com', 'qpic.cn',
                  'qlogo.cn', 'gtimg.cn', 'gtimg.com', 'kgimg.com', 'kugou.com', 'kugou.net',
                  'douyinpic.com', 'byteimg.com', 'bytecdn.cn', 'byteacctimg.com', 'pstatp.com',
                  'ibytedtos.com', 'bytedance.com', 'soda.com', 'qishui.com')


def image_url(value):
    """平台公开 HTTPS 图片及客户端内嵌的有限 PNG 表情。"""
    if isinstance(value, str) and value.startswith('data:image/png;base64,'):
        if len(value) > 87406:
            return ''
        encoded = value[22:]
        if not re.fullmatch(r'[A-Za-z0-9+/]+={0,2}', encoded):
            return ''
        try:
            decoded = base64.b64decode(encoded, validate=True)
        except (ValueError, binascii.Error):
            return ''
        return value if len(decoded) <= 65536 and decoded.startswith(b'\x89PNG\r\n\x1a\n') else ''
    value = text(value, 8192).strip()
    if value.startswith('//'):
        value = 'https:' + value
    try:
        parsed = urlsplit(value)
        host = (parsed.hostname or '').lower()
        if (parsed.scheme not in ('http', 'https') or parsed.username or parsed.password or
                parsed.port not in (None, 80, 443) or any(ord(c) < 32 for c in value) or
                not any(host == domain or host.endswith('.' + domain) for domain in _IMAGE_DOMAINS)):
            return ''
        return urlunsplit(('https', parsed.netloc, parsed.path, parsed.query, ''))
    except ValueError:
        return ''


def normalize_comment(raw, *, depth=0):
    """仅放行页面需要的字段；不把完整账号对象或鉴权资料交给浏览器。"""
    if not isinstance(raw, dict):
        return None
    identifier = text(raw.get('id') or raw.get('commentId'), 256)
    if not identifier:
        return None
    source_user = raw.get('user') if isinstance(raw.get('user'), dict) else {}
    badges = []
    for badge in source_user.get('badges') or []:
        if not isinstance(badge, dict):
            continue
        label = text(badge.get('label'), 80)
        icon = image_url(badge.get('iconUrl'))
        if label or icon:
            badges.append(dict(label=label, iconUrl=icon, type=text(badge.get('type'), 32)))
    user = dict(id=text(source_user.get('id'), 256), nickname=text(source_user.get('nickname') or '音乐用户', 200),
                avatarUrl=image_url(source_user.get('avatarUrl') or source_user.get('avatar')), badges=badges[:12])
    segments = []
    for part in raw.get('segments') or []:
        if not isinstance(part, dict):
            continue
        kind = part.get('type')
        if kind == 'text':
            segments.append(dict(type='text', text=text(part.get('text'))))
        elif kind in ('emoji', 'image'):
            url = image_url(part.get('url'))
            if url:
                segments.append(dict(type=kind, url=url, alt=text(part.get('alt'), 200)))
            elif part.get('alt'):
                segments.append(dict(type='text', text=text(part['alt'], 200)))
    pictures = []
    for picture in raw.get('pictures') or []:
        picture = picture if isinstance(picture, dict) else {'url': picture}
        url = image_url(picture.get('url'))
        if url:
            pictures.append(dict(url=url, thumbnailUrl=image_url(picture.get('thumbnailUrl')) or url,
                                 alt=text(picture.get('alt') or '评论图片', 200)))
    replies = []
    if depth < 1:
        for reply in (raw.get('replies') or [])[:10]:
            normalized = normalize_comment(reply, depth=depth + 1)
            if normalized:
                replies.append(normalized)
    return dict(id=identifier, content=text(raw.get('content')), segments=segments[:300], pictures=pictures[:12],
                user=user, time=number(raw.get('time')), timeText=text(raw.get('timeText'), 80),
                likedCount=number(raw.get('likedCount')), liked=bool(raw.get('liked')),
                replyCount=number(raw.get('replyCount')), replies=replies, location=text(raw.get('location'), 120),
                canLike=bool(raw.get('canLike', True)))
