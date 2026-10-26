"""Use Python 3.12 to inspect the same-version code shipped inside the APK."""
from pathlib import Path
import io
import json
import marshal
import types
import zipfile

ROOT = Path(__file__).resolve().parents[2]
APK = ROOT / 'Android_apk/dist/Mineradio-1.0.2.apk'


def functions(code):
    found = {}
    for value in code.co_consts:
        if isinstance(value, types.CodeType):
            found[value.co_name] = value
            found.update(functions(value))
    return found


def main():
    with zipfile.ZipFile(APK) as apk:
        with zipfile.ZipFile(io.BytesIO(apk.read('assets/chaquopy/app.imy'))) as app:
            data = app.read('music_app/web/account_profiles.pyc')
    code = marshal.loads(data[16:])
    expected = compile((ROOT / 'music_app/web/account_profiles.py').read_text(encoding='utf-8-sig'), code.co_filename, 'exec')
    packaged, source = functions(code), functions(expected)
    matches = all(packaged[name].co_code == source[name].co_code and
                  packaged[name].co_names == source[name].co_names and
                  packaged[name].co_consts == source[name].co_consts
                  for name in ('_kugou', '_kugou_identity'))
    no_restore = '_kugou_restore' not in packaged
    no_network = not set(packaged['_kugou'].co_names).intersection(('urlopen', '_request', '_gateway', '_kugou_restore'))
    assert matches and no_restore and no_network
    result = {'ok': True, 'pythonVersion': '3.12', 'packagedCookieProfileMatchesSource': matches,
              'automaticRestoreRemoved': no_restore, 'cookieProfileDoesNotCallNetwork': no_network}
    (ROOT / 'runtime/android-build/kugou-cookie-bytecode.json').write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(result))


if __name__ == '__main__':
    main()
