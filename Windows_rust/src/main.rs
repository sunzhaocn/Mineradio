#![cfg_attr(all(windows, not(debug_assertions)), windows_subsystem = "windows")]

mod accounts;
mod api;
mod assets;
mod auth;
mod charts;
mod cloud;
mod comments;
mod library;
mod media;
mod music_video;
mod native_files;
mod profile;
mod protected_audio;
mod providers;
mod tools;
#[cfg(windows)]
mod video_export;
mod wallpaper_library;

#[cfg(windows)]
mod hotkeys;
#[cfg(windows)]
mod lyrics_window;
#[cfg(windows)]
mod memory;
#[cfg(windows)]
mod migration;
#[cfg(windows)]
mod shell;
#[cfg(windows)]
mod single_instance;
#[cfg(windows)]
mod updater;
#[cfg(windows)]
mod wallpaper_capture;
#[cfg(windows)]
mod wallpaper_runtime;
#[cfg(windows)]
mod windows_preferences;

use anyhow::{Context, Result, bail};
use profile::{Ports, Profile};
use std::net::Ipv4Addr;
use std::path::PathBuf;
use std::sync::Arc;

struct Options {
    profile: Option<PathBuf>,
    port: Option<u16>,
    headless: bool,
    start_in_tray: bool,
}

fn arguments() -> Result<Options> {
    let mut options = Options {
        profile: None,
        port: None,
        headless: false,
        start_in_tray: false,
    };
    let mut args = std::env::args_os().skip(1);
    while let Some(arg) = args.next() {
        match arg.to_str() {
            Some("--profile") => {
                options.profile = Some(args.next().context("--profile 需要资料目录")?.into())
            }
            Some("--port") => {
                let value = args.next().context("--port 需要端口号")?;
                options.port = Some(
                    value
                        .to_str()
                        .context("端口无效")?
                        .parse()
                        .context("端口无效")?,
                );
            }
            Some("--headless") => options.headless = true,
            Some("--start-in-tray") => options.start_in_tray = true,
            _ => bail!("未知的 Mineradio 启动选项"),
        }
    }
    Ok(options)
}

fn launch() -> Result<()> {
    let config = arguments()?;
    let profile = Profile::open(config.profile)?;
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()?;
    #[cfg(windows)]
    let instance = if config.headless {
        None
    } else {
        let Some(server) =
            runtime.block_on(single_instance::claim(&profile.root, !config.start_in_tray))?
        else {
            return Ok(());
        };
        Some(server)
    };
    let ports = profile.ports()?;
    let port = config
        .port
        .or_else(|| ports.as_ref().map(|ports| ports.web))
        .unwrap_or(if cfg!(feature = "preview") {
            18218
        } else {
            18180
        });
    let listener = runtime
        .block_on(tokio::net::TcpListener::bind((Ipv4Addr::LOCALHOST, port)))
        .with_context(|| format!("本机端口 {port} 正在使用，无法启动 Mineradio"))?;
    let port = listener.local_addr()?.port();
    if config.port.is_none() && ports.is_none() {
        profile.save_ports(&Ports {
            web: port,
            api: if port == 18100 { 18101 } else { 18100 },
        })?;
    }
    let origin = format!("http://127.0.0.1:{port}");
    let state = Arc::new(api::AppState::new(profile.clone(), origin.clone())?);
    if config.headless {
        println!("{origin}");
        runtime.block_on(async move { axum::serve(listener, api::router(state)).await })?;
        return Ok(());
    }
    #[cfg(windows)]
    {
        migration::prepare(&profile)?;
        let files = Arc::clone(&state.files);
        let wallpaper = Arc::clone(&state.wallpaper);
        let glasses = Arc::clone(&state.glasses);
        let video = Arc::clone(&state.video);
        let service = runtime.spawn(async move {
            if let Err(error) = axum::serve(listener, api::router(state)).await {
                eprintln!("Mineradio 本地服务已停止: {error}");
            }
        });
        let (restart, activation) = shell::run(
            profile,
            origin,
            config.start_in_tray,
            runtime.handle().clone(),
            files,
            wallpaper,
            glasses,
            video,
            instance.expect("desktop launch owns its instance"),
        )?;
        service.abort();
        let _ = runtime.block_on(service);
        activation.abort();
        let _ = runtime.block_on(activation);
        if restart {
            std::process::Command::new(std::env::current_exe()?)
                .args(
                    std::env::args_os()
                        .skip(1)
                        .filter(|arg| arg != "--start-in-tray"),
                )
                .spawn()?;
        }
        Ok(())
    }
    #[cfg(not(windows))]
    bail!("Mineradio 桌面界面需要 Windows")
}

fn main() {
    #[cfg(windows)]
    if let Some(code) = memory::helper() {
        std::process::exit(code);
    }
    if let Err(error) = launch() {
        eprintln!("{error:#}");
        #[cfg(windows)]
        if !std::env::args_os().any(|arg| arg == "--headless") {
            shell::startup_error(&error.to_string());
        }
        std::process::exit(1);
    }
}
