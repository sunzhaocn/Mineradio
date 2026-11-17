use anyhow::{Context, Result, ensure};
use serde_json::{Value, json};
use std::ffi::OsStr;
use std::io::Read;
use std::os::windows::ffi::OsStrExt;
use std::path::{Path, PathBuf};
use tao::platform::windows::WindowExtWindows;
use tao::window::Window;
use url::Url;
use windows_sys::Win32::Foundation::{ERROR_FILE_NOT_FOUND, ERROR_SUCCESS};
use windows_sys::Win32::Graphics::Dwm::{
    DWMNCRP_DISABLED, DWMWA_BORDER_COLOR, DWMWA_COLOR_NONE, DWMWA_NCRENDERING_POLICY,
    DwmSetWindowAttribute,
};
use windows_sys::Win32::Graphics::Gdi::{CreateRoundRectRgn, DeleteObject, SetWindowRgn};
use windows_sys::Win32::System::Registry::{
    HKEY_CURRENT_USER, REG_SZ, RRF_RT_REG_SZ, RegDeleteKeyValueW, RegGetValueW, RegSetKeyValueW,
};
use windows_sys::Win32::UI::Shell::ShellExecuteW;
use windows_sys::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

const RUN: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";
const STARTUP: &str = "Mineradio";

#[derive(Default)]
pub struct MainWindowShape {
    rounded: Option<(i32, i32, i32)>,
}

impl MainWindowShape {
    pub fn sync(&mut self, window: &Window) {
        if window.is_minimized() {
            return;
        }
        let rounded = if window.fullscreen().is_some() || window.is_maximized() {
            None
        } else {
            let size = window.outer_size();
            // Match the 34px corners in the desktop shell stylesheet at the current DPI.
            let diameter = (68.0 * window.scale_factor()).ceil() as i32;
            Some((size.width as i32, size.height as i32, diameter))
        };
        if rounded == self.rounded {
            return;
        }
        unsafe {
            let region = if let Some((width, height, diameter)) = rounded {
                if width <= 0 || height <= 0 {
                    return;
                }
                // GDI excludes the bottom and right edges from this rounded region.
                let region = CreateRoundRectRgn(0, 0, width + 1, height + 1, diameter, diameter);
                if region.is_null() {
                    return;
                }
                region
            } else {
                std::ptr::null_mut()
            };
            if SetWindowRgn(window.hwnd() as _, region, i32::from(window.is_visible())) != 0 {
                self.rounded = rounded; // Windows owns the applied region.
            } else if !region.is_null() {
                DeleteObject(region);
            }
        }
    }
}

pub fn hide_native_border(window: &Window) {
    // The WebView draws the frame, including after Windows restores the normal window styles.
    let policy = DWMNCRP_DISABLED;
    let color = DWMWA_COLOR_NONE;
    unsafe {
        DwmSetWindowAttribute(
            window.hwnd() as _,
            DWMWA_NCRENDERING_POLICY as u32,
            (&policy as *const i32).cast(),
            size_of::<i32>() as u32,
        );
        DwmSetWindowAttribute(
            window.hwnd() as _,
            DWMWA_BORDER_COLOR as u32,
            (&color as *const u32).cast(),
            size_of::<u32>() as u32,
        );
    }
}

fn wide(text: impl AsRef<OsStr>) -> Vec<u16> {
    text.as_ref().encode_wide().chain(Some(0)).collect()
}

pub fn choose_folder(parent: &Window, current: &Path, title: &str) -> Option<PathBuf> {
    let mut dialog = rfd::FileDialog::new().set_title(title).set_parent(parent);
    if current.is_dir() {
        dialog = dialog.set_directory(current);
    }
    dialog.pick_folder()
}

pub fn choose_wallpaper_file(parent: &Window) -> Option<PathBuf> {
    rfd::FileDialog::new()
        .set_parent(parent)
        .set_title("选择 Wallpaper Engine 项目文件")
        .add_filter("项目清单或场景包", &["json", "pkg", "pak"])
        .pick_file()
}

pub fn export_destination(parent: &Window, name: &str, json_file: bool) -> Option<PathBuf> {
    let mut dialog = rfd::FileDialog::new()
        .set_parent(parent)
        .set_file_name(name);
    dialog = if json_file {
        dialog
            .set_title("导出 Mineradio 存档")
            .add_filter("JSON", &["json"])
    } else {
        dialog.set_title("保存导出文件")
    };
    dialog.save_file()
}

