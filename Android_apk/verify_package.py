"""Audit the deliverable and collect existing test evidence without credentials."""
from pathlib import Path
from datetime import datetime, timezone
import hashlib
import json
import re
import zipfile

BASE = Path(__file__).resolve().parent
ROOT = BASE.parent
EVIDENCE = ROOT / 'runtime/android-build'
RELEASE = ROOT / '发布包/酷狗Cookie修复-20261024'
APK = RELEASE / 'Mineradio-1.0.2.apk'


def read(name):
    return json.loads((EVIDENCE / name).read_text(encoding='utf-8-sig'))


def main():
    apk_hash = hashlib.sha256(APK.read_bytes()).hexdigest()
    reference = ROOT / 'runtime/android-portability/com.luna.music-21.3.0'
    with zipfile.ZipFile(APK) as built, zipfile.ZipFile(reference / 'base.apk') as original:
        names = built.namelist()
        dex_count = sum(n.startswith('classes') and n.endswith('.dex') and '/' not in n for n in names)
        own = dex_count - 21
        same_dex = all(built.read(f'classes{own+i}.dex') == original.read('classes' + (str(i) if i > 1 else '') + '.dex') for i in range(1, 22))
        same_native = built.read('lib/arm64-v8a/libmetasec_ml.so') == (reference / 'native-analysis/libmetasec_ml.so').read_bytes()
        no_config = not any(n.startswith('assets/bundle/config/') for n in names)
        no_fixture = not any('fixture/encrypted-test' in n for n in names)
        web_snapshot = read('kugou-cookie-web-manifest.json')
        web_matches = all(hashlib.sha256(built.read('assets/bundle/web/' + name)).hexdigest() == digest
                          for name, digest in web_snapshot.items())
    assert same_dex and same_native and no_config and no_fixture and web_matches
    test_log = (EVIDENCE / 'kugou-cookie-python-recheck.log').read_text(encoding='utf-8-sig', errors='replace')
    run_count = int(re.search(r'Ran (\d+) tests', test_log).group(1))
    assert run_count == 728 and 'OK (skipped=5)' in test_log
    frontend = read('kugou-cookie-frontend.json')
    assert len(frontend) == 50 and all(test['ok'] for test in frontend)
    tablet, phone, playback = read('tablet-layout.json'), read('phone-startup.json'), read('background-downloaded.json')
    assert tablet['ok'] and not tablet['errors'] and tablet['backgroundDrawingDelta'] < 3
    assert phone['observed']['simple'] and phone['observed']['frames'] == 0 and not phone['errors']
    assert playback['ok'] and playback['background']['hidden'] and not playback['background']['paused']
    assert playback['background']['artwork'] and playback['systemPauseResume']
    installed = read('release-installed.json')
    assert installed['installedReleaseSha256'] == apk_hash and installed['installedApkMatches']
    assert installed['health']['ok'] and installed['sdk']['chartCount'] > 0 and not installed['debuggable']
    assert installed['qishuiSearch']['songCount'] > 0 and all(status == 404 for status in installed['debugRoutes'].values())
    updates, offline, providers = read('update-device.json'), read('offline-download.json'), read('provider-roundtrip.json')
    assert updates['ok'] and not updates['errors'] and all(a['loggedIn'] for a in updates['accounts'])
    assert offline['ok'] and offline['hasLyric'] and offline['coverSaved'] and offline['after']['nativeArtwork']
    assert providers['qq']['ok'] and providers['kugou']['ok'] and providers['qishui']['ok']
    assert providers['write']['ok'] and providers['write']['originalMembershipRestored']
    cookie, mv, web = read('kugou-cookie-reuse.json'), read('tablet-mv.json'), read('web-updates.json')
    assert cookie['ok'] and cookie['inputCleared'] and mv['ok'] and mv['decoded']
    assert web['ok'] and not web['errors'] and all(row['noOverlap'] for row in web['header'])
    windows_dir = ROOT / 'Windows_exe/verification'
    windows = json.loads((windows_dir / 'electron-acceptance.json').read_text(encoding='utf-8-sig'))
    windows_package = json.loads((windows_dir / 'installer-content-verification-2.2.2.json').read_text(encoding='utf-8-sig'))
    windows_offline = json.loads((windows_dir / 'offline-download.json').read_text(encoding='utf-8-sig'))
    windows_installed = read('windows-installed-cookie-fix.json')
    installer = RELEASE / 'Mineradio-2.2.2-Setup-x64.exe'
    assert windows['finished'] and not windows['errors'] and windows['checks']['backendExited']
    assert windows_offline['ok'] and windows_offline['accountsAbsent'] and not windows_offline['errors']
    assert windows_package['ok'] and windows_package['allEmbeddedFilesCrcVerified']
    assert windows_package['installerSha256'] == hashlib.sha256(installer.read_bytes()).hexdigest()
    assert windows_installed['exitCode'] == 0 and windows_installed['version'] == '2.2.2.0'
    assert windows_installed['userDataExistsAfter']
    installed_dir = Path(windows_installed['installedPath']).parent
    critical_files = ('Mineradio.exe', 'resources/app.asar', 'resources/backend/MineradioBackend.exe')
    installed_files_match = all(hashlib.sha256((installed_dir / name).read_bytes()).digest() ==
                                hashlib.sha256((ROOT / 'runtime/kugou-cookie-fix-frozen/win-unpacked' / name).read_bytes()).digest()
                                for name in critical_files)
    assert installed_files_match
    windows_installed['criticalFilesMatchTestedPayload'] = installed_files_match
    cookie_release, bytecode = read('kugou-cookie-release-profile.json'), read('kugou-cookie-bytecode.json')
    cookie_windows = json.loads((windows_dir / 'kugou-cookie.json').read_text(encoding='utf-8-sig'))
    assert cookie_release['ok'] and bytecode['ok'] and cookie_windows['ok']
    assert all(check['additionalLoginRequests'] == 0 and check['cookieUnchanged']
               for check in cookie_windows['checks'])
    previous = BASE / 'verification.json'
    if json.loads(previous.read_text(encoding='utf-8-sig')).get('version') == '1.0.1':
        (BASE / 'verification-1.0.1.json').write_bytes(previous.read_bytes())
    result = {
        'version': '1.0.2', 'applicationId': 'dev.mineradio.android',
        'apk': str(APK), 'bytes': APK.stat().st_size, 'sha256': apk_hash,
        'createdUtc': datetime.now(timezone.utc).isoformat(),
        'phoneAndTabletPlaybackEvidenceVersion': '1.0.1',
        'cookieFixEvidenceVersion': '1.0.2',
        'priorFullFeatureVerification': 'verification-1.0.1.json',
        'oneApkForPhoneAndTablet': True,
        'phone': phone, 'backgroundPlayback': playback, 'tablet': tablet,
        'mobileUpdates': updates, 'offlineDownload': offline, 'providerRoundtrip': providers,
        'kugouCookieReuse': cookie, 'tabletMv': mv, 'webUpdates': web,
        'kugouCookieSafety': {'androidRelease': cookie_release, 'packagedBytecode': bytecode,
                             'windowsUi': cookie_windows, 'realCookieCoexistenceTested': False},
        'displayRestored': read('display-restored.json')['restored'],
        'release': installed, 'pythonTests': {'run': run_count, 'skipped': 5, 'passed': True},
        'frontendTests': {'run': len(frontend), 'passed': True},
        'windows': {'version': '2.2.2', 'runtime': windows, 'package': windows_package,
                    'installed': windows_installed, 'offlineDownloadEvidenceVersion': '2.2.1',
                    'offlineDownload': windows_offline},
        'packageAudit': {'applicationDexCount': own, 'originalDexCount': 21,
            'originalDexUnchanged': same_dex, 'originalNativeUnchanged': same_native,
            'rootConfigExcluded': no_config, 'debugFixtureExcluded': no_fixture,
            'webSnapshotFilesMatch': web_matches, 'webSnapshotFileCount': len(web_snapshot),
            'webSnapshot': 'runtime/android-build/kugou-cookie-web-manifest.json'},
        'limits': [
            'Tablet form factor and GPU were tested on a real phone with temporary Android display overrides, not a physical tablet.',
            'Phone and tablet playback evidence is retained from 1.0.1. The 1.0.2 release is separately installed, hash-checked, cold-started, and tested for public search, charts, disabled debug routes and synthetic Cookie profile reads.',
            'The Cookie fix is verified with isolated credentials and packaged code inspection; real official-client session coexistence was not retested to avoid risking another account logout. An already revoked Cookie cannot be restored locally.',
            'Available provider-associated music videos and exact-title-and-artist cross-catalog candidates are supported; not every song or region has an accessible MV.',
            'Offline copies are stored in the application local music database; clearing application data also clears this database.',
            'Long duration screen-off playback and other vendor device policies are not certified by the short background test.',
        ],
    }
    (BASE / 'verification.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    (EVIDENCE / 'package-audit.json').write_text(json.dumps({**result['packageAudit'], 'sha256': apk_hash,
        'bytes': APK.stat().st_size}, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'ok': True, 'sha256': apk_hash, 'bytes': APK.stat().st_size, 'displayRestored': result['displayRestored']}, ensure_ascii=False))


if __name__ == '__main__':
    main()
