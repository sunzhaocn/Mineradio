"""Copy the smallest local Qishui signing runtime and verify it in isolation.

No account data is read. The only signing input is a public read-only URL and
a synthetic device identifier. Actual signatures are never logged or saved.
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import shutil
import struct
import subprocess
import sys
import tempfile
import time

PROJECT = Path(__file__).resolve().parents[2]
WINDOWS = PROJECT / "Windows_exe"


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def pe_imports(path: Path) -> dict:
    """Read PE import and delay-import DLL names; no image execution."""
    blob = path.read_bytes()
    pe = struct.unpack_from("<I", blob, 0x3C)[0]
    if blob[:2] != b"MZ" or blob[pe:pe + 4] != b"PE\0\0":
        raise ValueError("Not a PE image")
    machine, sections = struct.unpack_from("<HH", blob, pe + 4)
    optional_size = struct.unpack_from("<H", blob, pe + 20)[0]
    optional = pe + 24
    magic = struct.unpack_from("<H", blob, optional)[0]
    directory = optional + (112 if magic == 0x20B else 96)
    section_table = optional + optional_size
    mappings = []
    for index in range(sections):
        at = section_table + 40 * index
        virtual_size, virtual_address, raw_size, raw_at = struct.unpack_from("<IIII", blob, at + 8)
        mappings.append((virtual_address, max(virtual_size, raw_size), raw_at))

    def offset(rva: int) -> int:
        for base, size, raw in mappings:
            if base <= rva < base + size:
                return raw + rva - base
        if rva < section_table:
            return rva
        raise ValueError("PE RVA out of bounds")

    def string(rva: int) -> str:
        at = offset(rva)
        return blob[at:blob.index(b"\0", at)].decode("ascii")

    imports = []
    import_rva = struct.unpack_from("<I", blob, directory + 8)[0]
    if import_rva:
        at = offset(import_rva)
        while blob[at:at + 20] != bytes(20):
            imports.append(string(struct.unpack_from("<I", blob, at + 12)[0]))
            at += 20
    delayed = []
    delay_rva = struct.unpack_from("<I", blob, directory + 8 * 13)[0]
    if delay_rva:
        at = offset(delay_rva)
        while blob[at:at + 32] != bytes(32):
            attributes, name = struct.unpack_from("<II", blob, at)
            if not attributes & 1:
                raise ValueError("Unsupported VA delay import table")
            delayed.append(string(name))
            at += 32
    return {"machine": "x64" if machine == 0x8664 else hex(machine),
            "imports": imports, "delay_imports": delayed}


PROBE = r"""
const path = require('node:path');
const fs = require('node:fs');
const config = JSON.parse(fs.readFileSync(0, 'utf8'));
const sdk = require(path.join(config.sdkDirectory, 'bdms.node'));
sdk.init({ deviceId: '1234567890123456789' });
let attempts = 0;
function verify() {
  const output = sdk.generateHttpSignatureHeaders(
    'https://api.qishui.com/luna/pc/search/track?aid=386088&device_id=1234567890123456789&keyword=test&count=1',
    'user-agent\r\nMineradio-Packaging-Verification\r\n');
  if (!output && ++attempts < 30) return setTimeout(verify, 100);
  const lines = String(output || '').split(/\r?\n/);
  const values = Object.fromEntries(Array.from({ length: Math.floor(lines.length / 2) },
    (_, i) => [lines[2*i], lines[2*i+1]]));
  const checks = { 'X-Helios': !!values['X-Helios'], 'X-Medusa': !!values['X-Medusa'] };
  const lengths = Object.fromEntries(Object.keys(checks).map(key => [key, String(values[key] || '').length]));
  console.log('MINERADIO_SDK_CHECK:' + JSON.stringify({ checks, lengths, all_nonempty: Object.values(checks).every(Boolean), pid: process.pid }));
  setTimeout(() => process.exit(Object.values(checks).every(Boolean) ? 0 : 2), 15000);
}
verify();
"""


def isolated_probe(directory: Path, node_source: Path) -> dict:
    with tempfile.TemporaryDirectory(prefix="sdk-verification-", dir=directory) as tmp:
        sandbox = Path(tmp)
        executable = sandbox / "node.exe"
        shutil.copy2(node_source, executable)
        script = sandbox / "verify.cjs"
        script.write_text(PROBE, encoding="utf-8")
        environment = {key: value for key, value in os.environ.items()
                       if key.upper() not in {"PATH", "NODE_PATH", "NODE_OPTIONS", "QISHUI_SDK_DIR", "MINERADIO_BUNDLED_SDK_DIR"}}
        system = Path(os.environ.get("SystemRoot", r"C:\Windows"))
        environment["PATH"] = os.pathsep.join(map(str, (directory, sandbox, system / "System32", system)))
        process = subprocess.Popen([str(executable), str(script)], stdin=subprocess.PIPE,
                                   stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                   cwd=sandbox, env=environment, text=True, encoding="utf-8",
                                   creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        try:
            process.stdin.write(json.dumps({"sdkDirectory": str(directory)}))
            process.stdin.close()
            probe = None
            for line in process.stdout:
                if line.startswith("MINERADIO_SDK_CHECK:"):
                    probe = json.loads(line.partition(":")[2])
                    break
            if not probe or not probe["all_nonempty"]:
                raise RuntimeError("Copied SDK did not produce both signatures")
            powershell = system / "System32/WindowsPowerShell/v1.0/powershell.exe"
            command = ("[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); "
                       f"(Get-Process -Id {process.pid}).Modules | ForEach-Object {{ $_.FileName }} | ConvertTo-Json -Compress")
            result = subprocess.run([str(powershell), "-NoProfile", "-NonInteractive", "-Command", command],
                                    capture_output=True, text=True, encoding="utf-8", timeout=10,
                                    creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
            if result.returncode:
                raise RuntimeError("Could not inspect verification process modules")
            modules = json.loads(result.stdout)
            if isinstance(modules, str):
                modules = [modules]
            foreign = []
            copied_modules = []
            system_root = str(system.resolve()).lower() + os.sep
            copy_root = str(directory.resolve()).lower() + os.sep
            for module in modules:
                absolute = str(Path(module).resolve())
                if absolute.lower().startswith(copy_root):
                    copied_modules.append(str(Path(absolute).relative_to(directory)))
                elif not absolute.lower().startswith(system_root):
                    foreign.append(absolute)
            if foreign:
                raise RuntimeError("Verification loaded non-system modules outside the copied SDK: " + ", ".join(foreign))
            for required in ("bdms.node", "metasecml.dll"):
                if required.lower() not in {Path(value).name.lower() for value in copied_modules}:
                    raise RuntimeError("Required SDK module was not observed: " + required)
            return {"passed": True, "two_signatures_nonempty": probe["all_nonempty"],
                    "signature_values_saved": False, "music_api_request_sent": False,
                    "signature_lengths": probe["lengths"],
                    "device_identifier": "synthetic", "node_version": subprocess.check_output(
                        [str(executable), "--version"], env=environment, text=True).strip(),
                    "node_sha256": sha256(executable), "copied_sdk_modules":
                        [value for value in copied_modules if not value.startswith("sdk-verification-")],
                    "module_count": len(modules), "external_non_system_modules": foreign,
                    "original_client_path_in_search_path": False,
                    "limitation": "Validates SDK loading/signing only, not account entitlement or live music requests."}
        finally:
            process.kill()
            process.wait(timeout=10)
            process.stdout.close()
            process.stderr.close()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path)
    parser.add_argument("--node", type=Path, default=Path(shutil.which("node") or "node.exe"))
    parser.add_argument("--output", type=Path, default=WINDOWS / "sdk")
    args = parser.parse_args()
    destination = args.output.resolve()
    if not destination.is_relative_to(WINDOWS.resolve()):
        raise ValueError("SDK output must remain inside Windows_exe")
    existing_manifest = destination / "manifest.json"
    if args.source is None and existing_manifest.is_file():
        manifest = json.loads(existing_manifest.read_text(encoding="utf-8"))
        for item in manifest["files"]:
            path = destination / item["name"]
            if path.parent != destination or not path.is_file() or sha256(path) != item["sha256"]:
                raise RuntimeError("Existing bundled SDK failed SHA-256 verification: " + item["name"])
        manifest["independent_validation"] = isolated_probe(destination, args.node.resolve())
        existing_manifest.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(json.dumps({"output": str(destination), "reused": True, "isolated_signing_passed": True}, ensure_ascii=False))
        return
    source = args.source
    if source is None:
        base = Path(os.environ["LOCALAPPDATA"]) / "Programs/Soda Music"
        versions = sorted((path for path in base.iterdir() if (path / "resources/app.asar.unpacked/bdms.node").is_file()),
                          key=lambda value: tuple(int(part) for part in value.name.split(".") if part.isdigit()), reverse=True)
        if not versions:
            raise RuntimeError("No installed Soda Music signing SDK was found")
        source = versions[0] / "resources/app.asar.unpacked"
    source = source.resolve()
    destination.mkdir(parents=True, exist_ok=True)
    files = []
    imports = {}
    for name in ("bdms.node", "metasecml.dll"):
        original = source / name
        target = destination / name
        shutil.copy2(original, target)
        files.append({"name": name, "size": target.stat().st_size, "sha256": sha256(target)})
        imports[name] = pe_imports(target)
    sys.path.insert(0, str(PROJECT))
    from music_app.providers.qishui.comments import _installed_emojis
    asar = source.parent / "main.asar"
    emojis = _installed_emojis(str(asar), asar.stat().st_mtime_ns)
    if not emojis:
        raise RuntimeError("No comment emojis were extracted")
    emoji_path = destination / "qishui-emojis.json"
    emoji_path.write_text(json.dumps(emojis, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    files.append({"name": emoji_path.name, "size": emoji_path.stat().st_size,
                  "sha256": sha256(emoji_path), "emoji_count": len(emojis)})
    verified = isolated_probe(destination, args.node.resolve())
    manifest = {"schema": 1, "source_product": "Soda Music", "source_version": source.parents[1].name,
                "platform": "windows-x64", "prepared_at_utc": dt.datetime.now(dt.timezone.utc).isoformat(),
                "files": files, "pe_import_tables": imports, "independent_validation": verified,
                "rea": {"binary_identity_confirmed": True, "deep_native_analysis": "provider_unavailable",
                        "reason": "Ghidra/IDA not configured; PE import parsing and process module observation used instead."},
                "personal_data_included": False,
                "notice": "SDK and emoji assets remain the property of their original rights holders."}
    (destination / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"output": str(destination), "files": [value["name"] for value in files],
                      "emojis": len(emojis), "isolated_signing_passed": verified["passed"]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
