use crate::wallpaper_capture::{GlassCapture, GlassFrames};
use crate::wallpaper_library::{WallpaperLibrary, steam_libraries};
use crate::windows_preferences::hide_native_border;
use anyhow::{Context, Result, ensure};
use serde_json::{Value, json};
use std::ffi::OsStr;
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::ptr;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tao::event_loop::EventLoopWindowTarget;
use tao::platform::windows::{WindowBuilderExtWindows, WindowExtWindows};
use tao::window::{Window, WindowBuilder};
use tokio_util::sync::CancellationToken;
use windows_sys::Win32::Foundation::{CloseHandle, HWND, LPARAM, POINT, RECT};
use windows_sys::Win32::Graphics::Dwm::{
    DWM_THUMBNAIL_PROPERTIES, DWM_TNP_OPACITY, DWM_TNP_RECTDESTINATION,
    DWM_TNP_SOURCECLIENTAREAONLY, DWM_TNP_VISIBLE, DwmRegisterThumbnail, DwmUnregisterThumbnail,
    DwmUpdateThumbnailProperties,
};
use windows_sys::Win32::System::Threading::{
    CREATE_NO_WINDOW, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION, QueryFullProcessImageNameW,
};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    EnumChildWindows, EnumWindows, GA_ROOT, GW_HWNDPREV, GWL_EXSTYLE, GetAncestor, GetClassNameW,
    GetClientRect, GetCursorPos, GetParent, GetWindow, GetWindowLongPtrW, GetWindowRect,
    GetWindowTextW, GetWindowThreadProcessId, IsIconic, IsWindow, IsWindowVisible, PostMessageW,
    SW_HIDE, SW_SHOWNOACTIVATE, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SetWindowLongPtrW,
    SetWindowPos, ShowWindow, WM_CLOSE, WM_MOUSEMOVE, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW,
    WS_EX_TRANSPARENT, WindowFromPoint,
};

pub struct SceneProcess {
    pub id: String,
    executable: PathBuf,
    title: String,
    window: usize,
    process: u32,
    _workspace: Option<tempfile::TempDir>,
}

struct SceneSearch<'a> {
    scene: &'a SceneProcess,
    window: HWND,
}

pub fn executable() -> Option<PathBuf> {
    steam_libraries().into_iter().find_map(|steam| {
        let directory = steam.join("steamapps/common/wallpaper_engine");
        ["wallpaper64.exe", "wallpaper32.exe"]
            .into_iter()
            .map(|name| directory.join(name))
            .find(|path| path.is_file())
    })
}

fn invocation(executable: &Path) -> Command {
    let mut command = Command::new(executable);
    if let Some(directory) = executable.parent() {
        command.current_dir(directory);
    }
    command
        .creation_flags(CREATE_NO_WINDOW)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    command
}

fn executable_at(window: HWND) -> Option<PathBuf> {
    let process = process_of(window);
    let handle = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, process) };
    if handle.is_null() {
        return None;
    }
    let mut data = vec![0u16; 32768];
    let mut length = data.len() as u32;
    let status = unsafe {
        let status = QueryFullProcessImageNameW(handle, 0, data.as_mut_ptr(), &mut length);
        CloseHandle(handle);
        status
    };
    (status != 0).then(|| PathBuf::from(String::from_utf16_lossy(&data[..length as usize])))
}

fn process_of(window: HWND) -> u32 {
    let mut process = 0;
    unsafe {
        GetWindowThreadProcessId(window, &mut process);
    }
    process
}

struct InputSearch {
    source: HWND,
    process: u32,
    input: HWND,
}

