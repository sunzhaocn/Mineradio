use crate::hotkeys::Hotkeys;
use crate::lyrics_window::{DesktopLyrics, LyricsAction};
use crate::memory::MemoryOptions;
use crate::native_files::{self, NativeFiles};
use crate::profile::{CloseBehavior, Profile};
use crate::single_instance;
use crate::updater::{self, Updater};
use crate::video_export::{RenderMessage, RenderRequest, RenderWindow, Renderer, VideoExport};
use crate::wallpaper_capture::GlassFrames;
use crate::wallpaper_library::WallpaperLibrary;
use crate::wallpaper_runtime::{self, SceneProcess, SceneSurface};
use crate::windows_preferences as preferences;
use anyhow::{Context, Result, bail};
use serde::Deserialize;
use serde_json::{Value, json};
use std::cell::RefCell;
use std::ptr;
use std::rc::Rc;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tao::dpi::LogicalSize;
use tao::event::{Event, WindowEvent};
use tao::event_loop::{ControlFlow, EventLoopBuilder};
use tao::platform::run_return::EventLoopExtRunReturn;
use tao::platform::windows::{EventLoopBuilderExtWindows, WindowBuilderExtWindows};
use tao::window::{Fullscreen, Icon, ResizeDirection, Window, WindowBuilder};
use tokio::net::windows::named_pipe::NamedPipeServer;
use tokio::task::JoinHandle;
use tokio_util::sync::CancellationToken;
use tray_icon::menu::{Menu, MenuEvent, MenuItem};
use tray_icon::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use url::Url;
use windows_sys::Win32::UI::WindowsAndMessaging::MSG;
use wry::WebViewBuilderExtWindows;
use wry::{NewWindowResponse, WebContext, WebView, WebViewBuilder};

#[derive(Deserialize)]
struct Call {
    id: u64,
    method: String,
    #[serde(default)]
    args: Vec<Value>,
}

enum Action {
    Call(Call),
    Show,
    Quit,
    Hotkey(String),
    Lyrics(LyricsAction),
    UpdateState(Value),
    UpdateReady(Result<tempfile::NamedTempFile>),
    Video(RenderRequest),
    VideoMessage(uuid::Uuid, RenderMessage),
    WallpaperReady(u64, Result<SceneProcess>),
    SystemMemory(Option<u64>, Value),
}

fn local_document(uri: &str, origin: &str) -> bool {
    Url::parse(uri).is_ok_and(|url| {
        url.origin().ascii_serialization() == origin && matches!(url.path(), "/" | "/index.html")
    })
}