pub fn video_destination(parent: &Window, name: &str) -> Option<PathBuf> {
    rfd::FileDialog::new()
        .set_parent(parent)
        .set_file_name(name)
        .set_title("导出当前预设视频")
        .add_filter("MP4 视频", &["mp4"])
        .save_file()
        .map(|mut place| {
            if !place
                .extension()
                .is_some_and(|value| value.eq_ignore_ascii_case("mp4"))
            {
                place.set_extension("mp4");
            }
            place
        })
}

pub fn import_json(parent: &Window) -> Result<Value> {
    const MAX_BYTES: u64 = 128 * 1024 * 1024;
    let Some(path) = rfd::FileDialog::new()
        .set_parent(parent)
        .set_title("导入 Mineradio 存档")
        .add_filter("JSON", &["json"])
        .pick_file()
    else {
        return Ok(json!({"ok":false,"canceled":true}));
    };
    let mut text = String::new();
    std::fs::File::open(&path)?
        .take(MAX_BYTES + 1)
        .read_to_string(&mut text)?;
    ensure!(text.len() as u64 <= MAX_BYTES, "导入存档过大");
    let text = text.trim_start_matches('\u{feff}');
    Ok(json!({"ok":true,"filePath":path,"text":text}))
}

fn open(parent: &Window, name: impl AsRef<OsStr>) -> Result<Value> {
    let verb = wide("open");
    let name = wide(name);
    let launcher = unsafe {
        ShellExecuteW(
            parent.hwnd() as _,
            verb.as_ptr(),
            name.as_ptr(),
            std::ptr::null(),
            std::ptr::null(),
            SW_SHOWNORMAL,
        )
    };
    ensure!(launcher as isize > 32, "Windows 无法打开指定位置");
    Ok(json!({"ok":true}))
}

pub fn open_folder(parent: &Window, path: &Path) -> Result<Value> {
    std::fs::create_dir_all(path)?;
    open(parent, path.as_os_str())
}

pub fn open_external(parent: &Window, address: &str) -> Result<Value> {
    ensure!(address.len() <= 2048, "网址过长");
    let url = Url::parse(address).ok().context("网址无效")?;
    ensure!(
        url.scheme() == "https"
            && url.username().is_empty()
            && url.password().is_none()
            && url.port_or_known_default() == Some(443),
        "网址无效"
    );
    open(parent, url.as_str())
}

fn own_startup_value() -> Result<Vec<u16>> {
    let binary = std::env::current_exe()?;
    let mut command = std::ffi::OsString::from("\"");
    command.push(binary.as_os_str());
    command.push("\" --start-in-tray");
    Ok(wide(command))
}

pub fn startup_enabled() -> bool {
    let key = wide(RUN);
    let item = wide(STARTUP);
    let mut data = [0u16; 2048];
    let mut size = std::mem::size_of_val(&data) as u32;
    let result = unsafe {
        RegGetValueW(
            HKEY_CURRENT_USER,
            key.as_ptr(),
            item.as_ptr(),
            RRF_RT_REG_SZ,
            std::ptr::null_mut(),
            data.as_mut_ptr().cast(),
            &mut size,
        )
    };
    result == ERROR_SUCCESS
        && own_startup_value().is_ok_and(|expected| {
            let read = String::from_utf16_lossy(&data[..size as usize / 2]);
            let expected = String::from_utf16_lossy(&expected);
            read.eq_ignore_ascii_case(&expected)
        })
}

pub fn set_startup(enabled: bool) -> Result<Value> {
    let key = wide(RUN);
    let item = wide(STARTUP);
    let code = if enabled {
        let value = own_startup_value()?;
        unsafe {
            RegSetKeyValueW(
                HKEY_CURRENT_USER,
                key.as_ptr(),
                item.as_ptr(),
                REG_SZ,
                value.as_ptr().cast(),
                (value.len() * 2) as u32,
            )
        }
    } else {
        unsafe { RegDeleteKeyValueW(HKEY_CURRENT_USER, key.as_ptr(), item.as_ptr()) }
    };
    ensure!(
        code == ERROR_SUCCESS || (!enabled && code == ERROR_FILE_NOT_FOUND),
        "Windows 未确认开机自启动设置"
    );
    Ok(json!({"ok":true,"supported":true,"enabled":startup_enabled()}))
}
