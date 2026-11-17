use crate::accounts::{Account, Accounts, Provider, ServerAccounts};
use crate::comments::Comments;
use crate::library::Library;
use crate::music_video::MusicVideos;
use crate::native_files::NativeFiles;
use crate::profile::Profile;
use crate::protected_audio::ProtectedAudio;
use crate::providers::{self, ResolvedTrack, kugou, netease, qishui, qq};
use crate::wallpaper_library::WallpaperLibrary;
use crate::{assets, auth::Auth, charts, cloud, media};
use anyhow::{Context, Result, ensure};
use axum::body::Body;
use axum::extract::{Request, State};
use axum::http::{HeaderMap, Method, StatusCode, header};
use axum::response::{IntoResponse, Response};
use axum::{Json, Router};
use serde_json::{Map, Value, json};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

pub struct AppState {
    pub origin: String,
    page: String,
    upstream: reqwest::Client,
    media_client: reqwest::Client,
    media_registry: media::MediaRegistry,
    music_videos: MusicVideos,
    protected: ProtectedAudio,
    library: Arc<Library>,
    accounts: ServerAccounts,
    auth: Auth,
    comments: Comments,
    cloud: cloud::Cloud,
    pub files: Arc<NativeFiles>,
    pub wallpaper: Arc<WallpaperLibrary>,
    #[cfg(windows)]
    pub glasses: Arc<crate::wallpaper_capture::GlassFrames>,
    #[cfg(windows)]
    pub video: Arc<crate::video_export::VideoExport>,
    profile: Profile,
    qishui_device: tokio::sync::OnceCell<(String, String)>,
}

impl AppState {
    pub fn new(profile: Profile, origin: String) -> Result<Self> {
        let upstream = reqwest::Client::builder()
            .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36")
            .redirect(reqwest::redirect::Policy::none())
            .retry(reqwest::retry::never())
            .connect_timeout(Duration::from_secs(6))
            .timeout(Duration::from_secs(20))
            .build()?;
        Ok(Self {
            origin,
            upstream,
            page: assets::player_page()?,
            library: Arc::new(Library::new(profile.clone())),
            protected: ProtectedAudio::new(profile.clone())?,
            accounts: ServerAccounts::new(profile.clone()),
            auth: Auth::default(),
            comments: Comments::default(),
            cloud: cloud::Cloud::default(),
            files: Arc::new(NativeFiles::new(profile.clone())?),
            wallpaper: Arc::new(WallpaperLibrary::new(&profile)),
            #[cfg(windows)]
            glasses: Arc::new(crate::wallpaper_capture::GlassFrames::default()),
            #[cfg(windows)]
            video: Arc::new(crate::video_export::VideoExport::default()),
            profile,
            qishui_device: tokio::sync::OnceCell::new(),
            media_client: media::client()?,
            media_registry: media::MediaRegistry::default(),
            music_videos: MusicVideos::default(),
        })
    }

    fn same_origin(&self, headers: &HeaderMap) -> bool {
        let origin = headers.get(header::ORIGIN);
        let fetch_site = headers.get("sec-fetch-site");
        origin.is_none_or(|value| value == self.origin.as_str())
            && fetch_site.is_none_or(|site| site == "same-origin" || site == "none")
            && headers.get_all(header::ORIGIN).iter().count() <= 1
    }
}

pub fn router(state: Arc<AppState>) -> Router {
    Router::new().fallback(dispatch).with_state(state)
}

fn json_response(status: StatusCode, data: Value) -> Response {
    let mut response = (status, Json(data)).into_response();
    response.headers_mut().insert(
        header::CACHE_CONTROL,
        header::HeaderValue::from_static("no-store"),
    );
    response
}

fn failure(status: StatusCode, code: &str, message: &str) -> Response {
    json_response(
        status,
        json!({"ok": false, "error": code, "message": message}),
    )
}

fn unsupported() -> Response {
    failure(
        StatusCode::NOT_IMPLEMENTED,
        "feature_pending",
        "此功能尚未迁入 Rust 版本",
    )
}

fn asset_response(body: Body, mime: &str, length: usize) -> Response {
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, mime)
        .header(header::CONTENT_LENGTH, length)
        .header(header::CACHE_CONTROL, "no-cache")
        .header(header::X_CONTENT_TYPE_OPTIONS, "nosniff")
        .header(header::REFERRER_POLICY, "no-referrer")
        .body(body)
        .expect("static content response")
}

fn provider_route<'a>(path: &'a str, query: &HashMap<String, String>) -> (Provider, &'a str) {
    let path = path.strip_prefix("/api/").unwrap_or(path);
    if let Some((prefix, route)) = path.split_once('/') {
        if let Some(provider) = Provider::parse(prefix) {
            return (provider, route);
        }
    }
    let provider = query
        .get("provider")
        .or_else(|| query.get("platform"))
        .and_then(|name| Provider::parse(name))
        .unwrap_or(Provider::Netease);
    (provider, path)
}

