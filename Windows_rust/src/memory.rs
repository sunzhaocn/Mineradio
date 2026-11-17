mod system;

use anyhow::{Result, ensure};
use serde_json::{Value, json};
use std::mem::size_of;
use std::time::{Duration, Instant};
use windows_sys::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE};
use windows_sys::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, PROCESSENTRY32W, Process32FirstW, Process32NextW, TH32CS_SNAPPROCESS,
};
use windows_sys::Win32::System::ProcessStatus::{
    K32EmptyWorkingSet, K32GetProcessMemoryInfo, PROCESS_MEMORY_COUNTERS_EX,
};
use windows_sys::Win32::System::SystemInformation::{GlobalMemoryStatusEx, MEMORYSTATUSEX};
use windows_sys::Win32::System::Threading::{
    OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_SET_QUOTA,
};

#[derive(Default)]
pub struct MemoryOptions {
    config: SystemConfig,
    next_run: Option<Instant>,
    pending: bool,
    system_at: Option<i128>,
    system_result: Option<Value>,
    last_trim: Option<i128>,
    reason: String,
    background_seen: bool,
    app_due: Option<Instant>,
    app_last: Option<Instant>,
}

struct SystemConfig {
    enabled: bool,
    mask: u32,
    interval_min: u64,
    threshold: u64,
    elevate: bool,
    app_trim: bool,
    background_trim: bool,
}

impl Default for SystemConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            mask: system::ALL,
            interval_min: 30,
            threshold: 78,
            elevate: false,
            app_trim: true,
            background_trim: true,
        }
    }
}

#[derive(Clone, Copy)]
pub struct SystemJob {
    mask: u32,
    elevate: bool,
}

pub fn helper() -> Option<i32> {
    system::helper()
}

fn timestamp() -> i128 {
    time::OffsetDateTime::now_utc().unix_timestamp_nanos() / 1_000_000
}

fn automatic_available() -> bool {
    system::available()
        && !std::env::var("MINERADIO_DISABLE_AUTOMATIC_SYSTEM_MEMORY_PURGE")
            .is_ok_and(|value| value == "1")
}

fn processes() -> Vec<u32> {
    let main = std::process::id();
    let mut related = vec![main];
    let mut children = Vec::new();
    let handle = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) };
    if handle == INVALID_HANDLE_VALUE {
        return related;
    }
    let mut entry = PROCESSENTRY32W {
        dwSize: size_of::<PROCESSENTRY32W>() as u32,
        ..Default::default()
    };
    unsafe {
        let mut next = Process32FirstW(handle, &mut entry);
        while next != 0 {
            let len = entry
                .szExeFile
                .iter()
                .position(|word| *word == 0)
                .unwrap_or(entry.szExeFile.len());
            let name = String::from_utf16_lossy(&entry.szExeFile[..len]);
            if name.eq_ignore_ascii_case("msedgewebview2.exe") {
                children.push((entry.th32ParentProcessID, entry.th32ProcessID));
            }
            next = Process32NextW(handle, &mut entry);
        }
        CloseHandle(handle);
    }
    let mut index = 0;
    while index < related.len() {
        let parent = related[index];
        for &(_, child) in children.iter().filter(|(owner, _)| *owner == parent) {
            if !related.contains(&child) {
                related.push(child);
            }
        }
        index += 1;
    }
    related
}

fn system_snapshot() -> Result<MEMORYSTATUSEX> {
    let mut data = MEMORYSTATUSEX {
        dwLength: size_of::<MEMORYSTATUSEX>() as u32,
        ..Default::default()
    };
    ensure!(
        unsafe { GlobalMemoryStatusEx(&mut data) } != 0,
        "系统内存读取失败"
    );
    Ok(data)
}

pub fn snapshot() -> Result<Value> {
    let data = system_snapshot()?;
    let mut resident = 0usize;
    let mut private = 0usize;
    for pid in processes() {
        let process = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) };
        if process.is_null() {
            continue;
        }
        let mut entry = PROCESS_MEMORY_COUNTERS_EX {
            cb: size_of::<PROCESS_MEMORY_COUNTERS_EX>() as u32,
            ..Default::default()
        };
        let ok = unsafe {
            let result = K32GetProcessMemoryInfo(
                process,
                (&mut entry as *mut PROCESS_MEMORY_COUNTERS_EX).cast(),
                entry.cb,
            );
            CloseHandle(process);
            result
        };
        if ok != 0 {
            resident = resident.saturating_add(entry.WorkingSetSize);
            private = private.saturating_add(entry.PrivateUsage);
        }
    }
    let used = data.ullTotalPhys.saturating_sub(data.ullAvailPhys);
    const MB: u64 = 1_048_576;
    Ok(
        json!({"platform":"win32","totalBytes":data.ullTotalPhys,"freeBytes":data.ullAvailPhys,"usedBytes":used,
        "totalMB":(data.ullTotalPhys+MB/2)/MB,"freeMB":(data.ullAvailPhys+MB/2)/MB,"usedMB":(used+MB/2)/MB,
        "usedPercent":data.dwMemoryLoad,"process":{"rssMB":resident as u64 / MB,"privateMB":private as u64 / MB}}),
    )
}

impl MemoryOptions {
    fn configuration(&self) -> Value {
        let value = &self.config;
        json!({"appTrimEnabled":value.app_trim,"backgroundTrimEnabled":value.background_trim,
            "enabled":value.enabled,"mask":value.mask,"intervalMin":value.interval_min,"thresholdPercent":value.threshold,
            "autoElevate":value.elevate,"lastRunAt":self.system_at,"lastResult":self.system_result,"running":self.pending})
    }

