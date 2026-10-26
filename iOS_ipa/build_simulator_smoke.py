"""Build and launch the actual local application on an available iPad Simulator."""
import json
import math
import os
from pathlib import Path
import subprocess
import sys
import time

from native_build import linker_settings
from launch_screen import install_blank_launch_screen

PROJECT = Path(__file__).resolve().parent
DIST = PROJECT / 'dist'
APP_ID = 'dev.mineradio.mineradio'


def run(*args, timeout=240, env=None):
    return subprocess.run(args, cwd=PROJECT, check=True, text=True,
                          stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                          timeout=timeout, env=env).stdout


def select_simulator():
    devices = json.loads(run('xcrun', 'simctl', 'list', 'devices', 'available', '-j'))['devices']
    choices = [(runtime, device) for runtime, group in devices.items()
               if 'iOS-26' in runtime for device in group if 'iPad' in device['name']]
    if not choices:
        raise RuntimeError('No iPadOS 26 simulator is installed on this runner')
    runtime, device = choices[0]
    if device['state'] not in ('Booted', 'Booting'):
        run('xcrun', 'simctl', 'boot', device['udid'])
    return runtime, device


def main():
    DIST.mkdir(exist_ok=True)
    report = dict(deviceValidated=False, simulatorValidated=False, accountAuthorized=False)
    simulator = None
    try:
        print('Building the iPad Simulator application', flush=True)
        products = PROJECT / 'build/simulator-products'
        args = ['xcodebuild', '-project', str(PROJECT / 'build/mineradio/ios/xcode/Mineradio.xcodeproj'),
                '-scheme', 'Mineradio', '-configuration', 'Debug', '-sdk', 'iphonesimulator',
                '-destination', 'generic/platform=iOS Simulator', 'CODE_SIGNING_ALLOWED=NO',
                'TARGETED_DEVICE_FAMILY=1,2', 'ARCHS=x86_64', 'ONLY_ACTIVE_ARCH=NO',
                'CONFIGURATION_BUILD_DIR=' + str(products), *linker_settings('iphonesimulator', 'x86_64'), 'build']
        log = ''
        try:
            log = run(*args, timeout=600)
        except subprocess.CalledProcessError as error:
            log = error.stdout
            raise
        finally:
            (DIST / 'simulator-build.log').write_text(log, encoding='utf-8')
        runtime, device = select_simulator()
        simulator = device['udid']
        report.update(runtime=runtime, simulator=device['name'])
        print('Booting ' + device['name'] + ' on ' + runtime, flush=True)
        try:
            run('xcrun', 'simctl', 'bootstatus', simulator, '-b', timeout=420)
        except subprocess.TimeoutExpired as error:
            captured = error.stdout or b''
            if isinstance(captured, bytes):
                captured = captured.decode('utf-8', errors='replace')
            (DIST / 'simulator-boot.log').write_text(captured, encoding='utf-8')
            raise
        report['launchScreen'] = install_blank_launch_screen(products / 'Mineradio.app', 'iphonesimulator')
        run('xcrun', 'simctl', 'install', simulator, str(products / 'Mineradio.app'))
        print('Launching the installed local application', flush=True)
        launch_env = os.environ.copy()
        launch_env['SIMCTL_CHILD_MINERADIO_IOS_PHONE_SECURITY_CHECK'] = '1'
        launch_started = time.time()
        run('xcrun', 'simctl', 'launch', simulator, APP_ID, env=launch_env)
        data = Path(run('xcrun', 'simctl', 'get_app_container', simulator, APP_ID, 'data').strip())
        deadline = time.monotonic() + 150
        status = {}
        while time.monotonic() < deadline:
            for path in data.rglob('ios-player-modules.json'):
                try:
                    status = json.loads(path.read_text(encoding='utf-8'))
                except (OSError, ValueError):
                    continue
            if status.get('ready') or status.get('error'):
                break
            time.sleep(2)
        report['modules'] = status
        # The active layout monitor writes this shortly after its first native
        # round trip. Require real UIKit evidence instead of passing when no
        # diagnostic was produced (for example, after a bridge/ABI failure).
        presentation = None
        presentation_deadline = time.monotonic() + 3
        while presentation is None and time.monotonic() < presentation_deadline:
            for path in data.rglob('ios-presentation-diagnostic.json'):
                try:
                    if path.stat().st_mtime < launch_started:
                        continue
                    presentation = json.loads(path.read_text(encoding='utf-8'))
                except (OSError, ValueError):
                    continue
            if presentation is None:
                time.sleep(.2)
        if presentation is None:
            raise RuntimeError('The installed player did not report native window geometry')
        report['presentation'] = presentation
        if presentation.get('navigationBarPresent') is not False or presentation.get('title') != '':
            raise RuntimeError('The player still has a native navigation bar or app title')
        if presentation.get('contentTopOffset') != 0 or presentation.get('automaticWebInsets') != 2:
            raise RuntimeError('The native player still reserves an application title/status bar inset')
        if presentation.get('statusBarHiddenRequested') is not True:
            raise RuntimeError('The installed player did not request its full-screen status bar appearance')
        window, web = presentation.get('window', {}), presentation.get('webView', {})
        for dimension in ('width', 'height'):
            size, content_size = window.get(dimension), web.get(dimension)
            if (not isinstance(size, (int, float)) or not isinstance(content_size, (int, float))
                    or not math.isfinite(size) or not math.isfinite(content_size)
                    or size <= 0 or abs(size - content_size) > 1):
                raise RuntimeError('The native WebView does not fill the current window: ' + dimension)
        for dimension in ('x', 'y'):
            offset = web.get(dimension)
            if not isinstance(offset, (int, float)) or not math.isfinite(offset) or abs(offset) > 1:
                raise RuntimeError('The native WebView has an unexpected content offset: ' + dimension)
        print('Player readiness: ' + json.dumps(status), flush=True)
        phone_security = None
        phone_deadline = time.monotonic() + 90
        while phone_security is None and time.monotonic() < phone_deadline:
            for path in data.rglob('ios-phone-security-diagnostic.json'):
                try:
                    # Ignore results left by a previous launch of this same
                    # simulator. The check must exercise this installed build.
                    if path.stat().st_mtime < launch_started:
                        continue
                    phone_security = json.loads(path.read_text(encoding='utf-8'))
                    (DIST / 'simulator-ios-phone-security-diagnostic.json').write_bytes(path.read_bytes())
                except (OSError, ValueError):
                    continue
            if phone_security is None:
                time.sleep(.5)
        report['phoneSecurity'] = phone_security
        if not isinstance(phone_security, dict) or phone_security.get('ready') is not True:
            raise RuntimeError('The installed simulator did not pass the account-free phone security check')
        for pattern in ('*diagnostic*.json', '*failure*.txt', 'Mineradio-startup-diagnostic.txt'):
            for path in data.rglob(pattern):
                if path.is_file():
                    (DIST / ('simulator-' + path.name)).write_bytes(path.read_bytes())
        run('xcrun', 'simctl', 'io', simulator, 'screenshot', str(DIST / 'simulator-ipad.png'))
        if not status.get('ready') or status.get('error'):
            raise RuntimeError('The installed simulator app did not finish loading its player')
        if status.get('nativeBridge', {}).get('state') != 'received':
            raise RuntimeError('The installed app did not complete its native bridge round trip')
        if status.get('nativeMedia') is not True:
            raise RuntimeError('System audio controls were not installed')
        report['simulatorValidated'] = True
    except Exception as error:
        report.update(error=type(error).__name__, message=str(error)[:1000])
        raise
    finally:
        (DIST / 'simulator-result.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
        if simulator:
            subprocess.run(['xcrun', 'simctl', 'shutdown', simulator], capture_output=True, timeout=30)


if __name__ == '__main__':
    if '--warmup' in sys.argv:
        runtime, device = select_simulator()
        print('Simulator warming up: ' + device['name'] + ' on ' + runtime, flush=True)
    else:
        main()
