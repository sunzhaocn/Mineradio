"""登录资料的格式解析、原子写入和公开账号字段白名单。"""
import os
from pathlib import Path
import tempfile
from urllib.parse import urlsplit

PROVIDERS = {'netease': 'netease', 'qq': 'qqmusic', 'kugou': 'kugou', 'qishui': 'qishui'}
LABELS = {'netease': '网易云音乐', 'qq': 'QQ音乐', 'kugou': '酷狗音乐', 'qishui': '汽水音乐'}
STATUS_ROUTES = {'/api/login/status': 'netease', '/api/qq/login/status': 'qq',
                 '/api/kugou/login/status': 'kugou', '/api/qishui/status': 'qishui'}
POST_ROUTES = {f'/api/local/auth/{name}' for name in ('session', 'sms', 'login', 'check', 'logout', 'show', 'verify')}
_ALIASES = {'网易云音乐': 'netease', '网易云': 'netease', 'netease': 'netease', '163': 'netease',
            'qq音乐': 'qq', 'qq': 'qq', 'qqmusic': 'qq', '酷狗音乐': 'kugou', '酷狗': 'kugou',
            'kugou': 'kugou', '酷狗概念版': 'kugou'}
_PLACEHOLDERS = {'netease': 'MUSIC_U=;', 'qq': 'uin=; qqmusic_key=;',
                 'kugou': 'userid=; token=; uin=; uk=; t=; Token=; KugooID=; UserId=;'}


def _norm(value):
    value = value.strip().strip('#[]【】<> \t').lower()
    return _ALIASES.get(value, _ALIASES.get(value.replace('音乐', '').replace(' ', ''), value))

def _records(text):
    result, pending = {}, None
    for index, raw in enumerate(text.splitlines()):
        value = raw.strip()
        if not value or value.startswith('#'):
            continue
        if len(value) <= 32 and not any(c in value for c in '=;{'):
            pending = _norm(value)
        elif pending:
            result.setdefault(pending, (index, value))
            pending = None
    return result

def _read_text(path):
    if not path.exists():
        return '', False
    raw = path.read_bytes()
    return raw.decode('utf-8-sig'), raw.startswith(b'\xef\xbb\xbf')

def _atomic_write(path, data):
    """同目录原子替换，避免并发读取看到半份凭据。"""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        fd, temporary = tempfile.mkstemp(prefix='.' + path.name + '.', suffix='.tmp', dir=path.parent)
        with os.fdopen(fd, 'wb') as output:
            output.write(data)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, path)
        temporary = None
    finally:
        if temporary:
            try:
                os.unlink(temporary)
            except OSError:
                pass

def _cookie_values(cookie):
    return {k.strip(): v.strip() for item in cookie.split(';') if '=' in item
            for k, v in [item.split('=', 1)]}

def _valid_cookie(provider, cookie):
    if not isinstance(cookie, str) or len(cookie) > 65536 or any(c in cookie for c in '\r\n\x00'):
        return False
    values = _cookie_values(cookie)
    if provider == 'netease':
        return bool(values.get('MUSIC_U'))
    if provider == 'qq':
        return bool((values.get('qqmusic_uin') or values.get('uin') or values.get('wxuin')) and
                    (values.get('qqmusic_key') or values.get('qm_keyst') or values.get('qqmusic_key2') or values.get('wxmusickey')))
    if provider == 'kugou':
        return bool((values.get('userid') or values.get('uin') or values.get('KugooID')) and
                    (values.get('token') or values.get('uk') or values.get('t')))
    return bool(cookie.strip())

def _configured_cookie(provider, cookie):
    if not isinstance(cookie, str) or any(c in cookie for c in '\r\n\x00'):
        return False
    values = _cookie_values(cookie)
    if provider == 'qq' and values.get('p_uin') and values.get('p_skey'):
        return True
    if provider == 'kugou' and (values.get('KuGoo') or
            ((values.get('KugooID') or values.get('UserId')) and (values.get('t') or values.get('Token')))):
        return True
    return _valid_cookie(provider, cookie)

def public_account(account, provider=''):
    """账号白名单，不透传任意上游对象、令牌或电话号码。"""
    if not isinstance(account, dict):
        return {}
    result = {}
    if provider == 'qq':
        from music_app.auth.qqmusic.profile import identity
        account = {**account, **identity(account, known_qq_uin=account.get('qqUin') or account.get('uin'))}
    for target, names, maximum in [('id', ('id', 'userId', 'uid', 'uin'), 128),
                                   ('name', ('name', 'nickname'), 256),
                                   ('avatar', ('avatar', 'avatarUrl'), 4096)]:
        value = next((account[n] for n in names if account.get(n) is not None), '')
        if isinstance(value, (str, int)) and not isinstance(value, bool):
            value = str(value)
            if len(value) <= maximum and not any(ord(c) < 32 for c in value):
                if target != 'avatar' or urlsplit(value).scheme in ('https', 'http'):
                    result[target] = value
    value = account.get('vip_type')
    if isinstance(value, int) and not isinstance(value, bool) and 0 <= value <= 100:
        result['vip_type'] = value
    if provider == 'qq' and account.get('qqUin'):
        result['qqUin'] = account['qqUin']
    return result
