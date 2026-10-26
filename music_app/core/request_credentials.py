"""客户端随请求提交的凭据；只在当前上下文使用，不读取或写入磁盘。"""
from contextlib import contextmanager
from contextvars import ContextVar, copy_context
import hashlib
import json
import re
import urllib.parse

_CURRENT = ContextVar('music_request_credentials', default=None)
_PROVIDERS = {'netease', 'qqmusic', 'kugou', 'qishui'}


def _provider(value):
    value = str(value or '').strip().lower()
    aliases = {'qq': 'qqmusic', 'qqm': 'qqmusic', 'tx': 'qqmusic', 'tencent': 'qqmusic', 'qq音乐': 'qqmusic', '腾讯': 'qqmusic',
               'ne': 'netease', '163': 'netease', 'wy': 'netease', 'wangyi': 'netease', 'neteasecloud': 'netease',
               '网易': 'netease', '网易云': 'netease', '网易云音乐': 'netease',
               'kg': 'kugou', 'kgmusic': 'kugou', '酷狗': 'kugou', '酷狗音乐': 'kugou',
               'soda': 'qishui', '汽水': 'qishui', '汽水音乐': 'qishui'}
    return aliases.get(value, value)


def _text(value, maximum=65536):
    if not isinstance(value, str) or len(value) > maximum or any(ord(c) < 32 or ord(c) == 127 for c in value):
        raise ValueError('请求凭据格式错误')
    return value.strip()


def normalize(value):
    if value in (None, ''):
        return {}
    if isinstance(value, str):
        if len(value) > 262144:
            raise ValueError('请求凭据过长')
        try:
            value = json.loads(value)
        except (ValueError, TypeError):
            raise ValueError('请求凭据 JSON 格式错误') from None
    if not isinstance(value, dict):
        raise ValueError('请求凭据格式错误')
    result = {}
    for name, entry in value.items():
        provider = _provider(name)
        if provider not in _PROVIDERS:
            continue
        if isinstance(entry, str):
            entry = {'cookie': entry}
        if not isinstance(entry, dict):
            raise ValueError('请求凭据格式错误')
        item = {'cookie': _text(entry.get('cookie', ''))}
        item['cookie'] = re.sub(r'^cookie:\s*', '', item['cookie'], flags=re.I).strip()
        if provider == 'qishui':
            session = entry.get('session_config') or entry.get('session')
            if session is not None:
                if (not isinstance(session, dict) or not isinstance(session.get('query'), dict) or
                        not isinstance(session.get('headers', {}), dict)):
                    raise ValueError('汽水会话格式错误')
                query = {}
                for key, val in session['query'].items():
                    if not isinstance(key, str) or not isinstance(val, (str, int, float, bool)):
                        raise ValueError('汽水会话参数格式错误')
                    query[_text(key, 128)] = _text(str(val), 4096)
                allowed = {'cookie', 'user-agent', 'x-luna-background-type', 'x-luna-is-background-req', 'x-luna-is-local-user'}
                headers = {key.lower(): _text(val) for key, val in session.get('headers', {}).items()
                           if isinstance(key, str) and key.lower() in allowed}
                item['cookie'] = item['cookie'] or headers.get('cookie', '')
                headers['cookie'] = item['cookie']
                item['session_config'] = {'query': query, 'headers': headers}
        if item['cookie'] or item.get('session_config'):
            result[provider] = item
    return result


def parse_request(headers, query, provider=None):
    """支持 JSON 凭据映射，或指定平台的 Cookie 头/参数；从不回退服务端资料。"""
    if isinstance(query, str):
        query = urllib.parse.parse_qs(query, keep_blank_values=True)
    elif hasattr(query, 'values') and not isinstance(query, dict):
        query = query.values
    query = query or {}
    headers = headers or {}
    def one(name):
        value = query.get(name, '')
        return value[0] if isinstance(value, (list, tuple)) and value else value
    provider = _provider(provider or next((one(k) for k in ('platform', 'provider', 'pf', 'plat', 'p', 'source', 'src', 'app', 'site') if one(k)), ''))
    raw = headers.get('X-Music-Credentials') or one('credentials')
    result = normalize(raw)
    cookie = headers.get('X-Music-Cookie')
    if cookie is None:
        if 'cookie' in query:
            cookie = one('cookie')
        elif provider not in result:
            cookie = headers.get('Cookie')
    session = headers.get('X-Music-Session') or one('session_config')
    if provider in _PROVIDERS and (cookie is not None or session):
        item = dict(result.get(provider, {}))
        if cookie is not None:
            item['cookie'] = cookie
        if session:
            try:
                item['session_config'] = json.loads(session) if isinstance(session, str) else session
            except (ValueError, TypeError):
                raise ValueError('汽水会话 JSON 格式错误') from None
        result.pop(provider, None)
        result.update(normalize({provider: item}))
    return result


@contextmanager
def bind(value):
    token = _CURRENT.set(normalize(value))
    try:
        yield
    finally:
        _CURRENT.reset(token)


def current():
    return normalize(_CURRENT.get())


def cookie(provider, explicit=None):
    return _text(explicit) if explicit is not None else (_CURRENT.get() or {}).get(_provider(provider), {}).get('cookie', '')


def session_config():
    return current().get('qishui', {}).get('session_config')


def fingerprint(provider=None):
    value = (_CURRENT.get() or {}).get(_provider(provider), {}) if provider else (_CURRENT.get() or {})
    if not value:
        return ''
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=True, separators=(',', ':')).encode()).hexdigest()


def header_value():
    return json.dumps(current(), ensure_ascii=True, separators=(',', ':'))


def submit(executor, function, *args, **kwargs):
    """每个 worker 使用独立 Context 副本，避免线程池丢失或串用账号。"""
    return executor.submit(copy_context().run, function, *args, **kwargs)


def map_with_context(executor, function, items):
    futures = [submit(executor, function, item) for item in items]
    return [future.result() for future in futures]
