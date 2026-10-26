"""Read public account identity with this request's credentials; never persist cookies."""
import html
import json
import re
import urllib.parse
import urllib.request

from music_app.core import request_credentials
from music_app.auth.qqmusic.profile import avatar_url
from .auth_data import public_account


def _fields(cookie):
    return {key.strip(): value.strip().strip('"') for part in cookie.split(';')
            if '=' in part for key, value in [part.split('=', 1)]}


def _decode_text(value):
    value = str(value or '')
    for _ in range(3):
        before = value
        value = urllib.parse.unquote(value)
        for pattern in (r'(?:%u[0-9a-fA-F]{4})+', r'(?:\\u[0-9a-fA-F]{4})+'):
            value = re.sub(pattern, lambda match: bytes.fromhex(
                re.sub(r'%u|\\u', '', match.group())).decode('utf-16-be', 'replace'), value)
        value = html.unescape(value)
        if value == before:
            break
    return value


def _netease():
    from music_app.providers.netease.library import _request
    result = _request('/weapi/w/nuser/account/get', {})
    profile = result.get('profile') or {}
    return {'id': profile.get('userId') or (result.get('account') or {}).get('id'),
            'name': profile.get('nickname'), 'avatar': profile.get('avatarUrl')}


def _qq():
    from music_app.providers.qqmusic import transport
    from music_app.auth.qqmusic.profile import identity, qq_uin
    cookie = request_credentials.cookie('qqmusic')
    fields = _fields(cookie)
    uid = (fields.get('qqmusic_uin') or fields.get('uin') or fields.get('p_uin') or '').removeprefix('o')
    if not re.fullmatch(r'[1-9]\d{4,19}', uid):
        raise ValueError('QQ 音乐 Cookie 缺少账号编号')
    params = {'g_tk': transport.qq_hash33(transport.qq_cookie_fields(cookie)['key']),
              'format': 'json', 'inCharset': 'utf-8', 'outCharset': 'utf-8', 'notice': 0,
              'cid': '205360838', 'needNewCode': 0, 'loginUin': uid, 'hostUin': 0,
              'userid': uid, 'reqfrom': 1}
    body = transport.qq_http_json('https://c6.y.qq.com/rsc/fcgi-bin/fcg_get_profile_homepage.fcg?' +
                                   urllib.parse.urlencode(params), transport.qq_headers(cookie), timeout=12)
    if not isinstance(body, dict) or body.get('code') not in (0, '0'):
        raise ValueError('QQ 音乐账号资料暂时无法读取')
    data = body.get('data') or {}
    creator = data.get('creator') or data.get('user_info') or data.get('userinfo') or {}
    # A music account id must never be substituted for a real QQ number.
    account = {'id': uid, **identity(creator, known_qq_uin=qq_uin(fields.get('p_uin')))}
    account['name'] = html.unescape(str(account.get('name') or creator.get('nick') or creator.get('nickname') or ''))
    return account


def _kugou_identity(fields):
    from music_app.providers.kugou.transport import _legacy_cookie_fields
    nested = _legacy_cookie_fields(fields.get('KuGoo') or fields.get('kugou') or '')
    account = {}
    for target, names in (('name', ('NickName', 'nickname', 'CuName', 'username')),
                          ('avatar', ('Pic', 'pic', 'avatar'))):
        value = next((fields.get(name) or (nested.get(name) or [''])[0] for name in names
                      if fields.get(name) or nested.get(name)), '')
        if value:
            account[target] = _decode_text(value)
    return account


def _kugou():
    from music_app.providers.kugou.transport import kg_cookie_fields
    credentials = kg_cookie_fields()
    if not re.fullmatch(r'[1-9]\d{0,24}', credentials['uid']) or not credentials['token']:
        raise ValueError('酷狗 Cookie 缺少账号或令牌')
    # Importing or inspecting a Cookie must never perform autologin, exchange
    # tokens or register a device. These are login operations and can revoke
    # the original session. Identity in the supplied Cookie is optional; the
    # client retains an already saved QR profile when the Cookie is unchanged.
    return {'id': credentials['uid'], **_kugou_identity(_fields(credentials['raw']))}


def _qishui_passport():
    from music_app.auth.qishui.common import USER_AGENT
    query = urllib.parse.urlencode({'aid': '386088', 'app_name': 'luna_pc',
                                   'account_sdk_source': 'web', 'language': 'zh'})
    request = urllib.request.Request('https://api.qishui.com/passport/account/info/v2/?' + query,
        headers={'Cookie': request_credentials.cookie('qishui'), 'User-Agent': USER_AGENT,
                 'Referer': 'https://www.qishui.com/'})
    with urllib.request.urlopen(request, timeout=12) as response:
        result = json.loads(response.read(1024 * 1024))
    if not isinstance(result, dict) or result.get('message') != 'success' or not isinstance(result.get('data'), dict):
        raise ValueError('汽水 Cookie 账号资料暂时无法读取')
    return result['data']


def _qishui_identity(data):
    from music_app.providers.qishui.comments import _url
    if not isinstance(data, dict):
        raise ValueError('汽水账号资料暂时无法读取')
    user = next((data[key] for key in ('my_info', 'user', 'user_info', 'account', 'me')
                 if isinstance(data.get(key), dict)), data)
    avatar = next((user[key] for key in ('avatar_url', 'avatar', 'url_avatar', 'medium_avatar_url',
                                       'thumb_avatar_url') if user.get(key)), '')
    return {'id': user.get('id') or user.get('user_id') or user.get('uid'),
            'name': user.get('nickname') or user.get('public_name') or user.get('screen_name') or user.get('name'),
            'avatar': _url(avatar, avatar=True)}


def _qishui():
    # Passport identity only needs the supplied Cookie, not desktop device ids.
    # Media/library requests keep their existing device-session requirements.
    try:
        account = _qishui_identity(_qishui_passport())
        if account.get('avatar') and account.get('name'):
            return account
    except (OSError, ValueError):
        pass
    from music_app.providers.qishui.client import request_json
    body = request_json('me')
    return _qishui_identity(body.get('data', body))


def read(provider):
    if provider not in ('netease', 'qq', 'kugou', 'qishui'):
        raise ValueError('请选择有效的音乐平台')
    if not request_credentials.cookie('qqmusic' if provider == 'qq' else provider):
        raise ValueError('请先提供当前平台的 Cookie')
    raw = {'netease': _netease, 'qq': _qq, 'kugou': _kugou, 'qishui': _qishui}[provider]()
    raw['name'] = _decode_text(raw.get('name'))
    raw['avatar'] = avatar_url(raw.get('avatar'))
    account = public_account(raw, provider=provider)
    if not any(account.get(key) for key in ('name', 'avatar')):
        raise ValueError('平台未返回可用的昵称或头像，请稍后重试')
    return {'provider': provider, 'account': account, 'storage': 'client', 'membershipKnown': False}
