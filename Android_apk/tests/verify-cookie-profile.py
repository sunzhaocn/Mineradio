"""Read-only checks through the authorised ADB forward using fake Cookies."""
from pathlib import Path
import json
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[2]


def read_profile(cookie):
    request = urllib.request.Request('http://127.0.0.1:52083/api/local/profile?provider=kugou', headers={
        'Host': '127.0.0.1:18080',
        'X-Music-Credentials': json.dumps({'kugou': {'cookie': cookie}})})
    try:
        response = urllib.request.urlopen(request, timeout=10)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        return response.status, json.load(response), response.headers.get('Set-Cookie')


def main():
    cookie = ('userid=42; token=synthetic-client; t=synthetic-web; kg_mid=existing-mid; '
              'KuGoo=KugooID%3D42%26t%3Dsynthetic-web%26NickName%3DSynthetic%26Pic%3D'
              'https%253A%252F%252Fimge.kugou.com%252Favatar.jpg')
    checks = []
    for _ in range(3):
        status, data, replacement = read_profile(cookie)
        assert status == 200 and data.get('account', {}).get('name') == 'Synthetic'
        assert not replacement and not any(key in data for key in ('cookie', 'credentials'))
        checks.append({'status': status, 'name': 'Synthetic', 'credentialsReturned': False})
    status, data, replacement = read_profile('userid=42; token=synthetic-client; kg_mid=existing-mid')
    assert status == 502 and data.get('error') == 'account_profile_unavailable' and not replacement
    result = {'ok': True, 'syntheticCredentialsOnly': True, 'realAccountStorageTouched': False,
              'checks': checks, 'minimalCookieOptionalProfileUnavailable': status == 502}
    (ROOT / 'runtime/android-build/kugou-cookie-release-profile.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(json.dumps(result))


if __name__ == '__main__':
    main()
