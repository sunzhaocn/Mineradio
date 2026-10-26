"""Read-only smoke checks against the actual frozen Python service."""
from pathlib import Path
import json
import os
import subprocess
import socket
import time
import urllib.request

desktop = Path(__file__).resolve().parents[1]
executable = desktop / "build/backend/MineradioBackend/MineradioBackend.exe"
environment = os.environ.copy()
environment.update(PYTHONIOENCODING="utf-8", PYTHONUTF8="1",
                   MINERADIO_DATA_ROOT=str(desktop / "build/backend-smoke-data"),
                   MINERADIO_NODE_PATH=str(desktop / "build/tools/node.exe"),
                   MINERADIO_FFMPEG_PATH=str(desktop / "build/tools/ffmpeg.exe"))
environment.pop("MINERADIO_PARENT_PID", None)
sdk = desktop / "sdk"
if sdk.is_dir():
    environment["QISHUI_SDK_DIR"] = str(sdk)

self_test = subprocess.run([str(executable), "--bundle-self-test", "--browser-test"],
                           env=environment, capture_output=True, text=True,
                           encoding="utf-8", timeout=60,
                           creationflags=subprocess.CREATE_NO_WINDOW)
if self_test.returncode:
    raise RuntimeError(self_test.stderr or self_test.stdout)
checks = {"frozenSelfTest": json.loads(self_test.stdout)}


def free_ports():
    reservations = [socket.socket(), socket.socket()]
    try:
        for reservation in reservations:
            reservation.bind(("127.0.0.1", 0))
        return [reservation.getsockname()[1] for reservation in reservations]
    finally:
        for reservation in reservations:
            reservation.close()


api_port, web_port = free_ports()
log = desktop / "build/backend-smoke.log"
with log.open("w", encoding="utf-8") as output:
    process = subprocess.Popen([str(executable), "--api-port", str(api_port), "--web-port", str(web_port)],
                               env=environment, stdout=output, stderr=subprocess.STDOUT,
                               creationflags=subprocess.CREATE_NO_WINDOW)
    try:
        deadline = time.monotonic() + 30
        while True:
            if process.poll() is not None:
                raise RuntimeError("Frozen service exited before its own health check")
            try:
                with urllib.request.urlopen(f"http://127.0.0.1:{api_port}/health", timeout=2) as response:
                    checks["health"] = json.load(response)
                break
            except OSError:
                if process.poll() is not None or time.monotonic() >= deadline:
                    raise RuntimeError("Frozen service did not start; inspect " + str(log))
                time.sleep(0.2)
        for path, expected in (("/", b"Mineradio"),
                               ("/js/module-manifest.json", b"declarations"),
                               ("/api/local/auth/status", b"platforms")):
            with urllib.request.urlopen(f"http://127.0.0.1:{web_port}" + path, timeout=10) as response:
                body = response.read()
                if response.status != 200 or expected not in body:
                    raise RuntimeError("Unexpected response for " + path)
                checks[path] = {"status": response.status, "bytes": len(body)}
        with urllib.request.urlopen(f"http://127.0.0.1:{api_port}/platforms", timeout=10) as response:
            platforms = json.load(response)
            checks["platforms"] = [item["id"] for item in platforms["platforms"]]
        if len(checks["platforms"]) != 4:
            raise RuntimeError("One or more music providers are absent")
    finally:
        process.terminate()
        process.wait(timeout=15)
report = desktop / "build/backend-smoke.json"
parent = subprocess.Popen([str(Path(os.sys.executable)), "-c", "import time; time.sleep(60)"],
                          creationflags=subprocess.CREATE_NO_WINDOW)
watch_environment = environment | {"MINERADIO_PARENT_PID": str(parent.pid)}
watch_api, watch_web = free_ports()
with (desktop / "build/backend-parent-watch.log").open("w", encoding="utf-8") as output:
    watched = subprocess.Popen([str(executable), "--api-port", str(watch_api), "--web-port", str(watch_web)],
                               env=watch_environment, stdout=output, stderr=subprocess.STDOUT,
                               creationflags=subprocess.CREATE_NO_WINDOW)
    try:
        deadline = time.monotonic() + 20
        while True:
            if watched.poll() is not None:
                raise RuntimeError("Parent-watch test service exited before readiness")
            try:
                with urllib.request.urlopen(f"http://127.0.0.1:{watch_api}/health", timeout=2) as response:
                    if response.status == 200:
                        break
            except OSError:
                if watched.poll() is not None or time.monotonic() >= deadline:
                    raise RuntimeError("Parent-watch test service did not start")
                time.sleep(0.2)
        parent.terminate()
        parent.wait(timeout=5)
        checks["parentExitCleanup"] = watched.wait(timeout=10) == 0
        if not checks["parentExitCleanup"]:
            raise RuntimeError("Parent-watch service did not exit cleanly")
    finally:
        if parent.poll() is None:
            parent.terminate()
            parent.wait(timeout=5)
        if watched.poll() is None:
            watched.terminate()
            watched.wait(timeout=5)
report.write_text(json.dumps(checks, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps(checks, ensure_ascii=False, indent=2))
