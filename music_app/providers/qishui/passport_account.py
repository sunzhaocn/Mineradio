"""Read the current client's Passport identity, independently of music signing.

This is a fixed, read-only HTTPS endpoint. It never creates a login browser,
refreshes tokens, imports another account, or calls the media signing SDK.
"""
import gzip
import io
import json
import re
import urllib.parse
import urllib.request

from music_app.auth.qishui.common import USER_AGENT
from music_app.core import request_credentials, request_lifecycle

HOST = 'https://api.qishui.com'
PATH = '/passport/account/info/v2/'
MAX_RESPONSE = 1024 * 1024
_UID = re.compile(r'[1-9][0-9]{0,24}')


def user(data):
    if not isinstance(data, dict):
        return {}
    return next((data[key] for key in ('my_info', 'user', 'user_info', 'account', 'me')
                 if isinstance(data.get(key), dict)), data)


def account_id(data):
    values = user(data)
    for key in ('id', 'user_id', 'uid'):
        value = values.get(key)
        if type(value) in (str, int) and _UID.fullmatch(str(value)):
            return str(value)
    return ''


def classify(result):
    if not isinstance(result, dict) or not isinstance(result.get('data'), dict):
        return 'unknown'
    data = result['data']
    root_error, data_error = result.get('error_code'), data.get('error_code')
    zeros = (None, 0, '0')
    if isinstance(root_error, bool) or isinstance(data_error, bool):
        return 'unknown'
    # This exact Passport response means that the supplied account session is
    # invalid. Captcha, bdticket challenges and all other rejections are unknown.
    if (result.get('message') == 'error' and root_error in zeros
            and data_error in (13, '13') and data.get('name') == 'account_info_error'):
        return 'expired'
    if result.get('message') != 'success' or root_error not in zeros or data_error not in zeros:
        return 'unknown'
    return 'valid' if account_id(data) else 'unknown'


def _query(session):
    supplied = session.get('query') or {}
    query = {'aid': '386088', 'app_name': 'luna_pc', 'account_sdk_source': 'web',
             'language': 'zh', 'device_platform': 'PC',
             'passport_jssdk_version': '2.4.13', 'passport_jssdk_type': 'normal',
             'is_from_ttaccountsdk': '1'}
    version = supplied.get('version_name') or supplied.get('version_code') or '3.7.0'
    if not re.fullmatch(r'[0-9.]{1,32}', str(version)):
        raise ValueError('汽水会话版本参数无效')
    query['version_code'] = str(version)
    device = supplied.get('device_id') or supplied.get('did')
    install = supplied.get('install_id') or supplied.get('iid')
    for names, value in ((('device_id', 'did'), device), (('install_id', 'iid'), install)):
        if value in (None, ''):
            continue
        if not re.fullmatch(r'[0-9]{1,32}', str(value)):
            raise ValueError('汽水会话设备参数无效')
        query.update((name, str(value)) for name in names)
    return query


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, message, headers, newurl):
        # An identity read has no login redirect exchange. In particular, do
        # not copy a Cookie header to a URL supplied by an upstream redirect.
        raise ValueError('汽水账号验证返回了非预期跳转，请稍后重试')


def read():
    """Return a raw bounded Passport envelope for this request's credentials."""
    request_lifecycle.check()
    cookie = request_credentials.cookie('qishui')
    if not cookie:
        raise ValueError('请先登录汽水音乐')
    session = request_credentials.session_config() or {}
    ua = (session.get('headers') or {}).get('user-agent') or USER_AGENT
    if (not isinstance(ua, str) or len(ua) > 1024 or not ua.isascii()
            or any(ord(char) < 32 or ord(char) == 127 for char in ua)):
        raise ValueError('汽水会话请求头无效')
    request = urllib.request.Request(HOST + PATH + '?' + urllib.parse.urlencode(_query(session)),
        headers={'Cookie': cookie, 'User-Agent': ua, 'Referer': 'https://www.qishui.com/',
                 'Accept': 'application/json'}, method='GET')
    opener = urllib.request.build_opener(_NoRedirect())
    with opener.open(request, timeout=12) as response:
        raw = response.read(MAX_RESPONSE + 1)
        if len(raw) > MAX_RESPONSE:
            raise ValueError('汽水账号验证响应过大')
        if (response.headers.get('Content-Encoding') or '').lower() == 'gzip':
            with gzip.GzipFile(fileobj=io.BytesIO(raw)) as stream:
                raw = stream.read(MAX_RESPONSE + 1)
            if len(raw) > MAX_RESPONSE:
                raise ValueError('汽水账号验证响应过大')
    result = json.loads(raw.decode('utf-8'))
    if not isinstance(result, dict):
        raise ValueError('汽水账号验证响应格式无效')
    request_lifecycle.check()
    return result


def verified_data():
    result = read()
    if classify(result) != 'valid':
        raise ValueError('汽水账号资料暂时无法验证，请稍后重试')
    return result['data']
