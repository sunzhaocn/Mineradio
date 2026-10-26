"""Launch the built app in a real iOS Simulator and collect startup evidence."""
import json
from pathlib import Path
import plistlib
import subprocess
import time
import os
import re
import signal
import shutil
from native_build import linker_settings

PROJECT = Path(__file__).resolve().parent


def run(*args, capture=False, timeout=180):
    print('iOS smoke command:', args[0], args[1:4], flush=True)
    return subprocess.run(args, cwd=PROJECT, check=True, text=True,
        stdout=subprocess.PIPE if capture else None, timeout=timeout).stdout


def integration_check_errors(probe):
    """A signature alone is insufficient evidence of usable music requests."""
    checks = {
        'native_media': probe.get('media', {}).get('passed') is True,
        'qishui_qr': probe.get('passport', {}).get('qrCreated') is True,
        'qishui_signature': probe.get('signer', {}).get('signed') is True,
    }
    for provider in ('netease', 'qq', 'kugou'):
        checks[provider + '_official_page'] = probe.get('officialLogin', {}).get(provider, {}).get('pageLoaded') is True
    for operation in ('charts', 'search'):
        checks['qishui_' + operation] = probe.get('guestAPI', {}).get(operation, {}).get('accepted') is True
    return [name for name, passed in checks.items() if not passed]