pub fn run(
    profile: Profile,
    origin: String,
    start_in_tray: bool,
    runtime: tokio::runtime::Handle,
    files: Arc<NativeFiles>,
    wallpaper: Arc<WallpaperLibrary>,
    glasses: Arc<GlassFrames>,
    video: Arc<VideoExport>,
    instance: NamedPipeServer,
) -> Result<(bool, JoinHandle<()>)> {
    let hotkeys = Rc::new(RefCell::new(Hotkeys::default()));
    let registered = Rc::clone(&hotkeys);
    let hotkey_proxy = Rc::new(RefCell::new(
        None::<tao::event_loop::EventLoopProxy<Action>>,
    ));
    let dispatch_proxy = Rc::clone(&hotkey_proxy);
    let mut event_loop = EventLoopBuilder::<Action>::with_user_event()
        .with_msg_hook(move |raw| {
            // Tao passes a pointer to its current Win32 message for this callback.
            let Some(message) = (unsafe { raw.cast::<MSG>().as_ref() }) else {
                return false;
            };
            let action = registered.borrow().dispatched(message);
            if let Some(action) = action {
                if let Some(proxy) = dispatch_proxy.borrow().as_ref() {
                    return proxy.send_event(Action::Hotkey(action)).is_ok();
                }
            }
            false
        })
        .build();
    let proxy = event_loop.create_proxy();
    *hotkey_proxy.borrow_mut() = Some(proxy.clone());
    let icon =
        image::load_from_memory(include_bytes!("../../Windows_exe/assets/icon.png"))?.to_rgba8();
    let (width, height) = icon.dimensions();
    let rgba = icon.into_raw();
    let window = WindowBuilder::new()
        .with_title(if cfg!(feature = "preview") {
            "Mineradio Rust 预览版"
        } else {
            "Mineradio"
        })
        .with_window_icon(Some(Icon::from_rgba(rgba.clone(), width, height)?))
        .with_inner_size(LogicalSize::new(1440.0, 810.0))
        .with_min_inner_size(LogicalSize::new(660.0, 480.0))
        .with_decorations(false)
        .with_undecorated_shadow(false)
        .with_transparent(true)
        .with_visible(false)
        .build(&event_loop)?;
    preferences::hide_native_border(&window);
    let mut window_shape = preferences::MainWindowShape::default();
    window_shape.sync(&window);

    let mut context = WebContext::new(Some(profile.webview_directory()));
    let bridge =
        include_str!("shell.js").replace("__MINERADIO_ORIGIN__", &serde_json::to_string(&origin)?);
    let allowed_origin = origin.clone();
    let message_origin = origin.clone();
    let message_proxy = proxy.clone();
    let builder = WebViewBuilder::new_with_web_context(&mut context)
        .with_url(format!("{origin}/"))
        .with_autoplay(true)
        .with_transparent(true)
        .with_default_context_menus(false)
        .with_navigation_handler(move |url| local_document(&url, &allowed_origin))
        .with_new_window_req_handler(|_, _| NewWindowResponse::Deny)
        .with_initialization_script_for_main_only(bridge, true)
        .with_ipc_handler(move |request| {
            if request.body().len() <= 2 * 1024 * 1024
                && local_document(&request.uri().to_string(), &message_origin)
            {
                if let Ok(call) = serde_json::from_str::<Call>(request.body()) {
                    let _ = message_proxy.send_event(Action::Call(call));
                }
            }
        });
    let mut browser_arguments = String::from(
        "--autoplay-policy=no-user-gesture-required --disable-background-timer-throttling --disable-renderer-backgrounding --disable-backgrounding-occluded-windows",
    );
    if let Ok(cache) = profile.cache_root() {
        let cache = cache.join("webview-cache");
        if let Some(path) = cache.to_str().filter(|value| {
            !value
                .chars()
                .any(|letter| letter.is_control() || letter == '"')
        }) && std::fs::create_dir_all(&cache).is_ok()
        {
            browser_arguments.push_str(&format!(" --disk-cache-dir=\"{path}\""));
        }
    }
    // Debug builds can opt in to a loopback inspector for isolated profiles.
    #[cfg(debug_assertions)]
    if let Some(port) = std::env::var("MINERADIO_TEST_DEVTOOLS_PORT")
        .ok()
        .and_then(|value| value.parse::<u16>().ok())
        .filter(|port| *port >= 1024)
    {
        browser_arguments.push_str(&format!(
            " --remote-debugging-address=127.0.0.1 --remote-debugging-port={port}"
        ));
    }
    let webview = builder
        .with_additional_browser_args(browser_arguments)
        .build(&window)
        .context("无法创建 Mineradio WebView2 窗口")?;

    let menu = Menu::new();
    let open = MenuItem::new("显示 Mineradio", true, None);
    let quit = MenuItem::new("退出", true, None);
    menu.append(&open)?;
    menu.append(&quit)?;
    let open_id = open.id().clone();
    let quit_id = quit.id().clone();
    let menu_proxy = proxy.clone();
    MenuEvent::set_event_handler(Some(move |event: MenuEvent| {
        if event.id == open_id {
            let _ = menu_proxy.send_event(Action::Show);
        } else if event.id == quit_id {
            let _ = menu_proxy.send_event(Action::Quit);
        }
    }));
    let tray_proxy = proxy.clone();
    TrayIconEvent::set_event_handler(Some(move |event| {
        if matches!(
            event,
            TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            }
        ) {
            let _ = tray_proxy.send_event(Action::Show);
        }
    }));
    let tray = TrayIconBuilder::new()
        .with_menu(Box::new(menu))
        .with_tooltip("Mineradio")
        .with_icon(tray_icon::Icon::from_rgba(rgba, width, height)?)
        .with_menu_on_left_click(false)
        .build()?;

    let mut close_behavior = profile.settings().close_behavior;
    let mut started = false;
    let mut show_on_ready = false;
    let updater = Arc::new(Updater::default());
    let mut lyrics = DesktopLyrics::default();
    let mut memory = MemoryOptions::default();
    let mut restart = false;
    let mut selected_cache = None;
    let sender = proxy.clone();
    let renderer: Renderer = Arc::new(move |request| {
        sender
            .send_event(Action::Video(request))
            .map_err(|_| anyhow::anyhow!("视频窗口已结束"))
    });
    let mut export_window: Option<RenderWindow> = None;
    let mut scene: Option<SceneSurface> = None;
    let mut loading_scene: Option<(u64, String, CancellationToken)> = None;
    let activation_proxy = proxy.clone();
    let activation = runtime.spawn(async move {
        if let Err(error) = single_instance::listen(instance, || {
            activation_proxy.send_event(Action::Show).is_ok()
        })
        .await
        {
            eprintln!("Mineradio 启动通道已停止: {error}");
        }
    });
    let exit_code = event_loop.run_return(|event, target, control| {
        let surface_deadline = scene.is_some().then(|| Instant::now() + Duration::from_millis(45));
        *control = memory.next_attempt().into_iter().chain(surface_deadline).min()
            .map_or(ControlFlow::Wait, ControlFlow::WaitUntil);
        match event {
            Event::UserEvent(Action::Call(call)) => {
                if call.method == "startWallpaperScene" {
                    let id = call.args.first().and_then(|query| query["id"].as_str()).unwrap_or_default();
                    if !window.is_visible() || window.is_minimized()
                        || id.len() != 24 || !id.bytes().all(|byte| byte.is_ascii_hexdigit()) {
                        respond(&webview,call.id,Err(anyhow::anyhow!("WALLPAPER_ENGINE_HOST_HIDDEN")));
                        return;
                    }
                    if let Some((pending,_,cancel)) = loading_scene.take() {
                        cancel.cancel();
                        respond(&webview,pending,Err(anyhow::anyhow!("WALLPAPER_ENGINE_START_SUPERSEDED")));
                    }
                    scene = None;
                    let project = id.to_owned();
                    let session = uuid::Uuid::new_v4().simple().to_string()[..24].to_owned();
                    let cancel = CancellationToken::new();
                    loading_scene = Some((call.id,session.clone(),cancel.clone()));
                    let bounds = wallpaper_runtime::bounds(&window);
                    let library = Arc::clone(&wallpaper);
                    let sender = proxy.clone();
                    runtime.spawn_blocking(move || {
                        let result = SceneProcess::launch(&library,session,&project,bounds,cancel);
                        let _ = sender.send_event(Action::WallpaperReady(call.id,result));
                    });
                    return;
                }
                if call.method == "memoryPurge" {
                    let request = call.args.first().unwrap_or(&Value::Null);
                    let foreground = window.is_visible() && !window.is_minimized();
                    let manual = request["manual"] == true;
                    match memory.manual(request, foreground && !manual) {
                        Ok(job) => {
                            if foreground {
                                window.set_minimized(true);
                                push_state(&window, &webview, &mut window_shape);
                            }
                            let sender = proxy.clone();
                            runtime.spawn_blocking(move || {
                                let _ = sender.send_event(Action::SystemMemory(Some(call.id),job.run()));
                            });
                        }
                        Err(status) => respond(&webview,call.id,Ok(status)),
                    }
                    return;
                }
                let result = match call.method.as_str() {
                    "memorySnapshot" => memory.status(),
                    "memoryConfigure" => Ok(memory.configure(call.args.first().unwrap_or(&Value::Null))),
                    "memoryTrim" => memory.trim(call.args.first().and_then(|value| value["reason"].as_str()).unwrap_or("renderer"),
                        window.is_visible() && !window.is_minimized()),
                    "chooseVideo" => {
                        let current = video.state();
                        if matches!(current["status"].as_str(),Some("preparing" | "rendering" | "encoding" | "canceling")) {
                            Ok(json!({"ok":false,"error":"已有视频正在导出"}))
                        } else {
                            let raw = call.args.first().and_then(Value::as_str).unwrap_or_default();
                            let name = native_files::safe_name(raw,"Mineradio.mp4");
                            match preferences::video_destination(&window,&name) {
                                Some(path) => video.reserve(path),
                                None => Ok(json!({"ok":false,"canceled":true})),
                            }
                        }
                    }
                    "videoStart" => video.start(call.args.first().and_then(Value::as_str).unwrap_or_default(),&runtime,Arc::clone(&renderer)),
                    "videoState" => Ok(video.state()),
                    "videoCancel" => Ok(video.cancel()),
                    "chooseWallpaperDirectory" => {
                        match preferences::choose_folder(&window,&profile.root,"选择 Wallpaper Engine 项目目录") {
                            Some(path) => wallpaper.add_directory(&path),
                            None => Ok(json!({"ok":false,"canceled":true})),
                        }
                    }
                    "chooseWallpaperFile" => {
                        match preferences::choose_wallpaper_file(&window) {
                            Some(path) => wallpaper.add_file(&path),
                            None => Ok(json!({"ok":false,"canceled":true})),
                        }
                    }
                    "removeWallpaperDirectory" => {
                        wallpaper.remove(call.args.first().and_then(Value::as_str).unwrap_or_default())
                    }
                    "wallpaperRuntimeStatus" => Ok(scene.as_ref().map_or_else(
                        || json!({"ok":true,"available":wallpaper_runtime::executable().is_some(),"active":false}),
                        SceneSurface::status,
                    )),
                    "wallpaperGlassPrepare" => {
                        let payload = call.args.first().unwrap_or(&Value::Null);
                        let id = payload["sessionId"].as_str().unwrap_or_default();
                        match scene.as_mut().filter(|scene| scene.id() == id) {
                            Some(scene) => scene.start_glass(Arc::clone(&glasses),payload["fps"].as_u64().unwrap_or(24)),
                            None => Err(anyhow::anyhow!("WALLPAPER_ENGINE_START_SUPERSEDED")),
                        }
                    }
                    "wallpaperGlassVisibility" => {
                        let payload = call.args.first().unwrap_or(&Value::Null);
                        let id = payload["sessionId"].as_str().unwrap_or_default();
                        if let Some(scene) = scene.as_mut().filter(|scene| scene.id() == id) {
                            scene.show_glass(payload["visible"].as_bool().unwrap_or(payload["active"] == true));
                        }
                        Ok(Value::Null)
                    }
                    "wallpaperAppearance" => {
                        let query = call.args.first().unwrap_or(&Value::Null);
                        let session = query["sessionId"].as_str().unwrap_or_default();
                        Ok(scene.as_mut().filter(|scene| scene.id() == session)
                            .map_or(Value::Null, |scene| scene.visual_settings(query)))
                    }
                    "wallpaperCaptureResult" | "wallpaperActivate" => {
                        let payload = call.args.first().unwrap_or(&Value::Null);
                        let id = payload["sessionId"].as_str().unwrap_or_default();
                        let accepted = scene.as_ref().is_some_and(|scene| scene.id() == id);
                        let mut ready = false;
                        if accepted {
                            if call.method == "wallpaperActivate" || payload["ok"] == true {
                                ready = scene.as_mut().is_some_and(|scene| scene.acknowledge(&window));
                            } else {
                                scene = None;
                            }
                        }
                        Ok(json!({"ok":accepted,"accepted":accepted,"captureReady":ready,"active":ready}))
                    }
                    "stopWallpaperScene" => {
                        let query = call.args.first().unwrap_or(&Value::Null);
                        let session = query["sessionId"].as_str().unwrap_or_default();
                        let all = query["all"] == true;
                        if all || scene.as_ref().is_some_and(|scene| scene.id() == session) {
                            scene = None;
                        }
                        if all || loading_scene.as_ref().is_some_and(|(_,id,_)| id == session) {
                            if let Some((pending,_,cancel)) = loading_scene.take() {
                                cancel.cancel();
                                respond(&webview,pending,Err(anyhow::anyhow!("WALLPAPER_ENGINE_START_SUPERSEDED")));
                            }
                        }
                        Ok(json!({"ok":true}))
                    }
                    "openWallpaperDetails" => {
                        let id = call.args.first().and_then(Value::as_str).unwrap_or_default();
                        wallpaper.workshop_id(id).and_then(|workshop| {
                            let url = format!("https://steamcommunity.com/sharedfiles/filedetails/?id={workshop}");
                            preferences::open_external(&window,&url)?;
                            Ok(json!({"ok":true,"opened":"workshop","fallback":call.args.get(1).is_some_and(|target|target == "we")}))
                        })
                    }
                    "chooseCache" => {
                        let root = profile.cache_root().unwrap_or_else(|_| profile.root.join("cache"));
                        selected_cache = preferences::choose_folder(&window,&root,"选择 Mineradio 缓存目录");
                        Ok(match &selected_cache {
                            Some(path) => json!({"ok":true,"rootPath":path}),
                            None => json!({"ok":false,"canceled":true}),
                        })
                    }
                    "setCache" => {
                        let path = call.args.first().and_then(Value::as_str);
                        match selected_cache.take().filter(|selected| path.is_some_and(|path| std::path::Path::new(path) == selected)) {
                            Some(path) => profile.save_cache_root(&path).map(|()| json!({"ok":true})),
                            None => Err(anyhow::anyhow!("请先选择缓存目录")),
                        }
                    }
                    "openSlides" => preferences::open_folder(&window,&files.slideshow_directory()),
                    "chooseExport" => {
                        let is_json = call.args.get(1).is_some_and(|value| value == true);
                        let name = call.args.first().and_then(Value::as_str).unwrap_or_default();
                        let name = native_files::safe_name(name,"Mineradio-export");
                        Ok(match preferences::export_destination(&window,&name,is_json) {
                            Some(path) => files.reserve_export(path),
                            None => json!({"ok":false,"canceled":true}),
                        })
                    }
                    "importJson" => preferences::import_json(&window),
                    "openUpdatePage" => preferences::open_external(&window,call.args.first().and_then(Value::as_str).unwrap_or_default()),
                    "setStartup" => {
                        if profile.standard {
                            call.args.first().and_then(Value::as_bool).context("自启动值无效").and_then(preferences::set_startup)
                        } else {
                            Ok(json!({"ok":false,"supported":false,"enabled":false}))
                        }
                    }
                    "restartApp" => {
                        restart = true;
                        *control = ControlFlow::Exit;
                        Ok(json!({"ok":true}))
                    }
                    "configureHotkeys" => Ok(hotkeys
                        .borrow_mut()
                        .configure(call.args.first().unwrap_or(&Value::Null))),
                    "lyricsEnabled" | "lyricsUpdate" => {
                        let explicit = call.method == "lyricsEnabled";
                        let payload = call.args.get(usize::from(explicit)).unwrap_or(&Value::Null);
                        let enabled = if explicit {
                            call.args.first().and_then(Value::as_bool).unwrap_or(false)
                        } else {
                            payload["enabled"]
                                .as_bool()
                                .unwrap_or_else(|| lyrics.enabled())
                        };
                        let proxy = proxy.clone();
                        let setup = lyrics.set(
                            enabled,
                            payload,
                            &origin,
                            &window,
                            target,
                            &webview,
                            move |message| {
                                let _ = proxy.send_event(Action::Lyrics(message));
                            },
                        );
                        if explicit && setup.is_ok() {
                            notify(&webview, "lyricsEnabled", &json!({"enabled":enabled}));
                        }
                        setup.map(|()| json!({"ok":true}))
                    }
                    "updateState" => Ok(updater.state()),
                    "updateCheck" => {
                        if updater.request_check() {
                            let updater = Arc::clone(&updater);
                            let proxy = proxy.clone();
                            runtime.spawn(async move {
                                updater.check().await;
                                let _ = proxy.send_event(Action::UpdateState(updater.state()));
                            });
                        }
                        Ok(updater.state())
                    }
                    "updateDownload" => {
                        if let Some(release) = updater.request_download() {
                            let updater = Arc::clone(&updater);
                            let proxy = proxy.clone();
                            runtime.spawn(async move {
                                let result = updater
                                    .download(release, |value| {
                                        let _ = proxy.send_event(Action::UpdateState(value));
                                    })
                                    .await;
                                let _ = proxy.send_event(Action::UpdateReady(result));
                            });
                        }
                        Ok(updater.state())
                    }
                    "ready" => {
                        if !started {
                            started = true;
                            if show_on_ready {
                                restore(&window);
                            } else if !start_in_tray {
                                window.set_visible(true);
                            }
                        }
                        Ok(window_state(&window))
                    }
                    "close" => {
                        if let Some(behavior) = behavior_arg(call.args.first()) {
                            let _ = profile.save_close_behavior(behavior);
                            close_behavior = behavior;
                        }
                        close_window(&window, close_behavior, control);
                        Ok(json!({"ok":true,"behavior":close_behavior}))
                    }
                    "setCloseBehavior" => behavior_arg(call.args.first())
                        .context("关闭选项无效")
                        .and_then(|behavior| {
                            profile.save_close_behavior(behavior)?;
                            close_behavior = behavior;
                            Ok(json!({"ok":true,"behavior":behavior}))
                        }),
                    "getCloseBehavior" => Ok(json!({"behavior":close_behavior})),
                    "preferences" => Ok(
                        json!({"closeBehavior":close_behavior,"supported":profile.standard,"enabled":profile.standard && preferences::startup_enabled(),
                            "trayAvailable":true,"startInTray":start_in_tray}),
                    ),
                    _ => command(&window, &call),
                };
                respond(&webview, call.id, result);
                if matches!(
                    call.method.as_str(),
                    "ready"
                        | "minimize"
                        | "restore"
                        | "toggleMaximize"
                        | "toggleFullscreen"
                        | "exitFullscreenWindowed"
                        | "close"
                ) {
                    push_state(&window, &webview, &mut window_shape);
                }
            }
            Event::UserEvent(Action::Show) => {
                if !started {
                    show_on_ready = true;
                    return;
                }
                restore(&window);
                push_state(&window, &webview, &mut window_shape);
            }
            Event::UserEvent(Action::Quit) => *control = ControlFlow::Exit,
            Event::UserEvent(Action::WallpaperReady(call, result)) => {
                if loading_scene.as_ref().is_some_and(|(pending,_,_)| pending == &call) {
                    loading_scene = None;
                    let result = result.and_then(|process| {
                        let surface = SceneSurface::open(process, target)?;
                        let status = surface.status();
                        scene = Some(surface);
                        Ok(status)
                    });
                    respond(&webview,call,result);
                }
            }
            Event::UserEvent(Action::Video(request)) => match request {
                RenderRequest::Open { id,url,width,height,ready } => {
                    let sender = proxy.clone();
                    export_window = RenderWindow::open(target,&webview,id,url,
                        tao::dpi::PhysicalSize::new(width,height),ready,move |message| {
                            let _ = sender.send_event(Action::VideoMessage(id,message));
                        }).ok();
                }
                RenderRequest::Draw { id,time,samples,frame,preset,result } => {
                    if let Some(window) = export_window.as_mut().filter(|window| window.id == id) {
                        window.draw(frame,time,&samples,preset,result);
                    } else {
                        let _ = result.send(Err(anyhow::anyhow!("视频渲染窗口已关闭")));
                    }
                }
                RenderRequest::Close(id) => {
                    if export_window.as_ref().is_some_and(|window| window.id == id) {
                        export_window = None;
                    }
                }
            },
            Event::UserEvent(Action::VideoMessage(id,message)) => {
                if let Some(window) = export_window.as_mut().filter(|window| window.id == id) {
                    window.message(message);
                }
            }
            Event::UserEvent(Action::Hotkey(action)) => {
                notify(&webview, "hotkey", &json!({"action":action}))
            }
            Event::UserEvent(Action::Lyrics(action)) => match action {
                LyricsAction::Ready => lyrics.ready(),
                LyricsAction::Close => {
                    lyrics.close();
                    notify(&webview, "lyricsEnabled", &json!({"enabled":false}));
                }
                LyricsAction::Lock(locked) => {
                    lyrics.lock(locked);
                    notify(&webview, "lyricsLock", &json!({"locked":locked}));
                }
                LyricsAction::Move([x, y]) => lyrics.move_by(x, y),
            },
            Event::UserEvent(Action::UpdateState(state)) => {
                push_update(&webview, &state);
            }
            Event::UserEvent(Action::UpdateReady(package)) => {
                let installed = package.and_then(updater::install).is_ok();
                push_update(&webview, &updater.finish(installed));
                if installed {
                    *control = ControlFlow::Exit;
                }
            }
            Event::WindowEvent {
                event, window_id, ..
            } if window_id == window.id() => match event {
                WindowEvent::CloseRequested => {
                    close_window(&window, close_behavior, control);
                }
                WindowEvent::Focused(_) | WindowEvent::ScaleFactorChanged { .. } => {
                    preferences::hide_native_border(&window);
                    push_state(&window, &webview, &mut window_shape);
                }
                WindowEvent::Moved(_) | WindowEvent::Resized(_) => {
                    push_state(&window, &webview, &mut window_shape)
                }
                _ => {}
            },
            Event::WindowEvent {
                event: WindowEvent::CloseRequested,
                window_id,
                ..
            } if lyrics.matches(window_id) => {
                lyrics.close();
                notify(&webview, "lyricsEnabled", &json!({"enabled":false}));
            }
            Event::UserEvent(Action::SystemMemory(call, result)) => {
                let report = memory.finished(result, call.is_none());
                if let Some(call) = call {
                    respond(&webview,call,report);
                }
            }
            Event::MainEventsCleared => {
                if scene.as_mut().is_some_and(|item| !item.sync(&window)) {
                    scene = None;
                    notify(&webview,"wallpaperBounds",&json!({"phase":"prepare","reason":"source-closed"}));
                }
                let foreground = window.is_visible() && !window.is_minimized();
                memory.background_trim(foreground);
                if let Some(job) = memory.automatic(foreground) {
                    let sender = proxy.clone();
                    runtime.spawn_blocking(move || {
                        let _ = sender.send_event(Action::SystemMemory(None,job.run()));
                    });
                }
                *control = memory.next_attempt().into_iter().chain(surface_deadline).min()
                    .map_or(ControlFlow::Wait, ControlFlow::WaitUntil);
            }
            _ => {}
        }
    });
    hotkeys.borrow_mut().clear();
    video.cancel();
    if let Some((_, _, cancel)) = loading_scene {
        cancel.cancel();
    }
    drop(scene);
    drop(export_window);
    drop(lyrics);
    drop(webview);
    drop(tray);
    anyhow::ensure!(exit_code == 0, "Mineradio 窗口异常关闭");
    Ok((restart, activation))
}

