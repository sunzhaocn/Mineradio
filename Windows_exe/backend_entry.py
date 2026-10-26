"""Frozen desktop entry point. The shared application sources stay unchanged."""
from __future__ import annotations

import ctypes
from ctypes import wintypes
import json
import os
from pathlib import Path
import shutil
import signal
import sys
import threading

sys.dont_write_bytecode = True
for stream in (sys.stdout, sys.stderr):
    if stream is not None and hasattr(stream, "reconfigure"):
        stream.reconfigure(encoding="utf-8", errors="replace")


def configure_runtime():
    bundle = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent.parent))
    data = Path(os.environ.get("MINERADIO_DATA_ROOT") or
                Path(os.environ.get("LOCALAPPDATA", Path.home())) / "Mineradio" / "data").resolve()
    import music_app.paths as paths
    paths.ROOT = data
    paths.CONFIG_DIR = data / "config"
    paths.RUNTIME_DIR = data / "runtime"
    paths.CACHE_DIR = paths.RUNTIME_DIR / "cache"
    paths.LOG_DIR = paths.RUNTIME_DIR / "logs"
    paths.WEB_ROOT = bundle / "web"
    paths.EXPORT_DIR = data / "汽水音乐解密结果"
    paths.ensure_directories()

    tools = []
    for name in ("MINERADIO_NODE_PATH", "MINERADIO_FFMPEG_PATH"):
        executable = os.environ.get(name)
        if executable and Path(executable).is_file():
            tools.append(str(Path(executable).resolve().parent))
    os.environ["PATH"] = os.pathsep.join(dict.fromkeys(tools + [os.environ.get("PATH", "")]))
    os.environ.setdefault("PYTHONIOENCODING", "utf-8")
    bundled_sdk = os.environ.get("MINERADIO_BUNDLED_SDK_DIR")
    if bundled_sdk and (Path(bundled_sdk) / "bdms.node").is_file():
        os.environ.setdefault("QISHUI_SDK_DIR", bundled_sdk)

    installed = [Path(r"C:\Program Files\Google\Chrome\Application\chrome.exe"),
                 Path(r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"),
                 Path(os.environ.get("LOCALAPPDATA", "")) / "Google/Chrome/Application/chrome.exe"]
    fallback = bundle / "browser" / "chrome-win64" / "chrome.exe"
    if not any(candidate.is_file() for candidate in installed) and fallback.is_file():
        os.environ.setdefault("NETEASE_BROWSER_PATH", str(fallback))
        os.environ.setdefault("QISHUI_BROWSER_PATH", str(fallback))
    import_existing_downloads(paths, os.environ.get("MINERADIO_IMPORT_DATA_ROOT"))
    return paths


def import_existing_downloads(paths, source):
    """Copy only explicitly listed audio; never import cookies or account files."""
    if not source:
        return
    source = Path(source).resolve()
    target = paths.CONFIG_DIR / "local-downloads.json"
    if source == paths.ROOT or target.exists():
        return
    try:
        manifest = json.loads((source / "config" / "local-downloads.json").read_text(encoding="utf-8-sig"))
        entries = manifest.get("files", []) if isinstance(manifest, dict) else []
        allowed = [(source / "汽水音乐解密结果").resolve(),
                   (source / "runtime" / "cache" / "qishui" / "audio").resolve()]
        copied = []
        for entry in entries:
            if not isinstance(entry, dict):
                continue
            relative = Path(entry.get("path") or "")
            if relative.is_absolute() or ".." in relative.parts:
                continue
            original = (source / relative).resolve()
            if (original.suffix.lower() not in (".flac", ".m4a") or not original.is_file()
                    or not any(original.is_relative_to(root) for root in allowed)):
                continue
            destination = (paths.ROOT / relative).resolve()
            if not destination.is_relative_to(paths.ROOT):
                continue
            destination.parent.mkdir(parents=True, exist_ok=True)
            if not destination.exists():
                shutil.copy2(original, destination)
            copied.append(entry)
        target.write_text(json.dumps({"files": copied}, ensure_ascii=False, indent=2), encoding="utf-8")
    except (OSError, ValueError, TypeError):
        # An unavailable optional old export never prevents the player opening.
        return


def watch_parent():
    """A crashed Electron process must not leave its service/browser tree behind."""
    raw = os.environ.get("MINERADIO_PARENT_PID", "")
    if os.name != "nt" or not raw.isdigit():
        return
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.OpenProcess.argtypes = (wintypes.DWORD, wintypes.BOOL, wintypes.DWORD)
    kernel.OpenProcess.restype = wintypes.HANDLE
    kernel.WaitForSingleObject.argtypes = (wintypes.HANDLE, wintypes.DWORD)
    kernel.WaitForSingleObject.restype = wintypes.DWORD
    kernel.CloseHandle.argtypes = (wintypes.HANDLE,)
    handle = kernel.OpenProcess(0x00100000, False, int(raw))
    if not handle:
        raise RuntimeError("桌面主进程已经退出，停止启动后台服务。")

    def monitor():
        try:
            if kernel.WaitForSingleObject(handle, 0xFFFFFFFF) == 0:
                try:
                    from music_app.auth.router import shutdown
                    shutdown()
                finally:
                    signal.raise_signal(signal.SIGTERM)
        finally:
            kernel.CloseHandle(handle)
    threading.Thread(target=monitor, name="desktop-parent-watch", daemon=True).start()


def bundle_self_test(browser_test=False):
    """Exercise lazy imports and native libraries without contacting music services."""
    import importlib
    from Crypto.Cipher import AES
    import qrcode
    import io
    modules = ["music_app.auth.kugou", "music_app.auth.netease.adapter",
               "music_app.auth.qqmusic.adapter", "music_app.auth.qishui.adapter",
               "qqmusic_api.core.transport", "playwright.sync_api", "paho.mqtt.client"]
    for platform in ("netease", "qqmusic", "kugou", "qishui"):
        modules.extend("music_app.providers." + platform + "." + name
                       for name in ("artist", "album", "comments", "library"))
    for module in modules:
        importlib.import_module(module)
    encrypted = AES.new(b"0" * 16, AES.MODE_ECB).encrypt(b"1" * 16)
    if AES.new(b"0" * 16, AES.MODE_ECB).decrypt(encrypted) != b"1" * 16:
        raise RuntimeError("AES round-trip failed")
    image = io.BytesIO()
    qrcode.make("https://example.invalid/mineradio-bundle-test").save(image, format="PNG")
    if not image.getvalue().startswith(b"\x89PNG"):
        raise RuntimeError("QR image generation failed")
    from music_app.api.status import health
    from music_app.paths import WEB_ROOT
    from music_app.web.templates import render_page
    page = render_page(WEB_ROOT / "player")
    if b"<!-- component:" in page:
        raise RuntimeError("HTML component expansion failed")
    result = {"ok": True, "importedModules": len(modules), "qr": True,
              "crypto": True, "pageBytes": len(page), "health": health()}
    if browser_test:
        from playwright.sync_api import sync_playwright
        bundle = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent.parent))
        browser = bundle / "browser" / "chrome-win64" / "chrome.exe"
        with sync_playwright() as playwright:
            with playwright.chromium.launch(executable_path=str(browser), headless=True) as chromium:
                tab = chromium.new_page()
                tab.set_content("<title>Mineradio bundle browser</title>")
                result["browser"] = tab.title() == "Mineradio bundle browser"
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    configure_runtime()
    if "--bundle-self-test" in sys.argv:
        raise SystemExit(bundle_self_test("--browser-test" in sys.argv))
    watch_parent()
    from music_app.launcher import main
    raise SystemExit(main())