    pub fn configure(&mut self, input: &Value) -> Value {
        let was_enabled = self.config.enabled;
        let previous_interval = self.config.interval_min;
        self.config = SystemConfig {
            enabled: input["enabled"] == true && automatic_available(),
            mask: system::mask(&input["mask"]),
            interval_min: input["intervalMin"].as_u64().unwrap_or(30).clamp(5, 180),
            threshold: input["thresholdPercent"]
                .as_u64()
                .unwrap_or(78)
                .clamp(50, 98),
            elevate: input["autoElevate"] == true,
            app_trim: input["appTrimEnabled"] != false,
            background_trim: input["backgroundTrimEnabled"] != false,
        };
        if !self.config.enabled {
            self.next_run = None;
        } else if input["runNow"] == true {
            self.next_run = Some(Instant::now());
        } else if !was_enabled || previous_interval != self.config.interval_min {
            self.next_run =
                Some(Instant::now() + Duration::from_secs(self.config.interval_min * 60));
        }
        json!({"ok":true,"state":self.configuration(),"systemPurgeAvailable":system::available(),
            "systemPurgeEnabled":automatic_available()})
    }

    pub fn status(&self) -> Result<Value> {
        let snapshot = snapshot()?;
        Ok(
            json!({"ok":true,"snapshot":snapshot,"appMetrics":snapshot["process"],"auto":self.configuration(),
            "elevated":system::elevated(),"systemPurgeAvailable":system::available(),"systemPurgeEnabled":automatic_available(),
            "lastTrimAt":self.last_trim,"lastTrimReason":self.reason}),
        )
    }

    pub fn trim(&mut self, reason: &str, foreground: bool) -> Result<Value> {
        if foreground && reason != "manual-force" {
            return Ok(json!({"ok":false,"skipped":true,"reason":"foreground-visible"}));
        }
        let before = snapshot()?;
        let mut trimmed = 0u32;
        for pid in processes() {
            let process = unsafe {
                OpenProcess(
                    PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_SET_QUOTA,
                    0,
                    pid,
                )
            };
            if process.is_null() {
                continue;
            }
            unsafe {
                trimmed += u32::from(K32EmptyWorkingSet(process) != 0);
                CloseHandle(process);
            }
        }
        ensure!(trimmed > 0, "暂时无法整理 Mineradio 内存");
        self.app_last = Some(Instant::now());
        self.app_due = None;
        self.last_trim = Some(timestamp());
        self.reason = reason
            .chars()
            .filter(|letter| !letter.is_control())
            .take(80)
            .collect();
        let mut after = self.status()?;
        after["before"] = before;
        after["after"] = after["snapshot"].clone();
        after["trimmed"] = json!(trimmed);
        Ok(after)
    }

    pub fn next_attempt(&self) -> Option<Instant> {
        self.next_run.into_iter().chain(self.app_due).min()
    }

    pub fn background_trim(&mut self, foreground: bool) {
        if foreground || !(self.config.app_trim && self.config.background_trim) {
            self.background_seen = false;
            self.app_due = None;
            return;
        }
        let now = Instant::now();
        if !self.background_seen {
            self.background_seen = true;
            if self
                .app_last
                .is_none_or(|last| now.duration_since(last) >= Duration::from_secs(120))
            {
                self.app_due = Some(now + Duration::from_secs(9));
            }
        }
        if self.app_due.is_some_and(|due| now >= due) {
            self.app_due = None;
            if !self.pending {
                let _ = self.trim("background", false);
            }
        }
    }

    pub fn manual(
        &mut self,
        input: &Value,
        foreground: bool,
    ) -> std::result::Result<SystemJob, Value> {
        let reason = if !system::available() {
            "disabled"
        } else if foreground {
            "foreground-visible"
        } else if self.pending {
            "pending"
        } else {
            self.pending = true;
            return Ok(SystemJob {
                mask: system::mask(&input["mask"]),
                elevate: input["autoElevate"] == true,
            });
        };
        Err(
            json!({"ok":true,"systemPurgeAvailable":system::available(),"result":{"ok":false,"skipped":true,"reason":reason}}),
        )
    }

    pub fn automatic(&mut self, foreground: bool) -> Option<SystemJob> {
        let now = Instant::now();
        if self.next_run.is_none_or(|run| now < run) {
            return None;
        }
        self.next_run = Some(now + Duration::from_secs(self.config.interval_min * 60));
        if self.pending {
            return None;
        }
        let used = system_snapshot().ok()?.dwMemoryLoad;
        if foreground || used < self.config.threshold as u32 {
            self.system_at = Some(timestamp());
            self.system_result = Some(json!({"ok":false,"skipped":true,
                "reason":if foreground {"foreground-visible"} else {"below-threshold"},
                "usedPercent":used,"thresholdPercent":self.config.threshold}));
            return None;
        }
        self.pending = true;
        Some(SystemJob {
            mask: self.config.mask,
            elevate: self.config.elevate,
        })
    }

    pub fn finished(&mut self, result: Value, automatic: bool) -> Result<Value> {
        self.pending = false;
        if automatic {
            self.system_at = Some(timestamp());
            self.system_result = Some(result.clone());
        }
        let mut response = self.status()?;
        response["result"] = result;
        Ok(response)
    }
}

impl SystemJob {
    pub fn run(self) -> Value {
        let result = system::purge(self.mask, self.elevate);
        match result {
            Ok(response) => response,
            Err(error) => json!({"ok":false,"message":error.to_string()}),
        }
    }
}
