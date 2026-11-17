mod window;

use crate::{assets, media, tools};
use anyhow::{Context, Result, ensure};
use axum::{
    Json, Router,
    body::Body,
    extract::{Request, State},
    http::{HeaderValue, Method, StatusCode, header},
    response::{IntoResponse, Response},
};
use base64::{Engine, engine::general_purpose::STANDARD};
use futures_util::StreamExt;
use serde_json::{Value, json};
use std::net::Ipv4Addr;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tokio::io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt, SeekFrom};
use tokio::sync::oneshot;
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

pub use window::{RenderMessage, RenderWindow};

const MAX_MEDIA: usize = 512 * 1024 * 1024;
const MAX_CONFIG: usize = 128 * 1024 * 1024;
const SDL_TIMEOUT: Duration = Duration::from_secs(120);

pub enum RenderRequest {
    Open {
        id: Uuid,
        url: String,
        width: u32,
        height: u32,
        ready: oneshot::Sender<Result<()>>,
    },
    Draw {
        id: Uuid,
        time: f64,
        samples: String,
        frame: u64,
        preset: u64,
        result: oneshot::Sender<Result<Vec<u8>>>,
    },
    Close(Uuid),
}

pub type Renderer = Arc<dyn Fn(RenderRequest) -> Result<()> + Send + Sync>;

#[derive(Default)]
pub struct VideoExport {
    state: Mutex<StateData>,
}

#[derive(Default)]
struct StateData {
    job: Option<Arc<Job>>,
    latest: Option<Value>,
}

struct Job {
    id: Uuid,
    destination: PathBuf,
    workspace: tempfile::TempDir,
    started: Instant,
    cancel: CancellationToken,
    active: std::sync::atomic::AtomicBool,
    upload: tokio::sync::Mutex<()>,
}

impl VideoExport {
    pub fn state(&self) -> Value {
        self.state
            .lock()
            .expect("video export state poisoned")
            .latest
            .clone()
            .unwrap_or_else(|| json!({"status":"idle","progress":0}))
    }

    pub fn reserve(&self, destination: PathBuf) -> Result<Value> {
        let mut state = self.state.lock().expect("video export state poisoned");
        ensure!(
            state.job.as_ref().is_none_or(|job| {
                !job.active.load(std::sync::atomic::Ordering::Acquire)
                    && job.started.elapsed() > Duration::from_secs(300)
            }),
            "已有视频正在导出，请等待或取消"
        );
        let parent = destination.parent().context("视频保存目录无效")?;
        let workspace = tempfile::Builder::new()
            .prefix("mineradio-export-")
            .tempdir_in(parent)?;
        let id = Uuid::new_v4();
        state.job = Some(Arc::new(Job {
            id,
            destination,
            workspace,
            started: Instant::now(),
            cancel: CancellationToken::new(),
            active: std::sync::atomic::AtomicBool::new(false),
            upload: tokio::sync::Mutex::new(()),
        }));
        state.latest = Some(json!({"status":"preparing","jobId":id.to_string(),"progress":0}));
        Ok(json!({"ok":true,"jobId":id.to_string()}))
    }

    pub fn cancel(&self) -> Value {
        let mut state = self.state.lock().expect("video export state poisoned");
        if let Some(job) = &state.job {
            job.cancel.cancel();
            if job.active.load(std::sync::atomic::Ordering::Acquire) {
                state.latest = Some(json!({"status":"canceling","progress":0}));
            } else {
                state.job = None;
                state.latest = Some(json!({"status":"canceled","progress":0}));
            }
        }
        state
            .latest
            .clone()
            .unwrap_or_else(|| json!({"status":"idle","progress":0}))
    }

    async fn record(&self, id: Uuid, part: &str, body: Body) -> Result<Value> {
        let job = self
            .state
            .lock()
            .expect("video export state poisoned")
            .job
            .clone()
            .filter(|job| job.id == id && job.started.elapsed() < Duration::from_secs(300))
            .context("视频导出已取消或过期")?;
        let _write = job.upload.lock().await;
        ensure!(
            !job.active.load(std::sync::atomic::Ordering::Acquire) && !job.cancel.is_cancelled(),
            "视频导出已开始"
        );
        let (filename, limit) = match part {
            "audio" => ("source.audio", MAX_MEDIA),
            "video" => ("source.mp4", MAX_MEDIA),
            "config" => ("config.json", MAX_CONFIG),
            _ => anyhow::bail!("视频素材类型无效"),
        };
        let output = tempfile::NamedTempFile::new_in(job.workspace.path())?;
        let mut file = tokio::fs::File::from_std(output.reopen()?);
        let mut stream = body.into_data_stream();
        let mut count = 0usize;
        loop {
            let chunk = tokio::select! {
                _ = job.cancel.cancelled() => anyhow::bail!("视频导出已取消"),
                result = stream.next() => result,
            };
            let Some(chunk) = chunk else { break };
            let bytes = chunk?;
            count += bytes.len();
            ensure!(count <= limit, "视频素材过大");
            file.write_all(&bytes).await?;
        }
        ensure!(count > 0, "视频素材为空");
        file.sync_all().await?;
        drop(file);
        output.persist(job.workspace.path().join(filename))?;
        Ok(json!({"ok":true}))
    }