fn value<'a>(query: &'a HashMap<String, String>, keys: &[&str]) -> &'a str {
    keys.iter()
        .find_map(|key| query.get(*key).filter(|value| !value.is_empty()))
        .map(String::as_str)
        .unwrap_or_default()
}

fn bounded(text: &str, default: usize, max: usize) -> usize {
    text.parse::<usize>().unwrap_or(default).min(max)
}

fn old_status(route: &str) -> bool {
    matches!(route, "login/status" | "status" | "local/auth/status")
}

async fn dispatch(State(state): State<Arc<AppState>>, request: Request) -> Response {
    let path = request.uri().path();
    let head = request.method() == Method::HEAD;
    let authority = state.origin.trim_start_matches("http://");
    let host = request.headers().get(header::HOST);
    if host.is_none_or(|host| host != authority)
        || request.headers().get_all(header::HOST).iter().count() != 1
    {
        return failure(
            StatusCode::FORBIDDEN,
            "local_only",
            "请从本机 Mineradio 窗口访问",
        );
    }
    if !path.starts_with("/api/") {
        if request.method() != Method::GET && !head {
            return StatusCode::METHOD_NOT_ALLOWED.into_response();
        }
        if path == "/__health" {
            return json_response(
                StatusCode::OK,
                json!({"ok":true,"site":"mineradio-local","runtime":"rust","version":env!("CARGO_PKG_VERSION")}),
            );
        }
        if matches!(path, "/" | "/index.html") {
            let page = &state.page;
            return asset_response(
                if head {
                    Body::empty()
                } else {
                    Body::from(page.clone())
                },
                "text/html; charset=utf-8",
                page.len(),
            );
        }
        let clean = path.trim_start_matches('/');
        return match assets::asset(clean) {
            Some(bytes) => asset_response(
                if head {
                    Body::empty()
                } else {
                    Body::from(bytes)
                },
                mime_guess::from_path(clean)
                    .first_or_octet_stream()
                    .as_ref(),
                bytes.len(),
            ),
            None => StatusCode::NOT_FOUND.into_response(),
        };
    }
    if !state.same_origin(request.headers()) {
        return failure(
            StatusCode::FORBIDDEN,
            "local_only",
            "请从本机 Mineradio 窗口访问",
        );
    }
    if path.starts_with("/api/native/") {
        return native_request(&state, request).await;
    }
    if request.method() == Method::POST && path.starts_with("/api/local/auth/") {
        let operation = path.trim_start_matches("/api/local/auth/").to_owned();
        if !matches!(
            operation.as_str(),
            "session" | "sms" | "login" | "check" | "logout" | "show" | "verify"
        ) || request.uri().query().is_some()
            || !json_content(&request)
            || request
                .headers()
                .get(header::ORIGIN)
                .is_none_or(|origin| origin != state.origin.as_str())
        {
            return failure(
                StatusCode::FORBIDDEN,
                "local_auth_only",
                "请在 Mineradio 登录窗口完成授权",
            );
        }
        let payload = match local_json(request, 16 * 1024).await {
            Ok(payload) => payload,
            Err(response) => return response,
        };
        return match state.auth.handle(&operation, &payload).await {
            Ok(result) => json_response(StatusCode::OK, result),
            Err(error) => {
                let message = if error
                    .chain()
                    .any(|cause| cause.is::<reqwest::Error>() || cause.is::<url::ParseError>())
                {
                    "登录服务暂时不可用，请重试".to_owned()
                } else {
                    error.to_string()
                };
                failure(StatusCode::BAD_REQUEST, "login_request_failed", &message)
            }
        };
    }
    if request.method() == Method::POST
        && matches!(path, "/api/library/mutate" | "/api/library/membership")
    {
        let edit = path == "/api/library/mutate";
        if request.uri().query().is_some()
            || !json_content(&request)
            || request
                .headers()
                .get(header::ORIGIN)
                .is_none_or(|origin| origin != state.origin.as_str())
        {
            return failure(
                StatusCode::FORBIDDEN,
                "local_only",
                "请在 Mineradio 歌单菜单中操作",
            );
        }
        let headers = request.headers().clone();
        let payload = match local_json(request, 128 * 1024).await {
            Ok(payload) => payload,
            Err(response) => return response,
        };
        let preferred = payload["provider"]
            .as_str()
            .and_then(Provider::parse)
            .unwrap_or(Provider::Netease);
        let accounts = match request_accounts(&state, &headers, &HashMap::new(), preferred).await {
            Ok(accounts) => accounts,
            Err(_) => {
                return failure(
                    StatusCode::BAD_REQUEST,
                    "credentials_invalid",
                    "平台账号资料格式错误",
                );
            }
        };
        let result = if edit {
            // Finish the confirmation read if the renderer disconnects after clicking.
            tokio::spawn(async move {
                state
                    .cloud
                    .mutate(&state.upstream, &payload, &accounts)
                    .await
            })
            .await
            .unwrap_or_else(|_| Err(anyhow::anyhow!("平台未确认歌单同步")))
        } else {
            state
                .cloud
                .membership(&state.upstream, &payload, &accounts)
                .await
        };
        return match result {
            Ok(value) => json_response(StatusCode::OK, value),
            Err(error) => failure(
                StatusCode::BAD_REQUEST,
                "library_input_invalid",
                &error.to_string(),
            ),
        };
    }
    if request.method() == Method::POST {
        let (platform, route) = provider_route(path, &HashMap::new());
        if route == "song/comments/like" {
            if request.uri().query().is_some()
                || !json_content(&request)
                || request
                    .headers()
                    .get(header::ORIGIN)
                    .is_none_or(|origin| origin != state.origin.as_str())
            {
                return failure(
                    StatusCode::FORBIDDEN,
                    "local_only",
                    "请在 Mineradio 评论面板中点赞",
                );
            }
            let headers = request.headers().clone();
            let payload = match local_json(request, 16 * 1024).await {
                Ok(payload) => payload,
                Err(response) => return response,
            };
            let accounts = match request_accounts(&state, &headers, &HashMap::new(), platform).await
            {
                Ok(accounts) => accounts,
                Err(_) => {
                    return failure(
                        StatusCode::BAD_REQUEST,
                        "credentials_invalid",
                        "平台账号资料格式错误",
                    );
                }
            };
            let result = tokio::spawn(async move {
                state
                    .comments
                    .like(&state.upstream, platform, &payload, &accounts)
                    .await
            })
            .await;
            return match result {
                Ok(Ok(data)) => json_response(
                    if data["ok"] == true {
                        StatusCode::OK
                    } else {
                        StatusCode::BAD_GATEWAY
                    },
                    data,
                ),
                Ok(Err(error)) => failure(
                    StatusCode::BAD_REQUEST,
                    "comment_like_rejected",
                    &error.to_string(),
                ),
                _ => failure(
                    StatusCode::BAD_GATEWAY,
                    "comment_like_unconfirmed",
                    "未能确认点赞结果，请刷新评论查看实际状态",
                ),
            };
        }
    }
    if request.method() != Method::GET && !head {
        return unsupported();
    }
    let query = match serde_urlencoded::from_str::<HashMap<String, String>>(
        request.uri().query().unwrap_or_default(),
    ) {
        Ok(query) => query,
        Err(_) => return failure(StatusCode::BAD_REQUEST, "query_invalid", "请求参数无效"),
    };
    let (provider, route) = provider_route(path, &query);
    if path == "/api/server-account/status" {
        let snapshot = state.accounts.read(&state.upstream).await;
        let statuses: Map<String, Value> = Provider::ALL
            .into_iter()
            .map(|provider| {
                let account = snapshot.accounts.account(provider);
                (
                    provider.name().into(),
                    providers::sign_in_status(&account, None),
                )
            })
            .collect();
        return json_response(
            StatusCode::OK,
            json!({"platforms":statuses,"revision": snapshot.revision}),
        );
    }
    let accounts = match request_accounts(&state, request.headers(), &query, provider).await {
        Ok(accounts) => accounts,
        Err(_) => {
            return failure(
                StatusCode::BAD_REQUEST,
                "credentials_invalid",
                "平台账号资料格式错误",
            );
        }
    };
    let account = accounts.account(provider);
    if matches!(route, "audio" | "cover") {
        let media_url = value(&query, &["url"]);
        let image = route == "cover";
        if !image
            && media_url
                .strip_prefix(&state.origin)
                .is_some_and(|suffix| suffix.starts_with("/qishui/audio?"))
        {
            let headers = request.headers();
            let result = async {
                let path = state.protected.prepare(media_url, &accounts).await?;
                media::stream_file(&path, headers, head).await
            }
            .await;
            return result.unwrap_or_else(|_| {
                failure(
                    StatusCode::BAD_GATEWAY,
                    "qishui_audio_unavailable",
                    "汽水音源暂时无法播放，请重新选择音质",
                )
            });
        }
        if !image && !state.media_registry.permitted(media_url, &accounts) {
            return failure(
                StatusCode::FORBIDDEN,
                "audio_scope_invalid",
                "音频地址已失效，请重新点击播放",
            );
        }
        return media::stream_platform_media(
            &state.media_client,
            media_url,
            request.headers(),
            image,
            head,
        )
        .await
        .unwrap_or_else(|_| {
            failure(
                StatusCode::BAD_GATEWAY,
                "media_unavailable",
                "音乐平台暂时无法提供媒体",
            )
        });
    }
    if !matches!(
        route,
        "search"
            | "lyric"
            | "song/url"
            | "song/detail"
            | "song/comments"
            | "qualities"
            | "download"
            | "download/qualities"
            | "library/catalog"
            | "user/playlists"
            | "library/likes"
            | "library/tracks"
            | "playlist/tracks"
            | "album/detail"
            | "artist/detail"
            | "local/account-status"
            | "local/profile"
            | "local/catalog"
            | "local/tracks"
            | "discover/home"
            | "radio/metadata"
            | "mv"
            | "video"
            | "platform/capabilities"
            | "beatmap/cache/status"
            | "app/version"
            | "update/latest"
            | "spotify/status"
    ) && !old_status(route)
    {
        return unsupported();
    }
    let result = music_request(
        &state,
        provider,
        route,
        &query,
        request.headers(),
        &account,
        &accounts,
        head,
    )
    .await;
    result.unwrap_or_else(|_| {
        failure(
            StatusCode::BAD_GATEWAY,
            "music_unavailable",
            "音乐平台暂时不可用或请求参数无效",
        )
    })
}