fn restore(window: &Window) {
    window.set_visible(true);
    if window.is_minimized() {
        window.set_minimized(false);
    }
    preferences::hide_native_border(window);
    window.set_focus();
}

fn close_window(window: &Window, choice: CloseBehavior, control: &mut ControlFlow) {
    if choice == CloseBehavior::Exit {
        *control = ControlFlow::Exit;
    } else {
        window.set_visible(false);
    }
}

fn behavior_arg(value: Option<&Value>) -> Option<CloseBehavior> {
    match value?.as_str()? {
        "tray" => Some(CloseBehavior::Tray),
        "exit" => Some(CloseBehavior::Exit),
        _ => None,
    }
}

fn command(window: &Window, call: &Call) -> Result<Value> {
    match call.method.as_str() {
        "state" => {}
        "minimize" => window.set_minimized(true),
        "restore" => restore(window),
        "toggleMaximize" => {
            window.set_maximized(!window.is_maximized());
            preferences::hide_native_border(window);
        }
        "toggleFullscreen" => {
            if window.fullscreen().is_some() {
                window.set_fullscreen(None);
            } else {
                window.set_fullscreen(Some(Fullscreen::Borderless(window.current_monitor())));
            }
            preferences::hide_native_border(window);
        }
        "exitFullscreenWindowed" => {
            window.set_fullscreen(None);
            window.set_maximized(false);
            preferences::hide_native_border(window);
        }
        "dragWindow" => {
            if window.fullscreen().is_none() && window.is_visible() && !window.is_minimized() {
                window.drag_window()?;
            }
        }
        "resizeWindow" => {
            if window.fullscreen().is_none()
                && window.is_visible()
                && !window.is_minimized()
                && !window.is_maximized()
            {
                let direction = match call.args.first().and_then(Value::as_str) {
                    Some("n") => ResizeDirection::North,
                    Some("ne") => ResizeDirection::NorthEast,
                    Some("e") => ResizeDirection::East,
                    Some("se") => ResizeDirection::SouthEast,
                    Some("s") => ResizeDirection::South,
                    Some("sw") => ResizeDirection::SouthWest,
                    Some("w") => ResizeDirection::West,
                    Some("nw") => ResizeDirection::NorthWest,
                    _ => bail!("窗口缩放方向无效"),
                };
                window.drag_resize_window(direction)?;
            }
        }
        _ => bail!("Mineradio 桌面方法不可用"),
    }
    Ok(window_state(window))
}

