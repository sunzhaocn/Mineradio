"""Exercise the real NSIS upgrade flow using an isolated disposable product.

This never runs or uninstalls Mineradio. A random GUID, product name, directories,
uninstall key, updater cache, and shortcuts are used for the QA installers.
"""
from __future__ import annotations

import hashlib
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import struct
import time
import uuid
import winreg


ROOT = Path(__file__).resolve().parents[1]
REAL_GUID = "2542aae7-0464-5cfc-bce5-8b4935dc8fb9"
ARP = "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\"
RUN = r"Software\Microsoft\Windows\CurrentVersion\Run"
APPROVED = r"Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run"
QA_UNINSTALLER = "Uninstall Mineradio-QA.exe"


def registry(key: str, machine: bool = False) -> dict:
    try:
        with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE if machine else winreg.HKEY_CURRENT_USER,
                            key, 0, winreg.KEY_READ | winreg.KEY_WOW64_64KEY) as handle:
            result = {}
            for index in range(winreg.QueryInfoKey(handle)[1]):
                name, value, _ = winreg.EnumValue(handle, index)
                result[name] = value.hex() if isinstance(value, bytes) else value
            return result
    except FileNotFoundError:
        return {}


def digest(path: Path) -> str | None:
    return hashlib.sha256(path.read_bytes()).hexdigest() if path.is_file() else None


def shortcut_unicode_target(path: Path) -> str:
    # WScript.Shell.TargetPath can return the legacy ANSI LinkInfo field as
    # question marks for a Chinese path. Inspect the canonical Unicode field.
    data = path.read_bytes()
    flags = struct.unpack_from("<I", data, 0x14)[0]
    offset = 0x4C
    if flags & 1:
        offset += 2 + struct.unpack_from("<H", data, offset)[0]
    assert flags & 2, "Shortcut has no LinkInfo"
    header = struct.unpack_from("<I", data, offset + 4)[0]
    assert header >= 0x24, "Shortcut has no Unicode path"
    base = offset + struct.unpack_from("<I", data, offset + 0x1C)[0]
    end = base
    while data[end:end + 2] != b"\0\0":
        end += 2
    return data[base:end].decode("utf-16-le")


def real_product_snapshot() -> dict:
    roaming = Path(os.environ["APPDATA"])
    local = Path(os.environ["LOCALAPPDATA"])
    return {
        "install": registry("Software\\" + REAL_GUID),
        "uninstall": registry(ARP + REAL_GUID),
        "machine_install": registry("Software\\" + REAL_GUID, True),
        "machine_uninstall": registry(ARP + REAL_GUID, True),
        "desktop_shortcut": digest(Path(os.environ["USERPROFILE"]) / "Desktop/Mineradio.lnk"),
        "start_shortcut": digest(roaming / "Microsoft/Windows/Start Menu/Programs/Mineradio.lnk"),
        "executable": digest(local / "Programs/Mineradio/Mineradio.exe"),
    }


def delete_qa_key(key: str, guid: str) -> None:
    assert key in ("Software\\" + guid, ARP + guid)
    try:
        winreg.DeleteKeyEx(winreg.HKEY_CURRENT_USER, key, winreg.KEY_WOW64_64KEY, 0)
    except FileNotFoundError:
        pass


def cleanup_qa_workspace(workspace: Path) -> None:
    workspace = workspace.resolve()
    assert workspace.parent == (ROOT / "verification").resolve()
    assert workspace.name.startswith("installer-upgrade-")
    config = json.loads((workspace / "config.json").read_text(encoding="utf-8"))
    product, guid = config["productName"], config["nsis"]["guid"]
    assert product == "Mineradio-Upgrade-QA-" + workspace.name.removeprefix("installer-upgrade-")
    assert str(uuid.UUID(guid)) == guid and guid != REAL_GUID
    assert config["appId"].startswith("com.mineradio.upgrade.qa.")
    installation = workspace / product
    for state in (registry("Software\\" + guid), registry(ARP + guid)):
        if state.get("InstallLocation"):
            assert Path(state["InstallLocation"]).resolve() == installation
    uninstaller = installation / QA_UNINSTALLER
    if uninstaller.exists():
        result = subprocess.run([str(uninstaller), "/S", "/currentuser"], cwd=ROOT, timeout=90)
        assert result.returncode == 0
    deadline = time.monotonic() + 30
    while (registry(ARP + guid) or installation.exists()) and time.monotonic() < deadline:
        time.sleep(0.05)
    assert not registry(ARP + guid) and not registry("Software\\" + guid)
    assert not installation.exists()
    user_data = Path(os.environ["APPDATA"]) / product
    if user_data.exists():
        assert user_data.parent == Path(os.environ["APPDATA"]) and user_data.name == product
        shutil.rmtree(user_data)
    updater = Path(os.environ["LOCALAPPDATA"]) / (product.lower() + "-updater")
    if updater.exists():
        assert updater.parent == Path(os.environ["LOCALAPPDATA"]) and updater.name == product.lower() + "-updater"
        shutil.rmtree(updater)
    print(json.dumps({"qa_cleanup": True, "workspace": workspace.name}))