unsafe extern "system" fn find_input(window: HWND, context: LPARAM) -> i32 {
    let search = unsafe { &mut *(context as *mut InputSearch) };
    if process_of(window) != search.process
        || unsafe { GetAncestor(window, GA_ROOT) } != search.source
    {
        return 1;
    }
    let mut name = [0u16; 36];
    let mut title = [0u16; 32];
    let name_len = unsafe { GetClassNameW(window, name.as_mut_ptr(), name.len() as i32) } as usize;
    let title_len =
        unsafe { GetWindowTextW(window, title.as_mut_ptr(), title.len() as i32) } as usize;
    if name[..name_len]
        .iter()
        .copied()
        .eq("WPEDesktopDX11Window".encode_utf16())
        && title[..title_len]
            .iter()
            .copied()
            .eq("WPELiveWallpaper".encode_utf16())
    {
        search.input = window;
        return 0;
    }
    1
}

fn same_executable(actual: &Path, expected: &Path) -> bool {
    actual
        .to_string_lossy()
        .replace('/', "\\")
        .eq_ignore_ascii_case(&expected.to_string_lossy().replace('/', "\\"))
}

unsafe extern "system" fn matching_window(window: HWND, address: LPARAM) -> i32 {
    let result = unsafe { &mut *(address as *mut SceneSearch) };
    let mut caption = [0u16; 128];
    let length =
        unsafe { GetWindowTextW(window, caption.as_mut_ptr(), caption.len() as i32) } as usize;
    if length == 0 || String::from_utf16_lossy(&caption[..length]) != result.scene.title {
        return 1;
    }
    if executable_at(window).is_some_and(|path| same_executable(&path, &result.scene.executable)) {
        result.window = window;
        return 0;
    }
    1
}