    pub async fn upload(&self, remainder: &str, body: Body) -> Response {
        let Some((id, part)) = remainder.split_once('/') else {
            return StatusCode::NOT_FOUND.into_response();
        };
        let Ok(id) = Uuid::parse_str(id) else {
            return StatusCode::NOT_FOUND.into_response();
        };
        match self.record(id, part, body).await {
            Ok(value) => Json(value).into_response(),
            Err(_) => (
                StatusCode::BAD_REQUEST,
                Json(json!({"ok":false,"error":"视频素材保存失败"})),
            )
                .into_response(),
        }
    }

    pub fn start(
        self: &Arc<Self>,
        id: &str,
        runtime: &tokio::runtime::Handle,
        renderer: Renderer,
    ) -> Result<Value> {
        let id = Uuid::parse_str(id).ok().context("视频导出标识无效")?;
        let job = self
            .state
            .lock()
            .expect("video export state poisoned")
            .job
            .clone()
            .filter(|job| job.id == id)
            .context("视频导出已取消或过期")?;
        ensure!(
            !job.active.swap(true, std::sync::atomic::Ordering::AcqRel),
            "视频已经开始导出"
        );
        let worker = Arc::clone(self);
        let id = job.id;
        runtime.spawn(async move {
            let result = tokio::select! {
                _ = job.cancel.cancelled() => Err(anyhow::anyhow!("已取消导出")),
                output = worker.render(&job, &renderer) => output,
            };
            let _ = renderer(RenderRequest::Close(job.id));
            let mut state = worker.state.lock().expect("video export state poisoned");
            if state.job.as_ref().is_some_and(|current| current.id == job.id) {
                state.job = None;
                state.latest = Some(match result {
                    Ok(()) => json!({"status":"completed","jobId":job.id.to_string(),"progress":100,
                        "fileName":job.destination.file_name().and_then(|name| name.to_str()).unwrap_or("Mineradio.mp4")}),
                    Err(_) if job.cancel.is_cancelled() => json!({"status":"canceled","progress":0}),
                    Err(error) => json!({"status":"error","progress":0,"error":error.to_string()}),
                });
            }
        });
        Ok(json!({"ok":true,"jobId":id.to_string()}))
    }

    fn progress(&self, state: Value) {
        self.state
            .lock()
            .expect("video export state poisoned")
            .latest = Some(state);
    }