def main():
    help_result = subprocess.run(['xcrun','simctl','help','launch'], cwd=PROJECT,
        capture_output=True, text=True, check=True, timeout=30)
    launch_help = help_result.stdout + help_result.stderr
    if not all(flag in launch_help for flag in ('--stdout', '--stderr')):
        raise RuntimeError('Installed simctl does not support persistent app log files')
    devices = json.loads(run('xcrun', 'simctl', 'list', 'devices', 'available', '--json', capture=True))['devices']
    requested_os = os.environ.get('MINERADIO_IOS_SIMULATOR_OS', '26')
    ordered = sorted(devices.items(), reverse=True)
    candidates = [dict(device, runtime=runtime) for runtime, rows in ordered
                  if '.iOS-'+requested_os in runtime for device in rows if 'iPad' in device['name']]
    if not candidates:
        raise RuntimeError('No available iPadOS ' + requested_os + ' simulator')
    device = candidates[0]
    udid = device['udid']
    if device['state'] != 'Booted':
        run('xcrun', 'simctl', 'boot', udid)
    run('xcrun', 'simctl', 'bootstatus', udid, '-b', timeout=600)
    products = PROJECT / 'build/simulator-products'
    run('xcodebuild', '-project', str(PROJECT / 'build/mineradio/ios/xcode/Mineradio.xcodeproj'),
        '-scheme', 'Mineradio', '-configuration', 'Debug', '-sdk', 'iphonesimulator',
        '-destination', 'id=' + udid, 'CODE_SIGNING_ALLOWED=YES', 'CODE_SIGN_IDENTITY=-',
        'EXPANDED_CODE_SIGN_IDENTITY=-', 'EXPANDED_CODE_SIGN_IDENTITY_NAME=ad-hoc',
        'CONFIGURATION_BUILD_DIR=' + str(products), *linker_settings('iphonesimulator'), 'build', timeout=900)
    app = products / 'Mineradio.app'
    run('codesign', '--verify', '--deep', '--strict', str(app), timeout=60)
    info = plistlib.loads((app / 'Info.plist').read_bytes())
    run('xcrun', 'simctl', 'install', udid, str(app))
    dist = PROJECT / 'dist'
    dist.mkdir(exist_ok=True)
    log = dist / 'simulator-startup.log'
    container = Path(run('xcrun', 'simctl', 'get_app_container', udid,
                         info['CFBundleIdentifier'], 'data', capture=True, timeout=30).strip())
    owned_pid = None
    app_exited = False
    launched_at = time.time()
    ready, loaded, modules, qishui = False, False, {}, {}
    log_process = None
    debugger = None
    with log.open('w', encoding='utf-8') as output, (dist / 'simulator-process-events.log').open('w', encoding='utf-8') as events, (dist / 'simulator-native-backtrace.log').open('w', encoding='utf-8') as debugger_output:
        launch = subprocess.run(['xcrun', 'simctl', 'launch',
            '--stdout=' + str((dist / 'simulator-native-stdout.log').resolve()),
            '--stderr=' + str((dist / 'simulator-native-stderr.log').resolve()),
            '--terminate-running-process', udid, info['CFBundleIdentifier']],
            cwd=PROJECT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=60, check=True,
            env=dict(os.environ, SIMCTL_CHILD_MINERADIO_IOS_DIAGNOSTIC='1',
                     SIMCTL_CHILD_PYTHONUNBUFFERED='1',
                     SIMCTL_CHILD_MINERADIO_IOS_SIGNER_PROBE='1',
                     SIMCTL_CHILD_MINERADIO_IOS_SIGNER_WORKER_INIT='1'))
        output.write(launch.stdout)
        match = re.search(r':\s*(\d+)\s*$', launch.stdout)
        if match:
            candidate = int(match.group(1))
            command = subprocess.run(['ps','-p',str(candidate),'-o','command='],
                                     capture_output=True, text=True, timeout=10).stdout
            if udid in command and '/Mineradio.app/Mineradio' in command:
                owned_pid = candidate
        try:
            # Observe only this disposable simulator's app and lifecycle events.
            # Capture the termination reason without attaching a debugger or
            # modifying the SDK, runtime checks, or licensing behavior.
            log_process = subprocess.Popen(['xcrun','simctl','spawn',udid,'log','stream',
                '--style','compact','--level','debug','--predicate',
                'process == "Mineradio" OR eventMessage CONTAINS "' + info['CFBundleIdentifier'] + '"'],
                stdout=events, stderr=subprocess.STDOUT, text=True)
            if owned_pid:
                # Observe the original fatal signal and retain a native stack.
                # Pass it through unchanged; never patch the SDK or its checks.
                debugger = subprocess.Popen(['xcrun','lldb','--batch','-p',str(owned_pid),
                    '-o','process handle --pass true --stop true --notify true SIGSEGV SIGABRT SIGBUS',
                    '-o','continue','-o','thread backtrace all','-o','image list -o -f','-o','process detach'],
                    stdout=debugger_output, stderr=subprocess.STDOUT, text=True)
            for elapsed in range(540):
                try:
                    current = next(container.rglob('qishui-native-diagnostic.json'), None)
                    probe = json.loads(current.read_text(encoding='utf-8')) if current else {}
                    if probe.get('complete') is True:
                        break
                    if elapsed >= 240 and not current:
                        break
                except (OSError, ValueError):
                    pass
                if owned_pid:
                    try:
                        os.kill(owned_pid, 0)
                    except ProcessLookupError:
                        app_exited = True
                        break
                time.sleep(1)
            time.sleep(20 if app_exited else 5)
            # Copy app-written evidence before any optional host tooling, which
            # can itself stall while attaching to an unresponsive process.
            for filename in ('qishui-native-diagnostic.json','qishui-signer-stage.json',
                             'system-media-diagnostic.json','media-diagnostic-progress.json',
                             'media-prepare-progress.json','startup-failure.txt',
                             'ios-player-modules.json','ios-bridge-ready.json','ios-bridge-failure.txt',
                             'python-native-threads.txt','qishui-native-stderr.log'):
                for record in container.rglob(filename):
                    (dist / ('simulator-' + filename)).write_bytes(record.read_bytes())
            for record in container.rglob('media-native-*'):
                if record.is_file() and record.stat().st_size <= 4*1024*1024:
                    (dist / ('simulator-' + record.name)).write_bytes(record.read_bytes())
            reports = [Path.home() / 'Library/Logs/DiagnosticReports',
                       Path.home() / 'Library/Developer/CoreSimulator/Devices' / udid / 'data/Library/Logs']
            for root in reports:
                for record in root.rglob('Mineradio*.ips'):
                    if record.stat().st_mtime >= launched_at and record.stat().st_size < 4*1024*1024:
                        shutil.copy2(record, dist / ('simulator-crash-' + record.name))
            try:
                run('xcrun', 'simctl', 'io', udid, 'screenshot', str(dist / 'simulator-ipad.png'), timeout=20)
            except subprocess.SubprocessError:
                pass
            for diagnostic in container.rglob('qishui-signer-stage.json'):
                (dist / 'simulator-sdk-stages.json').write_bytes(diagnostic.read_bytes())
            for failure in container.rglob('startup-failure.txt'):
                (dist / 'simulator-failure.txt').write_bytes(failure.read_bytes())
                print(failure.read_text(encoding='utf-8'))
            for name in ('ios-bridge-failure.txt', 'ios-native-message.json', 'system-media-diagnostic.json', 'media-diagnostic-progress.json', 'media-prepare-progress.json'):
                for diagnostic in container.rglob(name):
                    (dist / ('simulator-' + name)).write_bytes(diagnostic.read_bytes())
                    print(diagnostic.read_text(encoding='utf-8'))
            qishui = {}
            for diagnostic in container.rglob('qishui-native-diagnostic.json'):
                qishui = json.loads(diagnostic.read_text(encoding='utf-8'))
                (dist / 'simulator-qishui-diagnostic.json').write_text(json.dumps(qishui, indent=2), encoding='utf-8')
                print(json.dumps(qishui))
            ready = bool(list(container.rglob('ios-bridge-ready.json')))
            loaded = bool(list(container.rglob('ios-web-loaded.json')))
            modules = {}
            for record in container.rglob('ios-player-modules.json'):
                modules = json.loads(record.read_text(encoding='utf-8'))
        finally:
            if debugger is not None and debugger.poll() is None:
                debugger.terminate()
                try:
                    debugger.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    debugger.kill()
                    debugger.wait(timeout=5)
            if log_process is not None:
                log_process.terminate()
                try:
                    log_process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    log_process.kill()
                    log_process.wait(timeout=5)
            # The CI host is disposable. Avoid CoreSimulator termination hooks
            # after testing a blocked SDK; kill only our checked launch PID.
            if owned_pid:
                try:
                    os.kill(owned_pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
    text = log.read_text(encoding='utf-8', errors='replace')
    config = json.loads((PROJECT / 'src/mineradio/bundle/sdk-config.json').read_text(encoding='utf-8'))
    text = text.replace(config['license'], '[SDK_APP_LICENSE]')
    log.write_text(text, encoding='utf-8')
    for record in dist.glob('simulator-*'):
        if record.suffix in ('.log', '.ips'):
            value = record.read_text(encoding='utf-8', errors='replace').replace(config['license'], '[SDK_APP_LICENSE]')
            record.write_text(value, encoding='utf-8')
    result = dict(simulator=device['name'], runtime=device['runtime'], appExited=app_exited,
                  launchedAt=launched_at, capturedAt=time.time(), nativeBridgeReady=ready,
                  webResourcesLoaded=loaded, playerModules=modules, qishui=qishui, physicalDeviceValidated=False)
    result['integrationCheckErrors'] = integration_check_errors(qishui)
    (dist / 'simulator-result.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(json.dumps(result))
    if not ready or not loaded or modules.get('ready') is not True or 'Mineradio iOS startup failed:' in text:
        raise RuntimeError('Simulator startup did not reach the local WebKit/native bridge; inspect screenshot and log')
    if result['integrationCheckErrors']:
        raise RuntimeError('Qishui integration checks are incomplete; inspect the native diagnostic artifact')


if __name__ == '__main__':
    main()