impl SceneProcess {
    pub fn launch(
        library: &WallpaperLibrary,
        id: String,
        project: &str,
        bounds: RECT,
        cancel: CancellationToken,
    ) -> Result<Self> {
        let executable = executable().context("WALLPAPER_ENGINE_EXECUTABLE_NOT_FOUND")?;
        let (manifest, package, mut settings, muted) = library.scene(project)?;
        let declared = settings["file"]
            .as_str()
            .and_then(|name| manifest.parent()?.join(name).canonicalize().ok());
        let mut workspace = None;
        let launch = if declared.as_ref() == Some(&package)
            && muted.as_object().is_some_and(|items| items.len() == 1)
        {
            manifest
        } else {
            let staging = tempfile::Builder::new()
                .prefix("mineradio-wallpaper-")
                .tempdir()?;
            let filename = if package
                .extension()
                .is_some_and(|value| value.eq_ignore_ascii_case("pak"))
            {
                "scene.pak"
            } else {
                "scene.pkg"
            };
            let destination = staging.path().join(filename);
            if std::fs::hard_link(&package, &destination).is_err() {
                std::fs::copy(&package, &destination)?;
            }
            settings["file"] = json!(filename);
            if let Some(fields) = settings
                .pointer_mut("/general/properties")
                .and_then(Value::as_object_mut)
            {
                for (key, value) in muted.as_object().into_iter().flatten() {
                    if let Some(field) = fields.get_mut(key).filter(|field| field.is_object()) {
                        field["value"] = value.clone();
                    }
                }
            }
            let staged_manifest = staging.path().join("project.json");
            std::fs::write(&staged_manifest, serde_json::to_vec(&settings)?)?;
            workspace = Some(staging);
            staged_manifest
        };
        let mut scene = Self {
            title: format!("Mineradio Wallpaper {id}"),
            id,
            executable,
            window: 0,
            process: 0,
            _workspace: workspace,
        };
        let horizontal = (bounds.right - bounds.left).clamp(640, 3840).to_string();
        let vertical = (bounds.bottom - bounds.top).clamp(360, 2160).to_string();
        ensure!(!cancel.is_cancelled(), "WALLPAPER_ENGINE_START_SUPERSEDED");
        let mut control = invocation(&scene.executable)
            .args(["-control", "openWallpaper", "-file"])
            .arg(OsStr::new(
                launch.to_string_lossy().trim_start_matches(r"\\?\"),
            ))
            .args([
                "-playInWindow",
                &scene.title,
                "-width",
                &horizontal,
                "-height",
                &vertical,
                "-x",
                "-28000",
                "-y",
                "-28000",
                "-borderless",
            ])
            .spawn()
            .context("WALLPAPER_ENGINE_OPEN_FAILED")?;
        let started = Instant::now();
        while started.elapsed() < Duration::from_secs(24) && !cancel.is_cancelled() {
            let mut result = SceneSearch {
                scene: &scene,
                window: ptr::null_mut(),
            };
            unsafe {
                EnumWindows(
                    Some(matching_window),
                    (&mut result as *mut SceneSearch) as LPARAM,
                );
            }
            if !result.window.is_null() {
                let source = result.window;
                scene.window = source as usize;
                scene.process = process_of(source);
                if muted.as_object().is_some_and(|values| !values.is_empty()) {
                    let argument = format!("RAW~({muted})~END");
                    let _ = invocation(&scene.executable)
                        .args([
                            "-control",
                            "applyProperties",
                            "-properties",
                            &argument,
                            "-location",
                            &scene.title,
                        ])
                        .spawn();
                }
                return Ok(scene);
            }
            let _ = control.try_wait();
            std::thread::sleep(Duration::from_millis(125));
        }
        Err(anyhow::anyhow!(if cancel.is_cancelled() {
            "WALLPAPER_ENGINE_START_SUPERSEDED"
        } else {
            "WALLPAPER_ENGINE_WINDOW_NOT_FOUND"
        }))
    }
}

impl Drop for SceneProcess {
    fn drop(&mut self) {
        let _ = invocation(&self.executable)
            .args(["-control", "closeWallpaper", "-location", &self.title])
            .spawn();
        if self.window != 0 {
            let hwnd = self.window as HWND;
            if executable_at(hwnd).is_some_and(|path| same_executable(&path, &self.executable)) {
                unsafe {
                    PostMessageW(hwnd, WM_CLOSE, 0, 0);
                }
            }
        }
    }
}

pub struct SceneSurface {
    glass: Option<GlassCapture>,
    bar_visible: bool,
    scene: SceneProcess,
    window: Window,
    thumbnail: isize,
    drawn: bool,
    acknowledged: bool,
    visual: Visual,
    visual_changed: bool,
    input: HWND,
    pointer: Option<(i32, i32)>,
    pointer_posts: u64,
}

#[derive(Clone, Copy, PartialEq)]
struct Visual {
    scale: f64,
    left: f64,
    top: f64,
    opacity: u8,
}

impl Visual {
    fn read(settings: &Value) -> Self {
        let horizontal = 2.0
            * settings["positionX"]
                .as_f64()
                .unwrap_or(0.0)
                .clamp(-0.5, 0.5);
        let vertical = 2.0
            * settings["positionY"]
                .as_f64()
                .unwrap_or(0.0)
                .clamp(-0.5, 0.5);
        let overscan = 1.0 + horizontal.abs().max(vertical.abs()) * 0.18;
        let scale = settings["scale"]
            .as_f64()
            .unwrap_or(1.08)
            .clamp(1.0, 1.6)
            .max(overscan);
        let opacity = settings["opacity"].as_f64().unwrap_or(1.0).clamp(0.15, 1.0);
        Self {
            scale,
            left: (scale - 1.0) * (horizontal - 1.0) / 2.0,
            top: (scale - 1.0) * (vertical - 1.0) / 2.0,
            opacity: (255.0 * opacity).round() as u8,
        }
    }