fn window_state(window: &Window) -> Value {
    let full = window.fullscreen().is_some();
    let current = window.current_monitor();
    let primary = window.primary_monitor();
    let left = current.as_ref().is_some_and(|monitor| {
        window
            .available_monitors()
            .any(|other| other.position().x < monitor.position().x)
    });
    let right = current.as_ref().is_some_and(|monitor| {
        window
            .available_monitors()
            .any(|other| other.position().x > monitor.position().x)
    });
    let bounds = current.as_ref().map(|monitor| {
        let pos = monitor.position();
        let size = monitor.size();
        let scale = monitor.scale_factor();
        json!({"x": pos.x as f64 / scale, "y": pos.y as f64 / scale,
            "width": size.width as f64 / scale, "height": size.height as f64 / scale})
    });
    json!({
        "isVisible": window.is_visible(), "isMinimized": window.is_minimized(), "isFocused": window.is_focused(),
        "isMaximized": window.is_maximized(), "isFullScreen": full, "isNativeFullScreen": full,
        "isWindowFullScreen": full, "isHtmlFullScreen": false,
        "isPrimaryDisplay": current == primary, "hasDisplayOnLeft":left,"hasDisplayOnRight":right,"displayBounds":bounds,
    })
}

fn push_state(window: &Window, webview: &WebView, window_shape: &mut preferences::MainWindowShape) {
    window_shape.sync(window);
    let _ = webview.evaluate_script(&format!(
        "window.__mineradioDesktopState?.({})",
        window_state(window)
    ));
}

