use super::system_snapshot;
use anyhow::{Context, Result, ensure};
use serde_json::{Value, json};
use std::ffi::{OsStr, c_void};
use std::mem::size_of;
use std::os::windows::{ffi::OsStrExt, process::CommandExt};
use std::process::{Command, Stdio};
use std::ptr::{null, null_mut};
use windows_sys::Win32::Foundation::{
    CloseHandle, ERROR_CANCELLED, HANDLE, LUID, STATUS_ACCESS_DENIED, STATUS_PRIVILEGE_NOT_HELD,
    WAIT_OBJECT_0,
};
use windows_sys::Win32::Security::{
    AdjustTokenPrivileges, GetTokenInformation, LUID_AND_ATTRIBUTES, LookupPrivilegeValueW,
    SE_PRIVILEGE_ENABLED, TOKEN_ADJUST_PRIVILEGES, TOKEN_ELEVATION, TOKEN_PRIVILEGES, TOKEN_QUERY,
    TokenElevation,
};
use windows_sys::Win32::System::Com::{
    COINIT_APARTMENTTHREADED, COINIT_DISABLE_OLE1DDE, CoInitializeEx, CoUninitialize,
};
use windows_sys::Win32::System::Threading::{
    CREATE_NO_WINDOW, GetCurrentProcess, GetExitCodeProcess, OpenProcessToken, WaitForSingleObject,
};
use windows_sys::Win32::UI::Shell::{
    SEE_MASK_NOASYNC, SEE_MASK_NOCLOSEPROCESS, SHELLEXECUTEINFOW, ShellExecuteExW,
};
use windows_sys::Win32::UI::WindowsAndMessaging::SW_HIDE;

const WORKING_SET: u32 = 1;
const MODIFIED_LIST: u32 = 4;
const STANDBY_LIST: u32 = 8;
const STANDBY_LOW: u32 = 16;
pub const ALL: u32 = WORKING_SET | MODIFIED_LIST | STANDBY_LIST | STANDBY_LOW;
const RESULT_MARKER: u32 = 0x4D52_0000;
const STEP_BITS: u32 = (1 << STEPS.len()) - 1;
const WAS_ELEVATED: u32 = 1 << 15;
const HELPER_ARGUMENT: &str = "--memory-purge";
const STEPS: [(u32, &str, Option<i32>); 5] = [
    (WORKING_SET, "workingSet", Some(2)),
    (WORKING_SET, "fileCache", None),
    (MODIFIED_LIST, "modifiedList", Some(3)),
    (STANDBY_LIST, "standbyList", Some(4)),
    (STANDBY_LOW, "standbyLow", Some(5)),
];

#[repr(C)]
struct FileCacheInformation {
    current_size: usize,
    peak_size: usize,
    page_fault_count: u32,
    minimum_working_set: isize,
    maximum_working_set: isize,
    transition_size: usize,
    peak_transition_size: usize,
    repurpose_count: u32,
    flags: u32,
}

#[link(name = "ntdll")]
unsafe extern "system" {
    fn NtSetSystemInformation(class: u32, information: *mut c_void, length: u32) -> i32;
}

struct Handle(HANDLE);

impl Drop for Handle {
    fn drop(&mut self) {
        unsafe { CloseHandle(self.0) };
    }
}

fn wide(value: impl AsRef<OsStr>) -> Vec<u16> {
    value.as_ref().encode_wide().chain(Some(0)).collect()
}

fn token(access: u32) -> Option<Handle> {
    let mut handle = null_mut();
    let ok = unsafe { OpenProcessToken(GetCurrentProcess(), access, &mut handle) };
    (ok != 0).then(|| Handle(handle))
}

pub fn elevated() -> bool {
    token(TOKEN_QUERY).is_some_and(|token| {
        let mut data = TOKEN_ELEVATION::default();
        let mut length = 0;
        let ok = unsafe {
            GetTokenInformation(
                token.0,
                TokenElevation,
                (&mut data as *mut TOKEN_ELEVATION).cast(),
                size_of::<TOKEN_ELEVATION>() as u32,
                &mut length,
            )
        };
        ok != 0 && data.TokenIsElevated != 0
    })
}

pub fn available() -> bool {
    !std::env::var("MINERADIO_DISABLE_SYSTEM_MEMORY_PURGE").is_ok_and(|value| value == "1")
}

pub fn mask(input: &Value) -> u32 {
    let mask = (input.as_u64().unwrap_or(ALL as u64) as u32) & ALL;
    if mask == 0 { ALL } else { mask }
}

fn set_privilege(token: &Handle, name: &str) {
    let mut id = LUID::default();
    unsafe {
        if LookupPrivilegeValueW(null(), wide(name).as_ptr(), &mut id) != 0 {
            let setting = TOKEN_PRIVILEGES {
                PrivilegeCount: 1,
                Privileges: [LUID_AND_ATTRIBUTES {
                    Luid: id,
                    Attributes: SE_PRIVILEGE_ENABLED,
                }],
            };
            // The operation's NTSTATUS is authoritative when a token lacks the privilege.
            AdjustTokenPrivileges(token.0, 0, &setting, 0, null_mut(), null_mut());
        }
    }
}

fn set_information<T>(class: u32, data: &mut T) -> i32 {
    unsafe { NtSetSystemInformation(class, (data as *mut T).cast(), size_of::<T>() as u32) }
}

