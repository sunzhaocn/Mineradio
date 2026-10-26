"""Read private likes; successful contents outrank an optional login_uin field."""
import json
import urllib.parse
from music_app.core import request_credentials
from music_app.core.session_health import Tracker

tracker = Tracker('qq')


def classify(result):
    if not isinstance(result, dict) or result.get('code') not in (0, '0'):
        return 'unknown'
    block = result.get('req_0')
    data = block.get('data') if isinstance(block, dict) else None
    if not isinstance(data, dict):
        return 'unknown'
    uid = str(data.get('login_uin', ''))
    success = all(v in (None, 0, '0') for v in (block.get('code'), data.get('code'), data.get('subcode')))
    if success:
        # Real authorized responses can contain login_uin=0 while returning
        # the owner's complete private collection. This endpoint uses no
        # supplied target account/list ID, so its successful private contents
        # are authentication evidence, including an explicitly empty list.
        total = str(data.get('total_song_num', ''))
        if (isinstance(data.get('songlist'), list) and isinstance(data.get('dirinfo'), dict)
                and total.isdigit()):
            return 'valid'
        if uid.isdigit() and int(uid) > 0:
            return 'valid'
    # Verified with a credential-free control. Zero identity alone, generic
    # failures and connectivity errors must never mark a usable account expired.
    if (uid == '0' and block.get('code') in (10004, '10004')
            and data.get('code') in (-100008, '-100008') and data.get('subcode') in (None, 0, '0')):
        return 'expired'
    return 'unknown'


def probe():
    from . import transport
    cookie = request_credentials.cookie('qqmusic')
    fields = transport.qq_cookie_fields(cookie)
    payload = {'comm': {'ct': 24, 'cv': 0}, 'req_0': {
        'module': 'music.srfDissInfo.DissInfo', 'method': 'CgiGetDiss', 'param': {
            'disstid': 0, 'dirid': 201, 'tag': 1, 'song_begin': 0, 'song_num': 1,
            'userinfo': 1, 'orderlist': 1}}}
    try:
        result = transport.qq_musicu(payload, cookie=cookie, timeout=10, retries=0)
    except OSError:
        # Same first-party read on QQ's alternate service host; never autologin.
        url = 'https://u6.y.qq.com/cgi-bin/musicu.fcg?format=json&data=' + urllib.parse.quote(json.dumps(payload, separators=(',', ':')))
        url += '&g_tk=' + str(transport.qq_hash33(fields['key']) if fields['key'] else 5381)
        result = transport.qq_http_json(url, transport.qq_headers(cookie), timeout=10)
    return classify(result)


def check(force=False):
    return tracker.check(probe, force)


def cached():
    return tracker.cached()
