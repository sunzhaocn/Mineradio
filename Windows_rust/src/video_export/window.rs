use anyhow::{Context, Result, ensure};
use base64::{Engine, engine::general_purpose::STANDARD};
use serde::Deserialize;
use serde_json::{Value, json};
use tao::{
    dpi::{PhysicalPosition, PhysicalSize},
    event_loop::EventLoopWindowTarget,
    platform::windows::WindowBuilderExtWindows,
    window::{Window, WindowBuilder},
};
use tokio::sync::oneshot;
use uuid::Uuid;
use webview2_com::CallDevToolsProtocolMethodCompletedHandler;
use windows_core::{HSTRING, PCWSTR, w};
use wry::{
    NewWindowResponse, WebView, WebViewBuilder, WebViewBuilderExtWindows, WebViewExtWindows,
};

pub struct RenderWindow {
    pub id: Uuid,
    webview: WebView,
    _window: Window,
    ready: Option<oneshot::Sender<Result<()>>>,
    pending: Option<Frame>,
}

struct Frame {
    sequence: u64,
    preset: u64,
    reply: oneshot::Sender<Result<Vec<u8>>>,
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum RenderMessage {
    Ready {
        error: Option<String>,
    },
    Drawn {
        sequence: u64,
        preset: Option<u64>,
        error: Option<String>,
    },
}

impl RenderWindow {
    pub fn open<T: 'static>(
        target: &EventLoopWindowTarget<T>,
        parent: &WebView,
        id: Uuid,
        url: String,
        size: PhysicalSize<u32>,
        ready: oneshot::Sender<Result<()>>,
        on_message: impl Fn(RenderMessage) + 'static,
    ) -> Result<Self> {
        let window = WindowBuilder::new()
            .with_title("Mineradio Video Export")
            .with_decorations(false)
            .with_resizable(false)
            .with_focusable(false)
            .with_visible(true)
            .with_skip_taskbar(true)
            .with_position(PhysicalPosition::new(-30_000, -30_000))
            .with_inner_size(size)
            .build(target)?;
        let expected_page = url.clone();
        let source = url.clone();
        let webview = WebViewBuilder::new()
            .with_environment(parent.environment())
            .with_incognito(true)
            .with_url(url)
            .with_navigation_handler(move |url| url == expected_page)
            .with_new_window_req_handler(|_, _| NewWindowResponse::Deny)
            .with_initialization_script_for_main_only(include_str!("render.js"), true)
            .with_ipc_handler(move |request| {
                if request.uri().to_string() == source
                    && request.body().len() <= 4096
                    && let Ok(message) = serde_json::from_str::<RenderMessage>(request.body())
                {
                    on_message(message);
                }
            })
            .build(&window)
            .context("无法创建离线视频渲染窗口")?;
        let metrics =
            json!({"width":size.width,"height":size.height,"deviceScaleFactor":1,"mobile":false});
        let handler = CallDevToolsProtocolMethodCompletedHandler::create(Box::new(|_, _| Ok(())));
        let payload = HSTRING::from(metrics.to_string());
        unsafe {
            webview.webview().CallDevToolsProtocolMethod(
                w!("Emulation.setDeviceMetricsOverride"),
                PCWSTR(payload.as_ptr()),
                &handler,
            )?;
        }
        Ok(Self {
            id,
            webview,
            _window: window,
            ready: Some(ready),
            pending: None,
        })
    }

    pub fn draw(
        &mut self,
        sequence: u64,
        time: f64,
        samples: &str,
        preset: u64,
        reply: oneshot::Sender<Result<Vec<u8>>>,
    ) {
        let setup = self.pending.is_none().then(|| {
            let samples = serde_json::to_string(samples).expect("sample string");
            self.webview.evaluate_script(&format!(
                "window.__mineradioDrawVideoFrame?.({sequence},{time},{samples})"
            ))
        });
        if matches!(setup, Some(Ok(()))) {
            self.pending = Some(Frame {
                sequence,
                preset,
                reply,
            });
        } else {
            let _ = reply.send(Err(anyhow::anyhow!("无法开始绘制视频画面")));
        }
    }

    pub fn message(&mut self, message: RenderMessage) {
        match message {
            RenderMessage::Ready { error } => {
                if let Some(reply) = self.ready.take() {
                    let _ = reply.send(match error {
                        Some(error) => {
                            Err(anyhow::anyhow!("预设初始化失败 · {}", safe_error(&error)))
                        }
                        None => Ok(()),
                    });
                }
            }
            RenderMessage::Drawn {
                sequence,
                preset,
                error,
            } => {
                if self
                    .pending
                    .as_ref()
                    .is_none_or(|frame| frame.sequence != sequence)
                {
                    return;
                }
                let frame = self.pending.take().expect("current frame");
                if let Some(error) = error {
                    let _ = frame.reply.send(Err(anyhow::anyhow!(
                        "无法生成视频画面 · {}",
                        safe_error(&error)
                    )));
                } else if Some(frame.preset) != preset {
                    let _ = frame
                        .reply
                        .send(Err(anyhow::anyhow!("导出时视觉预设已变化")));
                } else {
                    self.capture(frame.reply);
                }
            }
        }
    }

    fn capture(&self, reply: oneshot::Sender<Result<Vec<u8>>>) {
        let responder =
            CallDevToolsProtocolMethodCompletedHandler::create(Box::new(move |result, text| {
                let frame = (|| {
                    result.context("读取视频画面失败")?;
                    ensure!(text.len() <= 32 * 1024 * 1024, "视频画面过大");
                    let value: Value = serde_json::from_str(&text)?;
                    let coded = value["data"].as_str().context("视频画面数据无效")?;
                    let png = STANDARD.decode(coded)?;
                    ensure!(png.starts_with(b"\x89PNG\r\n\x1a\n"), "视频画面数据无效");
                    Ok(png)
                })();
                let _ = reply.send(frame);
                Ok(())
            }));
        let _ = unsafe {
            self.webview.webview().CallDevToolsProtocolMethod(
                w!("Page.captureScreenshot"),
                w!(r#"{"format":"png","fromSurface":true,"captureBeyondViewport":false}"#),
                &responder,
            )
        };
    }
}

fn safe_error(error: &str) -> String {
    error
        .chars()
        .filter(|ch| !ch.is_control())
        .take(180)
        .collect()
}
