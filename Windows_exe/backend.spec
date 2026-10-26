# -*- mode: python ; coding: utf-8 -*-
"""Self-contained Python service with web assets and the login browser fallback."""
from pathlib import Path
import os
import sys
from PyInstaller.utils.hooks import collect_all, collect_submodules, copy_metadata

project = Path(SPECPATH).resolve()
source = project.parent
sys.path.insert(0, str(source))
web_source = Path(os.environ.get("MINERADIO_BUILD_WEB_SNAPSHOT") or source / "web").resolve(strict=True)
datas = [(str(web_source), "web"),
         (str(source / "third_party"), "third_party")]
binaries = []
hiddenimports = collect_submodules("music_app")
for package in ("qqmusic_api", "playwright", "Crypto", "qrcode", "paho.mqtt"):
    package_data, package_binaries, package_imports = collect_all(
        package, include_py_files=False,
        filter_submodules=lambda name: not any(part in ("tests", "SelfTest") for part in name.split(".")),
        exclude_datas=["**/tests/**", "**/SelfTest/**"])
    datas.extend(package_data)
    binaries.extend(package_binaries)
    hiddenimports.extend(package_imports)
datas.append((str(source / "music_app" / "providers" / "qishui" / "runtime" / "signer.cjs"),
              "music_app/providers/qishui/runtime"))
datas.extend(copy_metadata("qqmusic-api-python", recursive=True))

browser = os.environ.get("MINERADIO_BUILD_BROWSER")
if browser:
    browser = Path(browser).resolve()
    if not (browser / "chrome.exe").is_file():
        raise SystemExit("Chromium browser directory is incomplete")
    datas.append((str(browser), "browser/chrome-win64"))

a = Analysis([str(project / "backend_entry.py")], pathex=[str(source)],
             binaries=binaries, datas=datas, hiddenimports=hiddenimports,
             hookspath=[], hooksconfig={}, runtime_hooks=[],
             excludes=["tkinter", "pytest", "unittest", "IPython", "cv2", "numpy"],
             noarchive=False, optimize=1)
pyz = PYZ(a.pure)
exe = EXE(pyz, a.scripts, [], exclude_binaries=True,
          name="MineradioBackend", debug=False, bootloader_ignore_signals=False,
          strip=False, upx=False, console=True, disable_windowed_traceback=False,
          argv_emulation=False, target_arch=None, codesign_identity=None,
          entitlements_file=None)
coll = COLLECT(exe, a.binaries, a.datas, strip=False, upx=False, name="MineradioBackend")