    async fn render(&self, job: &Job, renderer: &Renderer) -> Result<()> {
        let _config_write = job.upload.lock().await;
        let (setup, media) = prepare(job).await?;
        let (request, response) = oneshot::channel();
        renderer(RenderRequest::Open {
            id: job.id,
            url: media.address.clone(),
            width: setup.width,
            height: setup.height,
            ready: request,
        })?;
        tokio::time::timeout(SDL_TIMEOUT, response)
            .await
            .context("视频预设初始化超时")???;
        let mut pcm = tokio::fs::File::open(job.workspace.path().join("analysis.f32")).await?;
        let ffmpeg = tools::ffmpeg().context("视频编码组件未安装")?;
        let output = job.workspace.path().join("export.mp4");
        let duration = setup.duration.to_string();
        let fps = setup.fps.to_string();
        let mut child = tools::hidden_command(&ffmpeg)
            .args([
                "-v",
                "error",
                "-nostdin",
                "-y",
                "-f",
                "image2pipe",
                "-framerate",
                &fps,
                "-vcodec",
                "png",
                "-i",
                "pipe:0",
                "-i",
            ])
            .arg(job.workspace.path().join("source.audio"))
            .args([
                "-map",
                "0:v:0",
                "-map",
                "1:a:0",
                "-c:v",
                "libx264",
                "-threads:v",
                "4",
                "-preset",
                "fast",
                "-crf",
                "18",
                "-pix_fmt",
                "yuv420p",
                "-c:a",
                "aac",
                "-b:a",
                "320k",
                "-t",
                &duration,
                "-shortest",
                "-movflags",
                "+faststart",
            ])
            .arg(&output)
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .context("无法启动视频编码组件")?;
        let mut input = child.stdin.take().context("视频编码管道不可用")?;
        let frames = (setup.duration * f64::from(setup.fps)).ceil() as u64;
        let mut chunk = [0u8; 2048 * 4];
        for frame in 0..frames {
            chunk.fill(0);
            let time = frame as f64 / f64::from(setup.fps);
            let samples = (time * 48000.0).round() as u64;
            let padding = 2048u64.saturating_sub(samples) as usize * 4;
            pcm.seek(SeekFrom::Start(samples.saturating_sub(2048) * 4))
                .await?;
            let _ = pcm.read(&mut chunk[padding..]).await?;
            let (sender, reader) = oneshot::channel();
            renderer(RenderRequest::Draw {
                id: job.id,
                time,
                samples: STANDARD.encode(chunk),
                frame,
                preset: setup.preset,
                result: sender,
            })?;
            let image = tokio::time::timeout(Duration::from_secs(20), reader)
                .await
                .context("视频画面生成超时")???;
            ensure!(
                image.get(16..20) == Some(&setup.width.to_be_bytes())
                    && image.get(20..24) == Some(&setup.height.to_be_bytes()),
                "导出画面尺寸与设置不一致"
            );
            input.write_all(&image).await.context("视频编码提前结束")?;
            if frame % 10 == 0 || frame + 1 == frames {
                self.progress(json!({"status":"rendering","jobId":job.id.to_string(),"duration":setup.duration,
                    "renderedFrames":frame+1,"totalFrames":frames,"progress":(100 * (frame+1)/frames).min(99)}));
            }
        }
        self.progress(json!({"status":"encoding","progress":99}));
        drop(input);
        ensure!(
            child.wait().await?.success(),
            "视频编码失败，请检查磁盘空间"
        );
        std::fs::rename(output, &job.destination).context("视频无法保存到选定位置")?;
        Ok(())
    }
}

struct Setup {
    width: u32,
    height: u32,
    fps: u32,
    duration: f64,
    preset: u64,
}

struct RenderAssets {
    directory: PathBuf,
    origin: String,
    config: Value,
    page: String,
}

struct AssetServer {
    address: String,
    owned_task: tokio::task::JoinHandle<()>,
}

impl Drop for AssetServer {
    fn drop(&mut self) {
        self.owned_task.abort();
    }
}