def main() -> None:
    run = uuid.uuid4().hex[:12]
    guid = str(uuid.uuid4())
    product = "Mineradio-Upgrade-QA-" + run
    package_name = product.lower()
    workspace = ROOT / "verification" / ("installer-upgrade-" + run)
    workspace.mkdir(parents=True)
    project = workspace / "project"
    project.mkdir()
    payload = workspace / "payload"
    (payload / "resources/app").mkdir(parents=True)
    # A never-executed tiny payload is sufficient to exercise the actual builder
    # installer/uninstaller and shortcuts without starting any application.
    (payload / "Mineradio-QA.exe").write_bytes(b"QA fixture: never execute\r\n")
    old_path = workspace / product
    wrong_path = workspace / (product + "-must-not-install")
    user_data = Path(os.environ["APPDATA"]) / product
    user_data.mkdir()
    marker = user_data / "preserve-user-data.txt"
    marker.write_text("local QA settings; no accounts", encoding="utf-8")
    expected_marker_hash = digest(marker)
    shortcuts = [Path(os.environ["USERPROFILE"]) / "Desktop" / (product + ".lnk"),
                 Path(os.environ["APPDATA"]) / "Microsoft/Windows/Start Menu/Programs" / (product + ".lnk")]
    before = real_product_snapshot()
    report = {"ok": False, "kind": "real NSIS installers with isolated QA product",
              "production_registry_or_installation_modified": False,
              "qa_guid": guid, "qa_product": product, "workspace": str(workspace),
              "checks": [], "boundaries": ["No install/uninstall of the real product", "HKLM upgrade requires administrator and is not executed", "No actual Windows reboot"]}
    node = ROOT / "build/tools/node.exe"
    builder = ROOT / "node_modules/electron-builder/cli.js"
    legacy_include = workspace / "legacy.nsh"
    legacy_include.write_text('''; Simulate the originally shipped uninstaller's unconditional cleanup.
!macro customUnInstall
  DeleteRegValue HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Run" "${PRODUCT_NAME}"
  DeleteRegValue HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run" "${PRODUCT_NAME}"
!macroend
''', encoding="utf-8")
    last_installer = None

    def run_process(args: list[str], label: str, timeout: int = 180) -> None:
        completed = subprocess.run(args, cwd=ROOT, capture_output=True, text=True,
                                   encoding="utf-8", errors="replace", timeout=timeout)
        (workspace / (label + ".log")).write_text(completed.stdout + completed.stderr, encoding="utf-8")
        if completed.returncode:
            raise RuntimeError(f"{label} exit {completed.returncode}; see isolated log")

    try:
        for index, version in enumerate(("2.3.0", "2.3.1", "2.3.2")):
            package = {"name": package_name, "version": version, "productName": product,
                       "description": "Isolated NSIS upgrade QA", "author": "Mineradio QA", "main": "main.js"}
            (project / "package.json").write_text(json.dumps(package), encoding="utf-8")
            (payload / "resources/app/package.json").write_text(json.dumps(package), encoding="utf-8")
            (payload / "resources/app/main.js").write_text("// never launched\n", encoding="utf-8")
            config = {"appId": "com.mineradio.upgrade.qa." + run, "productName": product,
                      "electronVersion": "45.0.0", "directories": {"output": str(workspace / ("dist-" + version)), "buildResources": str(ROOT / "assets")},
                      "win": {"executableName": "Mineradio-QA", "signAndEditExecutable": False},
                      "nsis": {"guid": guid, "oneClick": False, "perMachine": False,
                               "allowElevation": False, "allowToChangeInstallationDirectory": True,
                               "shortcutName": product, "createDesktopShortcut": True,
                               "createStartMenuShortcut": True, "runAfterFinish": False,
                               "deleteAppDataOnUninstall": False,
                               "artifactName": "upgrade-qa-" + version + ".exe",
                               "include": str(legacy_include if index == 0 else ROOT / "assets/installer.nsh")}}
            if index:
                config["nsis"]["uninstallDisplayName"] = product
            config_file = workspace / "config.json"
            config_file.write_text(json.dumps(config), encoding="utf-8")
            run_process([str(node), str(builder), "--projectDir", str(project), "--prepackaged", str(payload),
                         "--config", str(config_file), "--win", "nsis", "--x64", "--publish", "never"], "build-" + version)
            installer = workspace / ("dist-" + version) / ("upgrade-qa-" + version + ".exe")
            last_installer = installer
            # On the final upgrade, remove both auxiliary path copies to test
            # recovery from the legacy quoted UninstallString alone.
            if index == 2:
                delete_qa_key("Software\\" + guid, guid)
                with winreg.OpenKey(winreg.HKEY_CURRENT_USER, ARP + guid, 0,
                                    winreg.KEY_SET_VALUE | winreg.KEY_WOW64_64KEY) as handle:
                    winreg.DeleteValue(handle, "InstallLocation")
            chosen_path = old_path if index == 0 else wrong_path
            obsolete_file = old_path / "obsolete-from-previous-version.txt"
            if index:
                obsolete_file.write_text("old payload file; remove on upgrade", encoding="utf-8")
            scope_argument = "/allusers" if index == 1 else "/currentuser"
            run_process([str(installer), "/S", scope_argument, "/D=" + str(chosen_path)], "install-" + version, 90)
            state = registry(ARP + guid)
            path_state = registry("Software\\" + guid)
            assert state.get("DisplayVersion") == version, state
            assert path_state.get("InstallLocation") == str(old_path), path_state
            assert (old_path / "Mineradio-QA.exe").is_file()
            assert not obsolete_file.exists(), "Legacy application files were not removed during upgrade"
            # NSIS .onInit creates an empty /D directory before customInit;
            # no payload/record/shortcut may ever be installed there.
            assert not (wrong_path / "Mineradio-QA.exe").exists(), "Upgrade installed a second payload"
            assert not (wrong_path / "resources").exists(), "Upgrade installed resources in the override path"
            assert digest(marker) == expected_marker_hash
            assert all(path.is_file() for path in shortcuts)
            assert not registry(ARP + guid, True), "QA created a second HKLM installation"
            targets = [shortcut_unicode_target(path) for path in shortcuts]
            assert targets == [str(old_path / "Mineradio-QA.exe")] * 2, targets
            if index == 0:
                autorun = '"' + str(old_path / "Mineradio-QA.exe") + '" --start-in-tray'
                approved = bytes.fromhex("030000000102030405060708")
                for key, value, kind in ((RUN, autorun, winreg.REG_SZ), (APPROVED, approved, winreg.REG_BINARY)):
                    with winreg.CreateKeyEx(winreg.HKEY_CURRENT_USER, key, 0, winreg.KEY_SET_VALUE | winreg.KEY_WOW64_64KEY) as handle:
                        winreg.SetValueEx(handle, product, 0, kind, value)
            else:
                assert registry(RUN).get(product) == autorun
                assert registry(APPROVED).get(product) == approved.hex()
            if index:
                assert state.get("DisplayName") == product
                assert state.get("InstallLocation") == str(old_path)
            report["checks"].append({"version": version, "fresh": index == 0, "same_path": True,
                                      "conflicting_D_ignored": index > 0, "same_uninstall_key": True,
                                      "conflicting_allusers_keeps_original_scope": index == 1,
                                      "shortcuts_target_canonical_path": True, "user_data_preserved": True,
                                      "recovered_from_uninstall_string": index == 2,
                                      "obsolete_payload_files_removed": index > 0,
                                      "autorun_and_binary_approval_preserved": index > 0})
        # Real generated uninstaller; its product/GUID and every target path are
        # QA-owned. Normal uninstall must preserve this QA user-data marker.
        run_process([str(old_path / QA_UNINSTALLER), "/S", "/currentuser"], "uninstall", 90)
        deadline = time.monotonic() + 30
        while (registry(ARP + guid) or old_path.exists()) and time.monotonic() < deadline:
            time.sleep(0.05)
        assert not registry(ARP + guid)
        assert not registry("Software\\" + guid)
        assert not old_path.exists()
        assert not any(path.exists() for path in shortcuts)
        assert digest(marker) == expected_marker_hash
        assert product not in registry(RUN)
        assert product not in registry(APPROVED)
        report["checks"].append({"normal_uninstall": True, "qa_product_record_removed": True,
                                  "qa_files_and_shortcuts_removed": True, "user_data_preserved": True})
        assert before == real_product_snapshot(), "Real product snapshot unexpectedly changed"
        report["real_product_before_after_identical"] = True
        report["ok"] = True
    except Exception as error:
        report["error"] = f"{type(error).__name__}: {error}"
        raise
    finally:
        # Only the unique QA namespace is eligible for cleanup.
        assert guid != REAL_GUID and product.startswith("Mineradio-Upgrade-QA-")
        if not report["ok"] and (old_path / QA_UNINSTALLER).exists():
            run_process([str(old_path / QA_UNINSTALLER), "/S", "/currentuser"], "cleanup-uninstall", 90)
            deadline = time.monotonic() + 30
            while (registry(ARP + guid) or old_path.exists()) and time.monotonic() < deadline:
                time.sleep(0.05)
        report["real_product_before_after_identical"] = before == real_product_snapshot()
        report["elapsed_finished_utc"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        (ROOT / "verification/installer-upgrade-qa.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
        if not old_path.exists():
            assert user_data.parent == Path(os.environ["APPDATA"]) and user_data.name == product
            shutil.rmtree(user_data)
            updater = Path(os.environ["LOCALAPPDATA"]) / (package_name + "-updater")
            if updater.exists():
                assert updater.parent == Path(os.environ["LOCALAPPDATA"]) and updater.name.startswith("mineradio-upgrade-qa-")
                shutil.rmtree(updater)
        print(json.dumps({"ok": report["ok"], "checks": len(report["checks"]), "report": "verification/installer-upgrade-qa.json"}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cleanup-workspace", type=Path)
    args = parser.parse_args()
    if args.cleanup_workspace:
        cleanup_qa_workspace(args.cleanup_workspace)
    else:
        main()