async fn request_accounts(
    state: &AppState,
    headers: &HeaderMap,
    query: &HashMap<String, String>,
    provider: Provider,
) -> Result<Accounts> {
    let mut accounts = if headers
        .get("x-mineradio-account-source")
        .is_some_and(|value| value == "server")
        || value(query, &["account_source"]) == "server"
    {
        state.accounts.read(&state.upstream).await.accounts
    } else {
        Accounts::local(headers, query, provider)?
    };
    if accounts.qishui_needs_device() {
        let profile = state.profile.clone();
        let (device, install) = state
            .qishui_device
            .get_or_try_init(|| async move {
                tokio::task::spawn_blocking(move || profile.qishui_device()).await?
            })
            .await?;
        accounts.set_qishui_device(device, install);
    }
    Ok(accounts)
}

async fn native_request(state: &AppState, request: Request) -> Response {
    let route = request.uri().path().trim_start_matches("/api/native/");
    #[cfg(windows)]
    if let Some(part) = route.strip_prefix("video-export/").map(str::to_owned) {
        if !native_upload_allowed(state, &request) {
            return StatusCode::FORBIDDEN.into_response();
        }
        return state.video.upload(&part, request.into_body()).await;
    }
    if let Some(token) = route.strip_prefix("export/").map(str::to_owned) {
        if !native_upload_allowed(state, &request) {
            return StatusCode::FORBIDDEN.into_response();
        }
        return match state.files.write_export(&token, request.into_body()).await {
            Ok(result) => json_response(StatusCode::OK, result),
            Err(_) => failure(
                StatusCode::BAD_REQUEST,
                "export_failed",
                "无法保存导出文件，请重新选择位置",
            ),
        };
    }
    #[cfg(windows)]
    if let Some(id) = route.strip_prefix("wallpaper/glass/") {
        use crate::wallpaper_capture::GlassReply;
        if request.method() != Method::GET {
            return StatusCode::METHOD_NOT_ALLOWED.into_response();
        }
        let after = request
            .uri()
            .query()
            .and_then(|query| query.strip_prefix("after="))
            .and_then(|value| value.parse().ok())
            .unwrap_or(0);
        return match state.glasses.frame(id, after).await {
            GlassReply::Jpeg(sequence, data) => Response::builder()
                .header(header::CONTENT_TYPE, "image/jpeg")
                .header(header::CACHE_CONTROL, "no-store")
                .header(header::X_CONTENT_TYPE_OPTIONS, "nosniff")
                .header("Cross-Origin-Resource-Policy", "same-origin")
                .header("X-Mineradio-Frame", sequence)
                .body(Body::from(data))
                .expect("wallpaper JPEG response"),
            GlassReply::Waiting => StatusCode::NO_CONTENT.into_response(),
            GlassReply::Missing => StatusCode::NOT_FOUND.into_response(),
            GlassReply::Failed => StatusCode::SERVICE_UNAVAILABLE.into_response(),
        };
    }
    if let Some(route) = route.strip_prefix("wallpaper/") {
        if !matches!(*request.method(), Method::GET | Method::HEAD) {
            return StatusCode::METHOD_NOT_ALLOWED.into_response();
        }
        let params = serde_urlencoded::from_str::<HashMap<String, String>>(
            request.uri().query().unwrap_or_default(),
        )
        .unwrap_or_default();
        let library = Arc::clone(&state.wallpaper);
        if route == "list" || route.starts_with("details/") {
            let id = route.strip_prefix("details/").map(str::to_owned);
            let force = params.get("force").is_some_and(|value| value == "1");
            return match tokio::task::spawn_blocking(move || match id {
                Some(id) => library.details(&id),
                None => library.scan(force),
            })
            .await
            {
                Ok(Ok(data)) => json_response(StatusCode::OK, data),
                _ => failure(
                    StatusCode::NOT_FOUND,
                    "wallpaper_project_unavailable",
                    "壁纸项目暂不可读",
                ),
            };
        }
        let Some((kind, id)) = route.split_once('/') else {
            return StatusCode::NOT_FOUND.into_response();
        };
        let kind = kind.to_owned();
        let id = id.to_owned();
        let token = params.get("token").cloned().unwrap_or_default();
        return match tokio::task::spawn_blocking(move || library.file(&id, &kind, &token)).await {
            Ok(Ok(Some(path))) => {
                media::stream_file(&path, request.headers(), request.method() == Method::HEAD)
                    .await
                    .unwrap_or_else(|_| StatusCode::NOT_FOUND.into_response())
            }
            _ => StatusCode::NOT_FOUND.into_response(),
        };
    }
    if route == "slides" || route == "cache" {
        let files = Arc::clone(&state.files);
        let response = if request.method() == Method::GET {
            let slide = route == "slides";
            tokio::task::spawn_blocking(move || {
                if slide {
                    files.slideshow()
                } else {
                    files.cache_snapshot()
                }
            })
            .await
        } else if route == "slides" && native_upload_allowed(state, &request) {
            let name = serde_urlencoded::from_str::<HashMap<String, String>>(
                request.uri().query().unwrap_or_default(),
            )
            .ok()
            .and_then(|mut values| values.remove("name"))
            .unwrap_or_default();
            let Ok(body) = axum::body::to_bytes(request.into_body(), 64 * 1024 * 1024).await else {
                return StatusCode::PAYLOAD_TOO_LARGE.into_response();
            };
            tokio::task::spawn_blocking(move || files.add_slide(&name, &body)).await
        } else {
            return StatusCode::METHOD_NOT_ALLOWED.into_response();
        };
        return match response {
            Ok(Ok(data)) => json_response(StatusCode::OK, data),
            _ => failure(
                StatusCode::BAD_REQUEST,
                "native_files_unavailable",
                "本机文件暂不可用",
            ),
        };
    }
    if let Some(id) = route.strip_prefix("slides/").map(str::to_owned) {
        if !matches!(*request.method(), Method::GET | Method::HEAD) {
            return StatusCode::METHOD_NOT_ALLOWED.into_response();
        }
        let files = Arc::clone(&state.files);
        let path = tokio::task::spawn_blocking(move || files.slide(&id)).await;
        return match path {
            Ok(Ok(Some(path))) => {
                media::stream_file(&path, request.headers(), request.method() == Method::HEAD)
                    .await
                    .unwrap_or_else(|_| StatusCode::NOT_FOUND.into_response())
            }
            _ => StatusCode::NOT_FOUND.into_response(),
        };
    }
    if route == "fx-autosave" {
        let library = Arc::clone(&state.library);
        let body = if request.method() == Method::GET {
            None
        } else if request.method() == Method::POST && json_content(&request) {
            let Ok(bytes) = axum::body::to_bytes(request.into_body(), 12 * 1024 * 1024).await
            else {
                return StatusCode::PAYLOAD_TOO_LARGE.into_response();
            };
            match serde_json::from_slice::<Value>(&bytes) {
                Ok(data) => Some(data),
                Err(_) => return StatusCode::BAD_REQUEST.into_response(),
            }
        } else {
            return StatusCode::METHOD_NOT_ALLOWED.into_response();
        };
        return match tokio::task::spawn_blocking(move || library.visual_settings(body.as_ref()))
            .await
        {
            Ok(Ok(result)) => json_response(StatusCode::OK, result),
            _ => failure(
                StatusCode::BAD_REQUEST,
                "invalid_visual_settings",
                "视觉设置暂不可保存",
            ),
        };
    }
    if let Some((kind, id)) = route.split_once('/') {
        if !matches!(kind, "audio" | "cover")
            || !matches!(*request.method(), Method::GET | Method::HEAD)
        {
            return StatusCode::NOT_FOUND.into_response();
        }
        let library = Arc::clone(&state.library);
        let id = id.to_owned();
        let image = kind == "cover";
        let path = tokio::task::spawn_blocking(move || library.local_media(&id, image)).await;
        return match path {
            Ok(Ok(Some(path))) => {
                media::stream_file(&path, request.headers(), request.method() == Method::HEAD)
                    .await
                    .unwrap_or_else(|_| StatusCode::NOT_FOUND.into_response())
            }
            _ => StatusCode::NOT_FOUND.into_response(),
        };
    }
    if route != "library" || request.method() != Method::POST {
        return StatusCode::NOT_FOUND.into_response();
    }
    if !json_content(&request) {
        return StatusCode::UNSUPPORTED_MEDIA_TYPE.into_response();
    }
    let Ok(body) = axum::body::to_bytes(request.into_body(), 2 * 1024 * 1024).await else {
        return StatusCode::PAYLOAD_TOO_LARGE.into_response();
    };
    let library = Arc::clone(&state.library);
    let result = tokio::task::spawn_blocking(move || -> Result<Value> {
        let data: Value = serde_json::from_slice(&body)?;
        let method = data["method"].as_str().context("本机操作无效")?;
        let arguments = data["args"].as_array().context("本机操作参数无效")?;
        library.command(method, arguments)
    })
    .await;
    match result {
        Ok(Ok(data)) => json_response(StatusCode::OK, data),
        Ok(Err(error)) => failure(
            StatusCode::BAD_REQUEST,
            "native_library_error",
            &error.to_string(),
        ),
        Err(_) => failure(
            StatusCode::INTERNAL_SERVER_ERROR,
            "native_library_error",
            "本机曲库暂不可用",
        ),
    }
}