async fn prepare(job: &Job) -> Result<(Setup, AssetServer)> {
    let folder = job.workspace.path();
    let config = tokio::fs::read(folder.join("config.json"))
        .await
        .context("导出配置缺失")?;
    ensure!(config.len() <= MAX_CONFIG, "导出配置过大");
    let values: Value = serde_json::from_slice(&config).context("导出配置格式无效")?;
    let width = values["width"].as_u64().unwrap_or_default() as u32;
    let height = values["height"].as_u64().unwrap_or_default() as u32;
    let fps = values["fps"].as_u64().unwrap_or_default() as u32;
    ensure!(
        matches!((width, height), (1280, 720) | (1920, 1080)) && matches!(fps, 30 | 60),
        "视频尺寸或帧率无效"
    );
    let preset_data = &values["preset"];
    let preset = preset_data["snapshot"]["preset"]
        .as_u64()
        .filter(|value| *value <= 14)
        .context("视觉预设无效")?;
    ensure!(
        preset_data["schema"] == 1
            && matches!(
                preset_data["type"].as_str(),
                Some("mineradio-track-preset" | "mineradio-user-fx-archive")
            ),
        "视觉预设格式无效"
    );
    ensure!(
        preset_data["resources"]["externalProject"]["active"] != true,
        "外部场景暂不支持视频导出"
    );
    let audio = folder.join("source.audio");
    let resource = tools::ffmpeg().context("音频解码组件未安装")?;
    let analysis = folder.join("analysis.f32");
    let mut decode = tools::hidden_command(&resource);
    let exit = decode
        .args(["-v", "error", "-nostdin", "-y", "-i"])
        .arg(&audio)
        .args([
            "-t", "7201", "-vn", "-ac", "1", "-ar", "48000", "-f", "f32le",
        ])
        .arg(&analysis)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .await?;
    ensure!(exit.success(), "音频解码失败，请确认文件可正常播放");
    let duration = tokio::fs::metadata(&analysis).await?.len() as f64 / 4.0 / 48000.0;
    ensure!(
        duration > 0.0 && duration <= 7200.0,
        "音频时长无效或超过两小时"
    );
    let mut cover_url = "";
    if let Some((mime, content)) = values["cover"]
        .as_str()
        .and_then(|value| value.strip_prefix("data:"))
        .and_then(|value| value.split_once(";base64,"))
    {
        let suffix = match mime {
            "image/png" => "png",
            "image/jpeg" => "jpg",
            "image/webp" => "webp",
            "image/gif" => "gif",
            _ => "",
        };
        if !suffix.is_empty() {
            let bytes = STANDARD.decode(content)?;
            ensure!(bytes.len() <= 8 * 1024 * 1024, "封面图片过大");
            tokio::fs::write(folder.join(format!("cover.{suffix}")), bytes).await?;
            cover_url = match suffix {
                "png" => "/media/cover.png",
                "jpg" => "/media/cover.jpg",
                "webp" => "/media/cover.webp",
                _ => "/media/cover.gif",
            };
        }
    }
    let video = if folder.join("source.mp4").is_file() {
        "/media/source.mp4"
    } else {
        ""
    };
    let listener = tokio::net::TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).await?;
    let authority = listener.local_addr()?.to_string();
    let origin = format!("http://{authority}");
    let safe = |value: &Value, limit| {
        value
            .as_str()
            .unwrap_or_default()
            .chars()
            .take(limit)
            .collect::<String>()
    };
    let state = Arc::new(RenderAssets {
        directory: folder.to_owned(),
        origin: authority,
        page: assets::player_page()?,
        config: json!({"preset":preset_data,"song":{"name":safe(&values["song"]["name"],200),"artist":safe(&values["song"]["artist"],200)},
            "lyric":safe(&values["lyric"],512 * 1024),"duration":duration,"fps":fps,"coverUrl":cover_url,"videoUrl":video}),
    });
    let router = Router::new().fallback(asset_request).with_state(state);
    let owned_task = tokio::spawn(async move {
        let _ = axum::serve(listener, router).await;
    });
    let expected = match preset {
        13 => preset_data["resources"]["mvFallback"]
            .as_u64()
            .unwrap_or_default()
            .min(12),
        14 => 3,
        other => other,
    };
    Ok((
        Setup {
            width,
            height,
            fps,
            duration,
            preset: expected,
        },
        AssetServer {
            address: format!("{origin}/?video_export={}", job.id),
            owned_task,
        },
    ))
}

async fn asset_request(State(state): State<Arc<RenderAssets>>, request: Request) -> Response {
    if request
        .headers()
        .get(header::HOST)
        .is_none_or(|value| value != state.origin.as_str())
        || !matches!(*request.method(), Method::GET | Method::HEAD)
    {
        return StatusCode::FORBIDDEN.into_response();
    }
    let path = request.uri().path();
    let head = request.method() == Method::HEAD;
    if path == "/__config" {
        return Json(state.config.clone()).into_response();
    }
    if let Some(name) = path.strip_prefix("/media/") {
        if !matches!(
            name,
            "source.mp4" | "cover.png" | "cover.jpg" | "cover.webp" | "cover.gif"
        ) {
            return StatusCode::NOT_FOUND.into_response();
        }
        return media::stream_file(&state.directory.join(name), request.headers(), head)
            .await
            .unwrap_or_else(|_| StatusCode::NOT_FOUND.into_response());
    }
    let name = path.trim_start_matches('/');
    let (bytes, mime) = if path == "/" {
        (
            Body::from(state.page.clone()),
            "text/html; charset=utf-8".to_owned(),
        )
    } else if let Some(data) = assets::asset(name).filter(|_| !name.ends_with(".map")) {
        (
            Body::from(data),
            mime_guess::from_path(name)
                .first_or_octet_stream()
                .to_string(),
        )
    } else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let mut response = if head { Body::empty() } else { bytes }.into_response();
    response
        .headers_mut()
        .insert(header::CONTENT_TYPE, HeaderValue::from_str(&mime).unwrap());
    response.headers_mut().insert(header::CONTENT_SECURITY_POLICY,HeaderValue::from_static(
        "default-src 'self' data: blob:; script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:; style-src 'self' 'unsafe-inline'; connect-src 'self' data: blob:; frame-src 'self' data: blob:; object-src 'none'",
    ));
    response
}
