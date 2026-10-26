"""Build and launch the actual local application on an available iPad Simulator."""
import json
from pathlib import Path
import subprocess
import time

from native_build import linker_settings

PROJECT = Path(__file__).resolve().parent
DIST = PROJECT / 'dist'
APP_ID = 'dev.mineradio.mineradio'


def run(*args, timeout=240):
    return subprocess.run(args, cwd=PROJECT, check=True, text=True,
                          stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                          timeout=timeout).stdout


def main():
    DIST.mkdir(exist_ok=True)
    report = dict(deviceValidated=False, simulatorValidated=False, accountAuthorized=False)
    simulator = None
    try:
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
        devices = json.loads(run('xcrun', 'simctl', 'list', 'devices', 'available', '-j'))['devices']
        choices = [(runtime, device) for runtime, group in devices.items()
                   if 'iOS-26' in runtime for device in group if 'iPad' in device['name']]
        if not choices:
            raise RuntimeError('No iPadOS 26 simulator is installed on this runner')
        runtime, device = choices[0]
        simulator = device['udid']
        report.update(runtime=runtime, simulator=device['name'])
        if device['state'] != 'Booted':
            run('xcrun', 'simctl', 'boot', simulator)
        run('xcrun', 'simctl', 'bootstatus', simulator, '-b', timeout=180)
        run('xcrun', 'simctl', 'install', simulator, str(products / 'Mineradio.app'))
        run('xcrun', 'simctl', 'launch', simulator, APP_ID)
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
    main()