pub fn helper() -> Option<i32> {
    let mut args = std::env::args_os().skip(1);
    if args.next()? != HELPER_ARGUMENT {
        return None;
    }
    let mask = args
        .next()
        .and_then(|raw| raw.to_str()?.parse::<u32>().ok());
    let Some(mask) =
        mask.filter(|mask| *mask > 0 && *mask & !ALL == 0 && args.next().is_none() && available())
    else {
        return Some(1);
    };
    if let Some(token) = token(TOKEN_QUERY | TOKEN_ADJUST_PRIVILEGES) {
        set_privilege(&token, "SeProfileSingleProcessPrivilege");
        set_privilege(&token, "SeIncreaseQuotaPrivilege");
    }
    let mut result = RESULT_MARKER | if elevated() { WAS_ELEVATED } else { 0 };
    for (index, (flag, _, command)) in STEPS.iter().enumerate() {
        if mask & flag == 0 {
            continue;
        }
        let status = if let Some(command) = command {
            let mut command = *command;
            set_information(0x50, &mut command)
        } else {
            set_information(
                0x51,
                &mut FileCacheInformation {
                    current_size: 0,
                    peak_size: 0,
                    page_fault_count: 0,
                    minimum_working_set: -1,
                    maximum_working_set: -1,
                    transition_size: 0,
                    peak_transition_size: 0,
                    repurpose_count: 0,
                    flags: 0,
                },
            )
        };
        if status >= 0 {
            result |= 1 << index;
        } else if matches!(status, STATUS_ACCESS_DENIED | STATUS_PRIVILEGE_NOT_HELD) {
            result |= 1 << (8 + index);
        }
    }
    Some(result as i32)
}

struct Apartment;

impl Drop for Apartment {
    fn drop(&mut self) {
        unsafe { CoUninitialize() };
    }
}

fn launch_elevated(exe: &OsStr, mask: u32) -> Result<Option<u32>> {
    let status = unsafe {
        CoInitializeEx(
            null(),
            (COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE) as u32,
        )
    };
    ensure!(status >= 0, "无法初始化管理员释放请求");
    let _apartment = Apartment;
    let exe = wide(exe);
    let verb = wide("runas");
    let arguments = wide(format!("{HELPER_ARGUMENT} {mask}"));
    let mut launch = SHELLEXECUTEINFOW {
        cbSize: size_of::<SHELLEXECUTEINFOW>() as u32,
        fMask: SEE_MASK_NOCLOSEPROCESS | SEE_MASK_NOASYNC,
        lpVerb: verb.as_ptr(),
        lpFile: exe.as_ptr(),
        lpParameters: arguments.as_ptr(),
        nShow: SW_HIDE,
        ..Default::default()
    };
    if unsafe { ShellExecuteExW(&mut launch) } == 0 {
        let error = std::io::Error::last_os_error();
        if error.raw_os_error() == Some(ERROR_CANCELLED as i32) {
            return Ok(None);
        }
        return Err(error).context("无法启动管理员释放");
    }
    ensure!(!launch.hProcess.is_null(), "无法跟踪管理员释放");
    let process = Handle(launch.hProcess);
    ensure!(
        unsafe { WaitForSingleObject(process.0, 60_000) } == WAIT_OBJECT_0,
        "管理员释放等待超时"
    );
    let mut result = 0;
    ensure!(
        unsafe { GetExitCodeProcess(process.0, &mut result) } != 0,
        "无法读取管理员释放结果"
    );
    Ok(Some(result))
}

pub fn purge(mask: u32, elevate: bool) -> Result<Value> {
    ensure!(available(), "系统级释放已禁用");
    let start = system_snapshot()?;
    let exe = std::env::current_exe()?;
    let result = if elevate && !elevated() {
        let Some(result) = launch_elevated(exe.as_os_str(), mask)? else {
            return Ok(json!({"ok":false,"needAdmin":true,"message":"已取消管理员释放"}));
        };
        result
    } else {
        let status = Command::new(exe)
            .arg(HELPER_ARGUMENT)
            .arg(mask.to_string())
            .creation_flags(CREATE_NO_WINDOW)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .context("无法启动系统内存释放")?;
        status.code().context("系统内存释放提前结束")? as u32
    };
    ensure!(
        result & 0xFFFF_0000 == RESULT_MARKER,
        "没有收到系统内存释放结果"
    );
    let end = system_snapshot()?;
    let completed = result & STEP_BITS;
    let denied = (result >> 8) & STEP_BITS;
    let steps = STEPS
        .iter()
        .enumerate()
        .filter(|(_, (flag, _, _))| mask & flag != 0)
        .map(|(index, (_, name, _))| {
            let ok = completed & (1 << index) != 0;
            let needs_admin = denied & (1 << index) != 0;
            json!({"name":name,"ok":ok,"needAdmin":needs_admin})
        })
        .collect::<Vec<_>>();
    let partial = completed != 0 && steps.iter().any(|step| step["ok"] != true);
    Ok(
        json!({"ok":completed != 0,"partial":partial,"needAdmin":denied != 0,"mask":mask,
        "elevated":result & WAS_ELEVATED != 0,"steps":steps,
        "freedMB":end.ullAvailPhys.saturating_sub(start.ullAvailPhys)/1_048_576,
        "beforeAvailableBytes":start.ullAvailPhys,"afterAvailableBytes":end.ullAvailPhys,
        "message":if completed != 0 { "系统内存释放完成" } else { "Windows 未执行所选内存释放" }}),
    )
}
