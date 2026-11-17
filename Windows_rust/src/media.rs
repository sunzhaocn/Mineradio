use crate::accounts::{Accounts, Provider};
use anyhow::{Context, Result, ensure};
use axum::body::Body;
use axum::http::{HeaderMap, HeaderValue, StatusCode, header};
use axum::response::Response;
use std::collections::VecDeque;
use std::path::Path;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tokio::io::{AsyncReadExt, AsyncSeekExt, SeekFrom};
use tokio_util::io::ReaderStream;
use url::Url;

const MAX_MEDIA_TICKETS: usize = 4096;
const MEDIA_TTL: Duration = Duration::from_secs(15 * 60);

#[derive(Default)]
pub struct MediaRegistry(Mutex<VecDeque<MediaTicket>>);

struct MediaTicket {
    url: String,
    provider: Provider,
    account: [u8; 32],
    issued: Instant,
}

impl MediaRegistry {
    pub fn register(&self, url: &str, provider: Provider, accounts: &Accounts) -> bool {
        if parse_platform_media(url).is_none() {
            return false;
        }
        let account = accounts.scope(provider);
        let mut records = self.0.lock().expect("media registry poisoned");
        records.retain(|ticket| {
            ticket.issued.elapsed() < MEDIA_TTL
                && !(ticket.url == url && ticket.account == account && ticket.provider == provider)
        });
        records.push_front(MediaTicket {
            url: url.to_owned(),
            provider,
            account,
            issued: Instant::now(),
        });
        records.truncate(MAX_MEDIA_TICKETS);
        true
    }

    pub fn permitted(&self, url: &str, accounts: &Accounts) -> bool {
        self.0
            .lock()
            .expect("media registry poisoned")
            .iter()
            .any(|ticket| {
                ticket.url == url
                    && ticket.issued.elapsed() < MEDIA_TTL
                    && ticket.account == accounts.scope(ticket.provider)
            })
    }
}

pub fn parse_platform_media(value: &str) -> Option<Url> {
    let url = Url::parse(value).ok()?;
    let host = url.host_str()?;
    let legal_host = [
        "126.net",
        "qq.com",
        "qlogo.cn",
        "qpic.cn",
        "gtimg.cn",
        "gtimg.com",
        "kugou.com",
        "kugou.net",
        "kgimg.com",
        "douyinpic.com",
        "douyinvod.com",
        "bytecdn.cn",
        "byteacctimg.com",
        "qishui.com",
        "douyin.com",
        "snssdk.com",
    ]
    .into_iter()
    .any(|domain| {
        host == domain
            || host
                .strip_suffix(domain)
                .is_some_and(|prefix| prefix.ends_with('.'))
    });
    (legal_host
        && matches!(url.scheme(), "http" | "https")
        && url.username().is_empty()
        && url.password().is_none()
        && matches!(url.port_or_known_default(), Some(80 | 443))
        && url.fragment().is_none())
    .then_some(url)
}

pub fn client() -> Result<reqwest::Client> {
    Ok(reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(9))
        .read_timeout(Duration::from_secs(28))
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/145.0.0.0 Safari/537.36")
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() >= 5 || parse_platform_media(attempt.url().as_str()).is_none() {
                attempt.error("invalid media redirect")
            } else {
                attempt.follow()
            }
        }))
        .build()?)
}

pub async fn stream_platform_media(
    client: &reqwest::Client,
    raw: &str,
    request_headers: &HeaderMap,
    image: bool,
    head: bool,
) -> Result<Response> {
    let url = parse_platform_media(raw).context("媒体地址无效")?;
    let host = url.host_str().unwrap_or_default();
    let referer = if host.ends_with("qq.com") || host.ends_with("gtimg.cn") {
        "https://y.qq.com/"
    } else if host.ends_with("kugou.com") || host.ends_with("kugou.net") {
        "https://www.kugou.com/"
    } else if host.ends_with("douyinvod.com") || host.ends_with("qishui.com") {
        "https://www.douyin.com/"
    } else {
        "https://music.163.com/"
    };
    let mut request = client
        .request(
            if head {
                reqwest::Method::HEAD
            } else {
                reqwest::Method::GET
            },
            url,
        )
        .header(header::ACCEPT_ENCODING, "identity")
        .header(header::REFERER, referer);
    for name in [header::RANGE, header::IF_RANGE] {
        if let Some(value) = request_headers.get(&name) {
            request = request.header(name, value);
        }
    }
    let upstream = request.send().await?;
    let status = upstream.status();
    ensure!(
        status.is_success() || status == StatusCode::RANGE_NOT_SATISFIABLE,
        "平台媒体暂不可用"
    );
    let content_type = upstream
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default();
    if image {
        ensure!(
            content_type.starts_with("image/") && content_type != "image/svg+xml",
            "封面格式无效"
        );
    } else {
        ensure!(
            !content_type.starts_with("text/") && !content_type.contains("json"),
            "平台未返回音频"
        );
    }
    let mut response = Response::builder()
        .status(status)
        .header(header::CACHE_CONTROL, "private, no-store")
        .header(header::X_CONTENT_TYPE_OPTIONS, "nosniff");
    for name in [
        header::CONTENT_TYPE,
        header::CONTENT_LENGTH,
        header::CONTENT_RANGE,
        header::ACCEPT_RANGES,
    ] {
        if let Some(value) = upstream.headers().get(&name) {
            response = response.header(name, value);
        }
    }
    let body = if head {
        Body::empty()
    } else {
        Body::from_stream(upstream.bytes_stream())
    };
    Ok(response.body(body)?)
}