fn native_upload_allowed(state: &AppState, request: &Request) -> bool {
    request.method() == Method::POST
        && request
            .headers()
            .get(header::ORIGIN)
            .is_some_and(|origin| origin == state.origin.as_str())
        && request
            .headers()
            .get(header::CONTENT_TYPE)
            .is_some_and(|mime| mime == "application/octet-stream")
}

fn json_content(request: &Request) -> bool {
    request
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.split(';').next())
        == Some("application/json")
}

async fn local_json(request: Request, max_bytes: usize) -> std::result::Result<Value, Response> {
    let body = axum::body::to_bytes(request.into_body(), max_bytes)
        .await
        .map_err(|_| {
            failure(
                StatusCode::PAYLOAD_TOO_LARGE,
                "request_too_large",
                "请求内容过大",
            )
        })?;
    let json: Value = serde_json::from_slice(&body)
        .map_err(|_| failure(StatusCode::BAD_REQUEST, "invalid_json", "请求格式无效"))?;
    if !json.is_object() {
        return Err(failure(
            StatusCode::BAD_REQUEST,
            "invalid_json",
            "请求格式无效",
        ));
    }
    Ok(json)
}

async fn account_info(
    state: &AppState,
    provider: Provider,
    account: &Account,
) -> Result<(Option<bool>, Value)> {
    match provider {
        Provider::Netease => netease::account_info(&state.upstream, account).await,
        Provider::Qq => qq::account_info(&state.upstream, account).await,
        Provider::Kugou => kugou::account_info(account),
        Provider::Qishui => qishui::account_info(&state.upstream, account).await,
    }
}

