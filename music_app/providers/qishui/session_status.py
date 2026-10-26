"""Read passport identity without refreshing tokens or requiring media SDKs."""
import json
import urllib.parse
import urllib.request
from music_app.core import request_credentials
from music_app.core.session_health import Tracker

tracker = Tracker('qishui')


def classify(result):
    if not isinstance(result, dict) or not isinstance(result.get('data'), dict):
        return 'unknown'
    data = result['data']
    if result.get('message') == 'error' and str(data.get('error_code')) == '13' and data.get('name') == 'account_info_error':
        return 'expired'
    if result.get('message') != 'success':
        return 'unknown'
    user = next((data[key] for key in ('my_info', 'user', 'user_info', 'account', 'me') if isinstance(data.get(key), dict)), data)
    uid = user.get('id') or user.get('user_id') or user.get('uid')
    return 'valid' if str(uid or '').isdigit() and int(uid) > 0 else 'unknown'


def probe():
    from music_app.auth.qishui.common import USER_AGENT
    query = urllib.parse.urlencode({'aid': '386088', 'app_name': 'luna_pc', 'account_sdk_source': 'web', 'language': 'zh'})
    request = urllib.request.Request('https://api.qishui.com/passport/account/info/v2/?' + query,
        headers={'Cookie': request_credentials.cookie('qishui'), 'User-Agent': USER_AGENT, 'Referer': 'https://www.qishui.com/'})
    with urllib.request.urlopen(request, timeout=12) as response:
        result = json.loads(response.read(1024 * 1024))
    return classify(result)


def check(force=False):
    return tracker.check(probe, force)


def cached():
    return tracker.cached()