fn parse_range(value: &HeaderValue, length: u64) -> Option<(u64, u64)> {
    if length == 0 {
        return None;
    }
    let (begin, end) = value
        .to_str()
        .ok()?
        .strip_prefix("bytes=")?
        .split_once('-')?;
    if begin.is_empty() {
        let suffix = end.parse::<u64>().ok()?;
        return (suffix > 0).then(|| (length.saturating_sub(suffix), length - 1));
    }
    let begin = begin.parse::<u64>().ok()?;
    let end = if end.is_empty() {
        length - 1
    } else {
        end.parse::<u64>().ok()?.min(length - 1)
    };
    (begin <= end).then_some((begin, end))
}

pub async fn stream_file(path: &Path, headers: &HeaderMap, head: bool) -> Result<Response> {
    let mut source = tokio::fs::File::open(path).await?;
    let metadata = source.metadata().await?;
    ensure!(metadata.is_file(), "文件不可用");
    let length = metadata.len();
    let mime = mime_guess::from_path(path).first_or_octet_stream();
    let mut response = Response::builder()
        .header(header::CONTENT_TYPE, mime.as_ref())
        .header(header::ACCEPT_RANGES, "bytes")
        .header(header::CACHE_CONTROL, "private, no-store");
    let (start, count) = if let Some(range) = headers.get(header::RANGE) {
        let Some((start, end)) = parse_range(range, length) else {
            return Ok(response
                .status(StatusCode::RANGE_NOT_SATISFIABLE)
                .header(header::CONTENT_RANGE, format!("bytes */{length}"))
                .header(header::CONTENT_LENGTH, 0)
                .body(Body::empty())?);
        };
        response = response.status(StatusCode::PARTIAL_CONTENT).header(
            header::CONTENT_RANGE,
            format!("bytes {start}-{end}/{length}"),
        );
        (start, end - start + 1)
    } else {
        (0, length)
    };
    let body = if head {
        Body::empty()
    } else {
        source.seek(SeekFrom::Start(start)).await?;
        Body::from_stream(ReaderStream::new(source.take(count)))
    };
    Ok(response.header(header::CONTENT_LENGTH, count).body(body)?)
}

pub fn download_name(name: &str, format: &str) -> String {
    let name: String = name
        .chars()
        .filter(|c| {
            !c.is_control() && !matches!(c, '\\' | '/' | '"' | ':' | '*' | '?' | '<' | '>' | '|')
        })
        .take(130)
        .collect();
    let extension = match format {
        "flac" | "mp3" | "aac" | "wav" | "opus" | "ogg" => format,
        "m4a" | "mp4" => "m4a",
        _ => "audio",
    };
    let qualified = format!(
        "{}.{extension}",
        if name.is_empty() {
            "Mineradio"
        } else {
            name.trim()
        }
    );
    let escaped: String = url::form_urlencoded::byte_serialize(qualified.as_bytes()).collect();
    format!(
        "attachment; filename=\"Mineradio.{extension}\"; filename*=UTF-8''{}",
        escaped.replace('+', "%20")
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_byte_ranges_and_rejects_arbitrary_origins() {
        for (value, expected) in [
            ("bytes=0-1", Some((0, 1))),
            ("bytes=-5", Some((15, 19))),
            ("bytes=19-", Some((19, 19))),
            ("bytes=20-", None),
            ("bytes=5-3", None),
            ("bytes=0-1,5-6", None),
        ] {
            assert_eq!(
                parse_range(&HeaderValue::from_str(value).unwrap(), 20),
                expected
            );
        }
        assert!(parse_platform_media("https://p1.music.126.net/cover").is_some());
        assert!(parse_platform_media("https://evil126.net/cover").is_none());
        assert!(parse_platform_media("https://music.126.net:1234/cover").is_none());
        assert!(parse_platform_media("http://127.0.0.1/cover").is_none());
    }
}
