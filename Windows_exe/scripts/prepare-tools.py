"""Stage local runtimes and the project's original artwork; never collect user data."""
from pathlib import Path
import hashlib
import json
import shutil
import subprocess

PROJECT = Path(__file__).resolve().parents[1]
REPOSITORY = PROJECT.parent


def main():
    assets = PROJECT / "assets"
    tools = PROJECT / "build" / "tools"
    assets.mkdir(parents=True, exist_ok=True)
    tools.mkdir(parents=True, exist_ok=True)
    for name in ("icon.ico", "icon.png"):
        if not (assets / name).is_file():
            data = subprocess.check_output(["git", "show", f"HEAD:build/{name}"], cwd=REPOSITORY)
            (assets / name).write_bytes(data)
    inventory = []
    for name in ("node.exe", "ffmpeg.exe"):
        located = shutil.which(name)
        if not located:
            raise SystemExit(f"构建机缺少 {name}")
        source = Path(located).resolve(strict=True)
        destination = tools / name
        shutil.copy2(source, destination)
        inventory.append({"name": name, "size": destination.stat().st_size,
                          "sha256": hashlib.file_digest(destination.open("rb"), "sha256").hexdigest()})
    node_license = Path(shutil.which("node.exe")).resolve().parent / "LICENSE"
    if not node_license.is_file():
        node_license = PROJECT / ".venv/Lib/site-packages/playwright/driver/LICENSE"
    if node_license.is_file():
        shutil.copy2(node_license, tools / "NODE-LICENSE.txt")
    ffmpeg = Path(shutil.which("ffmpeg.exe")).resolve()
    for parent in (ffmpeg.parent, ffmpeg.parent.parent):
        for filename in ("LICENSE", "LICENSE.txt", "LICENSE.md"):
            if (parent / filename).is_file():
                shutil.copy2(parent / filename, tools / "FFMPEG-LICENSE.txt")
    buildconf = subprocess.check_output([str(tools / "ffmpeg.exe"), "-version"], stderr=subprocess.STDOUT)
    (tools / "FFMPEG-VERSION.txt").write_bytes(buildconf)
    (tools / "runtime-manifest.json").write_text(json.dumps(inventory, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(inventory, ensure_ascii=False))


if __name__ == "__main__":
    main()