async fn music_request(
    state: &AppState,
    provider: Provider,
    route: &str,
    query: &HashMap<String, String>,
    headers: &HeaderMap,
    account: &Account,
    accounts: &Accounts,
    head: bool,
) -> Result<Response> {
    let key = value(query, &["mid", "hash", "id", "playlistId", "songId"]);
    let offset = bounded(value(query, &["offset"]), 0, 100_000);
    let client = &state.upstream;
    let data = match (provider, route) {
        (_, "app/version") => {
            json!({"version":env!("CARGO_PKG_VERSION"),"platform":"windows","runtime":"rust"})
        }
        (_, "update/latest") => {
            json!({"available":false,"currentVersion":env!("CARGO_PKG_VERSION")})
        }
        (_, "beatmap/cache/status") => json!({"ok":true,"count":0,"available":false}),
        (_, "spotify/status") => json!({"loggedIn":false,"configured":false}),
        (_, "platform/capabilities") => {
            let entries: Map<String, Value> = Provider::ALL
                .into_iter()
                .map(|platform| {
                    (
                        platform.name().into(),
                        json!({"label":platform.label(), "playlists":true,"likeRead":true,
                        "likeWrite":true,"albumRead":true,"albumWrite":false,"artistRead":true,
                        "commentsRead":true,"commentsLike":true,"commentsWrite":false}),
                    )
                })
                .collect();
            Value::Object(entries)
        }
        (_, "local/account-status" | "local/profile") => {
            let (valid, info) = account_info(state, provider, account).await?;
            if route == "local/profile" {
                json!({"provider":provider.name(), "account":info})
            } else {
                let mut status = providers::sign_in_status(account, valid);
                status["provider"] = json!(provider.name());
                status
            }
        }
        (Provider::Qishui, "status") => {
            let mut features = qishui::features(account);
            if let (Some(info), Some(status)) = (
                features.as_object_mut(),
                providers::sign_in_status(account, None).as_object(),
            ) {
                info.extend(status.clone());
            }
            features
        }
        (_, route) if old_status(route) => providers::sign_in_status(account, None),
        (_, "search") => {
            let keyword = value(query, &["keywords", "keyword", "s"]);
            ensure!(keyword.chars().count() <= 256, "搜索关键词过长");
            let limit = bounded(value(query, &["limit"]), 20, 50).max(1);
            match provider {
                Provider::Netease => {
                    netease::search(client, keyword, limit, offset, account).await?
                }
                Provider::Qq => qq::search(client, keyword, limit, offset, account).await?,
                Provider::Kugou => kugou::search(client, keyword, limit, offset, account).await?,
                Provider::Qishui => qishui::search(client, keyword, limit, offset, account).await?,
            }
        }
        (Provider::Netease, "lyric") => netease::lyric(client, key, account).await?,
        (_, "song/comments") => {
            let id = value(query, &["id", "mid", "hash"]);
            state
                .comments
                .read(client, provider, id, query, accounts)
                .await?
        }
        (Provider::Qq, "lyric") => qq::lyric(client, key, account).await?,
        (Provider::Qishui, "lyric") => qishui::lyric(client, key, account).await?,
        (Provider::Kugou, "lyric") => {
            kugou::lyric(
                client,
                key,
                value(query, &["duration", "durationMs"]),
                value(query, &["keyword", "keywords"]),
                account,
            )
            .await?
        }
        (_, "library/catalog" | "user/playlists") => {
            let selected = if route == "user/playlists"
                || !value(query, &["provider", "platform"]).is_empty()
            {
                Some(provider)
            } else {
                None
            };
            cloud::catalogue(client, selected, accounts).await
        }
        (_, "library/tracks" | "playlist/tracks" | "library/likes") => {
            let limit = bounded(value(query, &["limit"]), 100, 200).max(1);
            cloud::tracks(
                client,
                provider,
                key,
                limit,
                offset,
                route == "library/likes",
                account,
            )
            .await?
        }
        (_, "local/tracks") => {
            let limit = bounded(value(query, &["limit"]), 100, 500).max(1);
            let mut result = charts::tracks(client, accounts, key, offset, limit).await?;
            result["ok"] = json!(true);
            result
        }
        (_, "album/detail" | "artist/detail") => {
            catalogue_request(
                client,
                provider,
                route == "album/detail",
                query,
                offset,
                account,
            )
            .await?
        }
        (_, "local/catalog") => charts::list(client, accounts).await,
        (_, "discover/home") => charts::home(client, accounts).await,
        (_, "radio/metadata") => {
            let cache = state.profile.root.join("data/runtime/cache/charts");
            tokio::task::spawn_blocking(move || charts::radio_metadata(&cache)).await?
        }
        (_, "mv" | "video") => {
            let title = value(query, &["title"]);
            let artist = value(query, &["artist"]);
            let resolution = if value(query, &["resolution"]) == "480" {
                480
            } else {
                720
            };
            let (source, url) = state
                .music_videos
                .resolve(client, accounts, provider, key, title, artist, resolution)
                .await?;
            if route == "video" {
                if url.is_empty() {
                    return Ok(failure(
                        StatusCode::NOT_FOUND,
                        "mv_not_found",
                        "这首歌暂无 MV",
                    ));
                }
                return media::stream_platform_media(
                    &state.media_client,
                    &url,
                    headers,
                    false,
                    head,
                )
                .await;
            }
            json!({"available":!url.is_empty(),"provider":source.name(),"songProvider":provider.name(),
                "fallbackPreset":"emily"})
        }
        (_, "song/url" | "song/detail" | "qualities" | "download" | "download/qualities") => {
            let quality = providers::quality_name(provider, value(query, &["quality", "level"]));
            let fallback = matches!(value(query, &["allowQualityFallback"]), "1" | "true");
            let playback = matches!(route, "song/url" | "download");
            let mut resolved = match provider {
                Provider::Netease => {
                    netease::resolve(client, key, &quality, playback, fallback, account).await?
                }
                Provider::Qq => {
                    qq::resolve(client, key, &quality, playback, fallback, account).await?
                }
                Provider::Kugou => {
                    kugou::resolve(
                        client,
                        key,
                        value(query, &["albumId", "album_id"]),
                        &quality,
                        playback,
                        fallback,
                        account,
                    )
                    .await?
                }
                Provider::Qishui => qishui::resolve(client, key, account).await?,
            };
            for option in &mut resolved.qualities {
                if let Some(source) = option.protected.take() {
                    option.url =
                        state
                            .protected
                            .register(&state.origin, key, &option.key, source, accounts);
                    continue;
                }
                if option.available
                    && !state
                        .media_registry
                        .register(&option.url, provider, accounts)
                {
                    option.available = false;
                    option.downloadable = false;
                    option.url.clear();
                }
            }
            let selected = providers::select_quality(&resolved.qualities, &quality, fallback);
            if route == "download" {
                let Some(item) = selected.filter(|item| item.downloadable) else {
                    return Ok(failure(
                        StatusCode::CONFLICT,
                        "quality_unavailable",
                        "所选音质暂不可下载",
                    ));
                };
                let mut response = if item.decryption_supported {
                    let local = state.protected.prepare(&item.url, accounts).await?;
                    media::stream_file(&local, headers, head).await?
                } else {
                    media::stream_platform_media(
                        &state.media_client,
                        &item.url,
                        headers,
                        false,
                        head,
                    )
                    .await?
                };
                let filename = format!(
                    "{} - {}",
                    providers::text(&resolved.song["name"]),
                    providers::text(&resolved.song["artist"])
                );
                response.headers_mut().insert(
                    header::CONTENT_DISPOSITION,
                    media::download_name(&filename, &item.encode).parse()?,
                );
                return Ok(response);
            }
            playback_json(
                &resolved,
                provider,
                key,
                &quality,
                selected,
                route == "download/qualities",
                playback,
            )
        }
        _ => return Ok(unsupported()),
    };
    Ok(json_response(StatusCode::OK, data))
}

