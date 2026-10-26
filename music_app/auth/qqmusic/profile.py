"""Public QQ Music identity fields; music IDs and QQ numbers are distinct."""
import re
from urllib.parse import urlsplit, urlunsplit


def avatar_url(value):
    if not isinstance(value, str) or len(value) > 4096 or any(ord(c) < 32 for c in value):
        return ''
    value = value.strip()
    if value.startswith('//'):
        value = 'https:' + value
    try:
        parts = urlsplit(value)
        if (parts.scheme not in ('http', 'https') or not parts.hostname or parts.username or parts.password
                or parts.port not in (None, 80, 443)):
            return ''
        # Official avatar CDNs support HTTPS; avoid cached insecure image URLs.
        return urlunsplit(('https', parts.netloc.removesuffix(':80'), parts.path, parts.query, ''))
    except ValueError:
        return ''


def qq_uin(value):
    value = str(value or '').removeprefix('o').lstrip('0')
    return value if re.fullmatch(r'[1-9][0-9]{4,15}', value) else ''


def fallback_avatar(uin):
    uin = qq_uin(uin)
    return 'https://q.qlogo.cn/headimg_dl?dst_uin=' + uin + '&spec=100&img_type=jpg' if uin else ''


def identity(data, *, known_qq_uin='', name=''):
    """Only an actual QQ login callback/explicit QQ field can supply dst_uin."""
    result = {}
    for key in ('nickname', 'nick', 'name'):
        if isinstance(data.get(key), str) and data[key]:
            name = data[key]
            break
    if isinstance(name, str) and name:
        result['name'] = name
    uin = qq_uin(known_qq_uin or data.get('qqUin') or data.get('qq_uin'))
    if uin:
        result['qqUin'] = uin
    for key in ('avatar', 'avatarUrl', 'avatar_url', 'headurl', 'headpic', 'picurl',
                'figureurl_qq_2', 'figureurl_qq_1', 'figureurl_2', 'figureurl_1'):
        value = avatar_url(data.get(key))
        if value:
            result['avatar'] = value
            break
    if not result.get('avatar') and uin:
        result['avatar'] = fallback_avatar(uin)
    return result
