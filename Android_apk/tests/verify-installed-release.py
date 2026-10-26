"""Read-only installed release checks; never extracts account credentials."""
from pathlib import Path
import hashlib
import argparse
import json
import re
import subprocess
import urllib.error
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'runtime/android-build'
ADB = Path.home() / 'AppData/Local/Android/Sdk/platform-tools/adb.exe'


def device(*args):
    return subprocess.check_output([str(ADB), '-s', '3B15BJ0011500000', *args],
                                   text=True, encoding='utf-8').strip()


def get(port, path):
    try:
        with urllib.request.urlopen(f'http://127.0.0.1:{port}{path}', timeout=55) as response:
            return response.status, json.load(response)
    except urllib.error.HTTPError as error:
        return error.code, {}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--version', default='1.0.2')
    args = parser.parse_args()
    assert re.fullmatch(r'\d+\.\d+\.\d+', args.version)
    apk = ROOT / f'Android_apk/dist/Mineradio-{args.version}.apk'
    local_hash = hashlib.sha256(apk.read_bytes()).hexdigest()
    installed = device('shell', 'pm', 'path', 'dev.mineradio.android').removeprefix('package:')
    assert re.fullmatch(r'/data/app/[^\s]+/base\.apk', installed)
    installed_hash = device('shell', 'sha256sum', installed).split()[0]
    package = device('shell', 'dumpsys', 'package', 'dev.mineradio.android')
    assert f'versionName={args.version}' in package
    debuggable = any('DEBUGGABLE' in line for line in package.splitlines() if 'flags=[' in line or 'pkgFlags=[' in line)
    health_status, health = get(52083, '/__health')
    chart_status, charts = get(52087, '/charts?platform=qishui')
    search_status, search = get(52087, '/search?platform=qishui&keyword=' + urllib.parse.quote('晴天') + '&size=2')
    debug_routes = {route: get(52083, route)[0] for route in ('/__android/codec-test', '/__android/qq-prepare')}
    size, density = device('shell', 'wm', 'size'), device('shell', 'wm', 'density')
    display = {'restored': 'Override' not in size + density, 'size': size.splitlines(), 'density': density.splitlines()}
    result = {
        'version': args.version, 'installedApkMatches': installed_hash == local_hash,
        'installedReleaseSha256': installed_hash, 'bytes': apk.stat().st_size,
        'debuggable': debuggable, 'health': {'httpStatus': health_status, 'ok': bool(health.get('ok'))},
        'sdk': {'httpStatus': chart_status, 'chartCount': len(charts.get('charts', []))},
        'qishuiSearch': {'httpStatus': search_status, 'songCount': len(search.get('songs', []))},
        'debugRoutes': debug_routes, 'displayRestored': display['restored'],
    }
    assert result['installedApkMatches'] and not debuggable and health_status == 200 and health.get('ok'), result
    assert chart_status == 200 and result['sdk']['chartCount'] > 0, result
    assert search_status == 200 and result['qishuiSearch']['songCount'] > 0, result
    assert all(status == 404 for status in debug_routes.values()) and display['restored'], result
    (OUT / 'release-installed.json').write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
    (OUT / 'display-restored.json').write_text(json.dumps(display, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(result))


if __name__ == '__main__':
    main()