async fn catalogue_request(
    client: &reqwest::Client,
    platform: Provider,
    is_album: bool,
    query: &HashMap<String, String>,
    offset: usize,
    account: &Account,
) -> Result<Value> {
    let (keys, maximum) = if is_album {
        (
            &["mid", "albumMid", "album_mid", "id", "albumId", "album_id"][..],
            200,
        )
    } else {
        (
            &[
                "mid",
                "artistMid",
                "artist_mid",
                "id",
                "artistId",
                "artist_id",
            ][..],
            100,
        )
    };
    let limit = bounded(value(query, &["limit"]), 50, maximum).max(1);
    let mut identifier = value(query, keys).to_owned();
    let mut resolved = None;
    if identifier.is_empty() {
        let song_id = value(query, &["songId", "song_id"]);
        ensure!(!song_id.is_empty(), "缺少可用的歌曲标识");
        let (album, artists) = match platform {
            Provider::Netease => {
                let id = providers::numeric_id(song_id)?;
                let response = netease::detail(client, &[id], account).await?;
                let track = &response["songs"][0];
                ensure!(providers::uint(&track["id"]) == id, "网易云返回了其他曲目");
                let track = netease::song(track);
                (
                    providers::text(&track["albumId"]),
                    track["artists"].as_array().cloned().unwrap_or_default(),
                )
            }
            Provider::Qq => {
                let raw = qq::detail(client, song_id, account).await?;
                ensure!(
                    providers::text(&raw["id"]) == song_id || raw["mid"] == song_id,
                    "QQ 音乐返回了其他曲目"
                );
                let track = qq::song(&raw);
                (
                    providers::first_text(&[&track["albumMid"], &track["albumId"]]),
                    track["artists"].as_array().cloned().unwrap_or_default(),
                )
            }
            Provider::Kugou => kugou::catalogue::references(client, song_id, account).await?,
            Provider::Qishui => {
                let result = qishui::details(client, song_id, account).await?;
                let track = &result["track"];
                (
                    providers::text(&track["album"]["id"]),
                    track["artists"].as_array().cloned().unwrap_or_default(),
                )
            }
        };
        if is_album {
            if album.is_empty() || album == "0" {
                return Ok(
                    json!({"ok":true,"albumAvailable":false,"album":null,"songs":[],"total":0,
                    "provider":platform.name(),"reason":"song_has_no_album","message":"当前平台未为这首音频关联专辑",
                    "hasMore":false,"nextOffset":0,"offset":0,"limit":limit}),
                );
            }
            identifier = album;
        } else {
            let name = value(query, &["name"]).trim();
            let mut candidates = artists.iter().filter(|artist| {
                let label =
                    providers::first_text(&[&artist["name"], &artist["simple_display_name"]]);
                name.is_empty() || label.trim().to_lowercase() == name.to_lowercase()
            });
            let artist = candidates.next().context("未找到当前歌曲的歌手编号")?;
            ensure!(
                candidates.next().is_none(),
                "歌曲有多位歌手，请选择歌手名称"
            );
            identifier = providers::first_text(&[&artist["mid"], &artist["id"]]);
            resolved = Some(artist.clone());
        }
    }
    let mut result = match (platform, is_album) {
        (Provider::Netease, true) => {
            netease::album(client, &identifier, offset, limit, account).await?
        }
        (Provider::Netease, false) => {
            netease::artist(client, &identifier, offset, limit, account).await?
        }
        (Provider::Qq, true) => {
            qq::catalogue::album(client, &identifier, offset, limit, account).await?
        }
        (Provider::Qq, false) => {
            qq::catalogue::artist(client, &identifier, offset, limit, account).await?
        }
        (Provider::Kugou, _) => {
            kugou::catalogue::detail(client, &identifier, offset, limit, is_album, account).await?
        }
        (Provider::Qishui, true) => {
            qishui::catalogue::album(client, &identifier, offset, limit, account).await?
        }
        (Provider::Qishui, false) => {
            qishui::catalogue::artist(client, &identifier, offset, limit, account).await?
        }
    };
    result["offset"] = json!(offset);
    result["limit"] = json!(limit);
    if let Some(artist) = resolved {
        result["resolvedArtist"] = artist;
    }
    Ok(result)
}

