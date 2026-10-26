"""Restore missing release assets in an identified running instance, without replacing any existing file."""
from pathlib import Path
import argparse
import json
import os
import shutil

root = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument("--target", type=Path, required=True)
args = parser.parse_args()
source = (root / "dist/win-unpacked").resolve(strict=True)
target = args.target.resolve(strict=True)
temporary = Path(os.environ["TEMP"]).resolve(strict=True)
if target.name != "Mineradio-Windows-2.2.0" or not target.is_relative_to(temporary):
    raise SystemExit("Target is not the identified old portable application directory")
copied = []
existing = 0
for original in source.rglob("*"):
    if not original.is_file():
        continue
    relative = original.relative_to(source)
    destination = (target / relative).resolve()
    if not destination.is_relative_to(target):
        raise ValueError("Destination escaped the application directory")
    if destination.exists():
        existing += 1
        continue
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(original, destination)
    copied.append(str(relative))
critical = ["resources/backend/_internal/_overlapped.pyd",
            "resources/backend/_internal/playwright/driver/node.exe",
            "resources/tools/node.exe", "resources/qishui-sdk/bdms.node"]
report = {"copiedMissingFiles": len(copied), "preservedExistingFiles": existing,
          "accountDataTouched": False, "source": str(source), "target": str(target),
          "restoredCriticalDependencies": {name: (target / name).is_file() for name in critical}}
(root / "verification/running-instance-repair.json").write_text(
    json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps(report, ensure_ascii=False))