fn push_update(webview: &WebView, state: &Value) {
    let _ = webview.evaluate_script(&format!("window.__mineradioUpdateState?.({state})"));
}

fn notify(webview: &WebView, event: &str, payload: &Value) {
    let _ = webview.evaluate_script(&format!(
        "window.__mineradioDesktopEvent?.({event:?},{payload})"
    ));
}

fn respond(webview: &WebView, id: u64, result: Result<Value>) {
    let (value, error) = match result {
        Ok(value) => (value, Value::Null),
        Err(error) => (Value::Null, json!(error.to_string())),
    };
    let _ = webview.evaluate_script(&format!(
        "window.__mineradioDesktopReply?.({id},{value},{error})"
    ));
}

pub fn startup_error(description: &str) {
    use windows_sys::Win32::UI::WindowsAndMessaging::{MB_ICONERROR, MB_OK, MessageBoxW};
    let text: Vec<u16> = description.encode_utf16().chain(Some(0)).collect();
    let title: Vec<u16> = "Mineradio".encode_utf16().chain(Some(0)).collect();
    // Both buffers remain allocated until the synchronous dialog returns.
    unsafe {
        MessageBoxW(
            ptr::null_mut(),
            text.as_ptr(),
            title.as_ptr(),
            MB_OK | MB_ICONERROR,
        );
    }
}