fn playback_json(
    resolved: &ResolvedTrack,
    provider: Provider,
    key: &str,
    requested: &str,
    selected: Option<&providers::Quality>,
    download: bool,
    playback: bool,
) -> Value {
    let song = &resolved.song;
    let label = selected.map(|row| row.key.as_str()).unwrap_or_default();
    let mut qualities = json!(resolved.qualities);
    if download {
        for row in qualities.as_array_mut().into_iter().flatten() {
            if let Some(object) = row.as_object_mut() {
                object.remove("url");
            }
        }
    }
    json!({
        "provider":provider.name(),"songId":key,"title":song["name"],"author":song["artist"],"album":song["album"],
        "albumId":song["albumId"],"albumMid":song["albumMid"],"duration":song["duration"],"cover":song["cover"],
        "requestedQuality":requested,"quality":label,"nativeQuality":label,"level":label,
        "url":selected.map(|row| row.url.as_str()).unwrap_or_default(),
        "playable":selected.is_some(),"qualities":qualities,"qualitiesComplete":!playback,
        "qualityFallback":selected.is_some() && requested != "auto" && label != requested,
        "trial":selected.is_some_and(|row| row.kind == "试听"),"br":selected.map(|row| row.bitrate*1000),
        "encrypted":selected.is_some_and(|row| row.encrypted),
        "decryption_supported":selected.is_some_and(|row| row.decryption_supported),
        "message": if selected.is_some() { "" } else { "所选音质暂不可用" },
    })
}
