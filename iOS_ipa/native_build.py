"""Compile the first-party iOS SDK bridge for device or Intel Simulator."""
from pathlib import Path
import platform
import shlex
import subprocess

PROJECT = Path(__file__).resolve().parent
SDK = PROJECT / 'native/vendor/VolMetaSecML'
FRAMEWORKS = ('Foundation', 'UIKit', 'Security', 'MessageUI', 'CoreTelephony',
              'SystemConfiguration', 'CoreMotion', 'JavaScriptCore', 'CoreLocation')


def linker_settings(sdk, architecture=None):
    architecture = architecture or ('arm64' if sdk == 'iphoneos' else platform.machine())
    if sdk == 'iphonesimulator' and architecture != 'x86_64':
        raise RuntimeError('VolMetaSecML includes Intel Simulator and arm64 device slices; use macos-15-intel for this build')
    source = PROJECT / 'native/QishuiSigner.m'
    library = SDK / 'libmetasec_ml.a'
    if not source.is_file() or not library.is_file():
        raise RuntimeError('Prepare the pinned iOS signing SDK and native bridge first')
    destination = PROJECT / 'build/native' / sdk / architecture
    destination.mkdir(parents=True, exist_ok=True)
    output = destination / 'QishuiSigner.o'
    sysroot = subprocess.check_output(['xcrun', '--sdk', sdk, '--show-sdk-path'], text=True).strip()
    target = architecture + '-apple-ios16.4' + ('-simulator' if sdk == 'iphonesimulator' else '')
    subprocess.run(['xcrun', '--sdk', sdk, 'clang', '-fobjc-arc', '-fblocks', '-target', target,
                    '-isysroot', sysroot, '-I', str(SDK), '-c', str(source), '-o', str(output)], check=True)
    flags = ['$(inherited)', '-ObjC', str(output), str(library), '-lc++', '-lz', '-lresolv.9']
    for framework in FRAMEWORKS:
        flags.extend(('-framework', framework))
    # Xcode tokenizes this build setting separately from the subprocess argv.
    value = ' '.join(token if token == '$(inherited)' else shlex.quote(token) for token in flags)
    return ['OTHER_LDFLAGS=' + value]
