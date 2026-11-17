use crate::windows_preferences::hide_native_border;
use anyhow::{Context, Result};
use serde::Deserialize;
use serde_json::{Value, json};
use tao::dpi::{LogicalSize, PhysicalPosition};
use tao::event_loop::EventLoopWindowTarget;
use tao::platform::windows::WindowBuilderExtWindows;
use tao::window::{Window, WindowBuilder, WindowId};
use wry::{
    NewWindowResponse, WebView, WebViewBuilder, WebViewBuilderExtWindows, WebViewExtWindows,
};

#[derive(Deserialize)]
#[serde(tag = "method", content = "value", rename_all = "camelCase")]
pub enum LyricsAction {
    Ready,
    Close,
    Lock(bool),
    Move([f64; 2]),
}

#[derive(Default)]
pub struct DesktopLyrics {
    current: Option<Overlay>,
    payload: Value,
}

struct Overlay {
    view: WebView,
    window: Window,
    ready: bool,
}

impl DesktopLyrics {
    pub fn set<T: 'static>(
        &mut self,
        enabled: bool,
        payload: &Value,
        origin: &str,
        parent: &Window,
        target: &EventLoopWindowTarget<T>,
        parent_view: &WebView,
        notify: impl Fn(LyricsAction) + 'static,
    ) -> Result<()> {
        if !enabled {
            self.close();
            return Ok(());
        }
        let previous_y = self.payload.get("y").cloned();
        if !self.payload.is_object() {
            self.payload = json!({"enabled":true,"clickThrough":true,"text":"Mineradio"});
        }
        if let Some(values) = payload.as_object() {
            self.payload
                .as_object_mut()
                .expect("desktop lyrics state object")
                .extend(values.clone());
        }
        self.payload["enabled"] = json!(enabled);
        if self.current.is_none() {
            let overlay_url = format!("{origin}/desktop-lyrics.html");
            let ipc_url = overlay_url.clone();
            let local_url = overlay_url.clone();
            let script = include_str!("lyrics_window.js").replace(
                "__MINERADIO_LYRICS_PAGE__",
                &serde_json::to_string(&overlay_url)?,
            );
            let window = WindowBuilder::new()
                .with_title("Mineradio Desktop Lyrics")
                .with_visible(false)
                .with_decorations(false)
                .with_undecorated_shadow(false)
                .with_skip_taskbar(true)
                .with_transparent(true)
                .with_focusable(false)
                .with_resizable(false)
                .with_always_on_top(true)
                .with_inner_size(LogicalSize::new(920.0, 190.0))
                .build(target)?;
            hide_native_border(&window);
            place(parent, &window, &self.payload)?;
            let view = WebViewBuilder::new()
                .with_default_context_menus(false)
                .with_environment(parent_view.environment())
                .with_url(overlay_url)
                .with_transparent(true)
                .with_new_window_req_handler(|_, _| NewWindowResponse::Deny)
                .with_initialization_script_for_main_only(script, true)
                .with_navigation_handler(move |url| url == local_url)
                .with_ipc_handler(move |request| {
                    if request.uri().to_string() == ipc_url && request.body().len() < 1024 {
                        if let Ok(action) = serde_json::from_str::<LyricsAction>(request.body()) {
                            notify(action);
                        }
                    }
                })
                .build(&window)
                .context("无法打开桌面歌词窗口")?;
            self.current = Some(Overlay {
                view,
                window,
                ready: false,
            });
        } else if previous_y.as_ref() != self.payload.get("y") {
            place(
                parent,
                &self.current.as_ref().expect("existing overlay").window,
                &self.payload,
            )?;
        }
        self.apply();
        Ok(())
    }

    pub fn enabled(&self) -> bool {
        self.current.is_some()
    }
    pub fn matches(&self, id: WindowId) -> bool {
        self.current
            .as_ref()
            .is_some_and(|overlay| overlay.window.id() == id)
    }

    pub fn close(&mut self) {
        self.current = None;
        self.payload = Value::Null;
    }

    pub fn ready(&mut self) {
        if let Some(overlay) = &mut self.current {
            overlay.ready = true;
            overlay.window.set_visible(true);
        }
        self.apply();
    }

    pub fn lock(&mut self, locked: bool) {
        if self.current.is_some() {
            self.payload["clickThrough"] = json!(locked);
            self.apply();
        }
    }

    pub fn move_by(&self, dx: f64, dy: f64) {
        let Some(overlay) = &self.current else { return };
        if self.payload["clickThrough"] != false {
            return;
        }
        if let Ok(position) = overlay.window.outer_position() {
            let scale = overlay.window.scale_factor();
            let pixels = |delta: f64| (delta.clamp(-160.0, 160.0) * scale) as i32;
            overlay.window.set_outer_position(PhysicalPosition::new(
                position.x.saturating_add(pixels(dx)),
                position.y.saturating_add(pixels(dy)),
            ));
        }
    }

    fn apply(&self) {
        if let Some(overlay) = &self.current {
            let _ = overlay
                .window
                .set_ignore_cursor_events(self.payload["clickThrough"] != false);
            if overlay.ready {
                let _ = overlay.view.evaluate_script(&format!(
                    "window.__mineradioLyricsState?.({})",
                    self.payload
                ));
            }
        }
    }
}

fn place(parent: &Window, overlay: &Window, payload: &Value) -> Result<()> {
    let monitor = parent
        .current_monitor()
        .or_else(|| parent.primary_monitor())
        .context("找不到桌面歌词的屏幕")?;
    let area = monitor.size();
    let origin = monitor.position();
    let scale = monitor.scale_factor();
    let width = (920.0 * scale).min(f64::from(area.width) * 0.94);
    let height = (190.0 * scale).min(f64::from(area.height) * 0.5);
    let vertical = payload["y"].as_f64().unwrap_or(0.76).clamp(0.08, 0.92);
    let left = f64::from(origin.x) + (f64::from(area.width) - width) * 0.5;
    let top = f64::from(origin.y)
        + (f64::from(area.height) * vertical - height * 0.5)
            .clamp(0.0, f64::from(area.height) - height);
    overlay.set_inner_size(LogicalSize::new(width / scale, height / scale));
    overlay.set_outer_position(PhysicalPosition::new(
        left.round() as i32,
        top.round() as i32,
    ));
    Ok(())
}