    fn rect(self, width: i32, height: i32) -> RECT {
        let left = (f64::from(width) * self.left).round() as i32;
        let top = (f64::from(height) * self.top).round() as i32;
        RECT {
            left,
            top,
            right: left + (f64::from(width) * self.scale).round() as i32,
            bottom: top + (f64::from(height) * self.scale).round() as i32,
        }
    }
}

pub fn bounds(host: &Window) -> RECT {
    let mut bounds = RECT::default();
    unsafe {
        GetWindowRect(host.hwnd() as HWND, &mut bounds);
    }
    bounds
}

impl SceneSurface {
    pub fn open<T: 'static>(
        scene: SceneProcess,
        events: &EventLoopWindowTarget<T>,
    ) -> Result<Self> {
        let window = WindowBuilder::new()
            .with_title("Mineradio Wallpaper Surface")
            .with_decorations(false)
            .with_undecorated_shadow(false)
            .with_skip_taskbar(true)
            .with_focusable(false)
            .with_visible(false)
            .build(events)?;
        hide_native_border(&window);
        let destination = window.hwnd() as HWND;
        let source = scene.window as HWND;
        let mut thumbnail = 0;
        unsafe {
            let flags = GetWindowLongPtrW(destination, GWL_EXSTYLE);
            SetWindowLongPtrW(
                destination,
                GWL_EXSTYLE,
                flags | (WS_EX_TRANSPARENT | WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW) as isize,
            );
            ensure!(
                DwmRegisterThumbnail(destination, source, &mut thumbnail) >= 0,
                "WALLPAPER_ENGINE_DWM_SURFACE_FAILED"
            );
        }
        Ok(Self {
            glass: None,
            bar_visible: true,
            scene,
            window,
            thumbnail,
            drawn: false,
            acknowledged: false,
            visual: Visual::read(&Value::Null),
            visual_changed: true,
            input: ptr::null_mut(),
            pointer: None,
            pointer_posts: 0,
        })
    }

    pub fn id(&self) -> &str {
        &self.scene.id
    }

    pub fn acknowledge(&mut self, host: &Window) -> bool {
        self.acknowledged = true;
        self.sync(host) && self.drawn
    }

    pub fn start_glass(&mut self, frames: Arc<GlassFrames>, fps: u64) -> Result<Value> {
        ensure!(self.drawn, "WALLPAPER_ENGINE_HOST_HIDDEN");
        ensure!(
            executable_at(self.scene.window as HWND)
                .is_some_and(|path| same_executable(&path, &self.scene.executable)),
            "WALLPAPER_ENGINE_SOURCE_CLOSED"
        );
        if self.glass.as_ref().is_none_or(GlassCapture::failed) {
            self.glass = None;
            self.glass = Some(GlassCapture::start(
                frames,
                &self.scene.id,
                self.scene.window,
                fps,
                self.bar_visible,
            )?);
        }
        if let Some(glass) = &self.glass {
            glass.warm();
        }
        Ok(json!({"ok":true,"capturePrepared":true,"liveFrames":true}))
    }

    pub fn show_glass(&mut self, visible: bool) {
        self.bar_visible = visible;
        if let Some(glass) = &self.glass {
            glass.visibility(self.drawn, visible);
        }
    }

    pub fn visual_settings(&mut self, settings: &Value) -> Value {
        let visual = Visual::read(settings);
        self.visual_changed |= visual != self.visual;
        self.visual = visual;
        json!({"ok":true,"sessionId":self.id(),"scale":visual.scale,"left":visual.left,"top":visual.top,
            "opacity":f64::from(visual.opacity) / 255.0})
    }

