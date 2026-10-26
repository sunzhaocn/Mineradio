"""NetEase own-account read, not public user-profile metadata."""
from music_app.core import request_credentials
from music_app.core.session_health import Tracker

tracker = Tracker('netease')


def classify(result):
    if not isinstance(result, dict):
        return 'unknown'
    if result.get('code') in (301, '301'):
        return 'expired'
    if result.get('code') not in (200, '200'):
        return 'unknown'
    account, profile = result.get('account'), result.get('profile')
    uid = (account.get('id') if isinstance(account, dict) else None) or (profile.get('userId') if isinstance(profile, dict) else None)
    if str(uid or '').isdigit() and int(uid) > 0:
        return 'valid'
    if 'account' in result and 'profile' in result and account is None and profile is None:
        return 'expired'
    return 'unknown'


def probe():
    from . import transport
    cookie = request_credentials.cookie('netease')
    result = transport.ne_weapi_post('/weapi/w/nuser/account/get',
        {'csrf_token': transport.ne_cookie_fields(cookie)['csrf']}, cookie=cookie)
    return classify(result)


def check(force=False):
    return tracker.check(probe, force)


def cached():
    return tracker.cached()
