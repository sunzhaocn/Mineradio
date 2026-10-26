"""Optional read-only profile acceptance; credentials stay in memory and never in reports."""
from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from music_app.core import request_credentials
from music_app.core.cookies import parse_unified_cookies
from music_app.web import account_profiles


def main():
    values = {}
    records = parse_unified_cookies((ROOT / 'config/cookies.txt').read_text(encoding='utf-8-sig'))
    for provider in ('netease', 'qq', 'kugou'):
        if records.get(provider, {}).get('cookie'):
            values['qqmusic' if provider == 'qq' else provider] = {'cookie': records[provider]['cookie']}
    config = json.loads((ROOT / 'config/qishui_session.json').read_text(encoding='utf-8-sig'))
    cookie = config.get('headers', {}).get('cookie', '')
    if cookie:
        values['qishui'] = {'cookie': cookie, 'session_config': config}
    def check(provider):
        key = 'qqmusic' if provider == 'qq' else provider
        if key not in values:
            return {'provider': provider, 'skipped': 'no_test_cookie'}
        try:
            with request_credentials.bind({key: values[key]}):
                result = account_profiles.read(provider)
            return {'provider': provider, 'ok': True, 'hasName': bool(result['account'].get('name')),
                    'hasAvatar': bool(result['account'].get('avatar')), 'credentialsInReport': False}
        except Exception as error:
            return {'provider': provider, 'ok': False, 'errorType': type(error).__name__}
    with ThreadPoolExecutor(max_workers=4) as pool:
        report = list(pool.map(check, ('netease', 'qq', 'kugou', 'qishui')))
    output = ROOT / 'Windows_exe/verification/cookie-profile-live.json'
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(report, ensure_ascii=False))


if __name__ == '__main__':
    main()