    fn relay_pointer(&mut self, host: HWND, target: RECT) {
        let mut cursor = POINT::default();
        if unsafe { GetCursorPos(&mut cursor) } == 0
            || cursor.x < target.left
            || cursor.x >= target.right
            || cursor.y < target.top
            || cursor.y >= target.bottom
            || unsafe { GetAncestor(WindowFromPoint(cursor), GA_ROOT) } != host
        {
            self.pointer = None;
            return;
        }
        let point = (cursor.x - target.left, cursor.y - target.top);
        if self.pointer == Some(point) {
            return;
        }
        let source = self.scene.window as HWND;
        if self.input.is_null()
            || process_of(self.input) != self.scene.process
            || unsafe { GetAncestor(self.input, GA_ROOT) } != source
        {
            let mut search = InputSearch {
                source,
                process: self.scene.process,
                input: ptr::null_mut(),
            };
            unsafe {
                EnumChildWindows(
                    source,
                    Some(find_input),
                    (&mut search as *mut InputSearch) as LPARAM,
                );
            }
            self.input = search.input;
        }
        let mut input = RECT::default();
        if self.input.is_null() || unsafe { GetClientRect(self.input, &mut input) } == 0 {
            return;
        }
        let coordinate = |at: i32, source: i32, dest: i32| {
            (f64::from(at) / f64::from((source - 1).max(1)) * f64::from((dest - 1).clamp(0, 32767)))
                .round() as isize
        };
        let x = coordinate(
            point.0,
            target.right - target.left,
            input.right - input.left,
        );
        let y = coordinate(
            point.1,
            target.bottom - target.top,
            input.bottom - input.top,
        );
        if unsafe { PostMessageW(self.input, WM_MOUSEMOVE, 0, (y << 16) | x) } != 0 {
            self.pointer = Some(point);
            self.pointer_posts += 1;
        }
    }

    pub fn sync(&mut self, host: &Window) -> bool {
        let main = host.hwnd() as HWND;
        let helper = self.window.hwnd() as HWND;
        let source = self.scene.window as HWND;
        unsafe {
            if IsWindow(source) == 0 || process_of(source) != self.scene.process {
                return false;
            }
            let visible = self.acknowledged
                && IsIconic(main) == 0
                && IsWindowVisible(main) != 0
                && GetParent(main).is_null();
            if let Some(glass) = &self.glass {
                glass.visibility(visible, self.bar_visible);
            }
            if !visible {
                self.pointer = None;
                if self.drawn {
                    ShowWindow(helper, SW_HIDE);
                    self.drawn = false;
                }
                return true;
            }
            let metrics = bounds(host);
            self.relay_pointer(main, metrics);
            let mut previous = RECT::default();
            GetWindowRect(helper, &mut previous);
            let same = [previous.left, previous.top, previous.right, previous.bottom]
                == [metrics.left, metrics.top, metrics.right, metrics.bottom];
            if self.drawn && same && !self.visual_changed && GetWindow(helper, GW_HWNDPREV) == main
            {
                return true;
            }
            let width = metrics.right - metrics.left;
            let height = metrics.bottom - metrics.top;
            if width <= 0 || height <= 0 {
                return true;
            }
            SetWindowPos(
                helper,
                main,
                metrics.left,
                metrics.top,
                width,
                height,
                SWP_NOACTIVATE,
            );
            let native = DWM_THUMBNAIL_PROPERTIES {
                dwFlags: DWM_TNP_RECTDESTINATION
                    | DWM_TNP_OPACITY
                    | DWM_TNP_VISIBLE
                    | DWM_TNP_SOURCECLIENTAREAONLY,
                rcDestination: self.visual.rect(width, height),
                opacity: self.visual.opacity,
                fVisible: 1,
                fSourceClientAreaOnly: 1,
                ..DWM_THUMBNAIL_PROPERTIES::default()
            };
            if DwmUpdateThumbnailProperties(self.thumbnail, &native) < 0 {
                return false;
            }
            ShowWindow(helper, SW_SHOWNOACTIVATE);
            SetWindowPos(
                helper,
                main,
                0,
                0,
                0,
                0,
                SWP_NOACTIVATE | SWP_NOMOVE | SWP_NOSIZE,
            );
            self.drawn = true;
            self.visual_changed = false;
            true
        }
    }

    pub fn status(&self) -> Value {
        json!({"ok":true,"sessionId":self.id(),"captureMode":"dwm-thumbnail","captureReady":self.drawn,"active":true,
            "parallaxPointerRelayPosted":self.pointer_posts})
    }
}

impl Drop for SceneSurface {
    fn drop(&mut self) {
        unsafe {
            DwmUnregisterThumbnail(self.thumbnail);
        }
    }
}
