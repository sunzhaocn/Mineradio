use super::{AGENT, HOST, allowed};
use crate::auth::{Transport, bytes, valid_cookie};
use anyhow::{Context, Result, ensure};
use base64::{
    Engine,
    engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD},
};
use futures_util::{SinkExt, StreamExt};
use md5::{Digest, Md5};
use serde_json::{Value, json};
use sha2::Sha256;
use std::collections::HashMap;
use std::io::{Cursor, Read};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;
use tokio::net::TcpStream;
use tokio::process::{Child, Command};
use tokio::sync::OnceCell;
use tokio::time::{Instant, sleep, timeout};
use tokio_tungstenite::{MaybeTlsStream, WebSocketStream, connect_async, tungstenite::Message};
use url::Url;
use windows_sys::Win32::System::Threading::CREATE_NO_WINDOW;

// The same GPL-3.0 bundle and revision used by the original Windows client.
const ARCHIVE: &str = concat!(
    "https://raw.githubusercontent.com/Wx2yZx/Mineradio-Qishui-QR-Login/",
    "aaadaab7d011714f94fbe45b382ba8dcc7cf17b9/Mineradio-Qishui-QR-Login.zip"
);
const CHECKSUM: &str = "01f21138ec2ad602a32893b8aea683d0548abbc37091edafba7b50c90561ff07";
const DIRECTORY: &str = "Mineradio-Qishui-QR-Login-v2.0.2/drop-in/qishui-auth-v6/";
const FILES: [&str; 6] = [
    "security_seed.html",
    "security_host.html",
    "bdms.js",
    "sdk-glue.js",
    "react.js",
    "react-dom.js",
];
const SDK_LINKS: [&str; 2] = [
    "https://lf-headquarters-speed.yhgfb-cn-static.com/obj/rc-client-security/web/stable/1.0.0.41/bdms.js",
    "https://lf-c-flwb.bytetos.com/obj/rc-client-security/web/stable/1.0.0.41/bdms.js",
];
static ASSETS: OnceCell<HashMap<String, String>> = OnceCell::const_new();

async fn assets() -> Result<&'static HashMap<String, String>> {
    ASSETS.get_or_try_init(|| async {
        let client = reqwest::Client::builder().redirect(reqwest::redirect::Policy::none())
            .connect_timeout(Duration::from_secs(6)).timeout(Duration::from_secs(12)).build()?;
        let response = client.get(ARCHIVE).send().await?.error_for_status()?;
        let zipped = bytes(response).await?;
        ensure!(zipped.len() <= 2 * 1024 * 1024 && hex::encode(Sha256::digest(&zipped)) == CHECKSUM,
            "汽水安全组件校验失败");
        let mut archive = zip::ZipArchive::new(Cursor::new(zipped))?;
        let mut extracted = HashMap::new();
        for index in 0..archive.len() {
            let file = archive.by_index(index)?;
            let path = file.name().replace('\\', "/");
            let Some(name) = path.strip_prefix(DIRECTORY).filter(|name| FILES.contains(name)) else { continue; };
            ensure!(file.size() < 2 * 1024 * 1024, "汽水安全组件文件过大");
            let mut content = String::new();
            file.take(2 * 1024 * 1024).read_to_string(&mut content)?;
            if name == "security_host.html" {
                content = content.replace("xhr.open(request.method || 'GET', request.url, true);",
                    "xhr.open(request.method || 'GET', request.url, true); xhr.withCredentials = true;");
            }
            extracted.insert(name.to_owned(), STANDARD.encode(content));
        }
        ensure!(extracted.len() == FILES.len(), "汽水安全组件不完整");
        Ok(extracted)
    }).await.context("汽水官方安全组件暂不可用")
}

fn browser_path() -> Option<PathBuf> {
    ["ProgramFiles", "ProgramFiles(x86)", "LOCALAPPDATA"]
        .into_iter()
        .filter_map(std::env::var_os)
        .map(PathBuf::from)
        .flat_map(|root| {
            [
                "Google/Chrome/Application/chrome.exe",
                "Microsoft/Edge/Application/msedge.exe",
            ]
            .map(|relative| root.join(relative))
        })
        .find(|path| path.is_file())
}

struct Connection {
    child: Child,
    socket: WebSocketStream<MaybeTlsStream<TcpStream>>,
    id: u64,
    base: String,
    observed: bool,
    expected_path: String,
    token: String,
    assets: &'static HashMap<String, String>,
}

impl Connection {
    async fn open(
        exe: &Path,
        profile: &Path,
        base: &str,
        token: &str,
        headless: bool,
    ) -> Result<Self> {
        let assets = assets().await?;
        let mut command = Command::new(exe);
        command
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .kill_on_drop(true)
            .args([
                "--remote-debugging-port=0",
                "--remote-debugging-address=127.0.0.1",
                "--no-first-run",
                "--no-default-browser-check",
                "--disable-background-networking",
                "--disable-sync",
                "--disable-extensions",
                "--disable-background-mode",
                "--window-size=980,760",
            ])
            .arg(format!("--user-agent={AGENT}"))
            .arg(format!("--user-data-dir={}", profile.display()));
        if headless {
            command
                .arg("--headless=new")
                .creation_flags(CREATE_NO_WINDOW);
        }
        let active = profile.join("DevToolsActivePort");
        if active.is_file() {
            tokio::fs::remove_file(&active).await?;
        }
        let mut child = command
            .arg("about:blank")
            .spawn()
            .context("无法打开汽水安全组件的浏览器")?;
        let local = reqwest::Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_secs(2))
            .build()?;
        let endpoint = timeout(Duration::from_secs(13), async {
            loop {
                ensure!(child.try_wait()?.is_none(), "汽水安全窗口提前结束");
                if let Ok(record) = tokio::fs::read_to_string(&active).await
                    && let Some(port) = record
                        .lines()
                        .next()
                        .and_then(|value| value.parse::<u16>().ok())
                        .filter(|port| *port >= 1024)
                    && let Ok(response) = local
                        .get(format!("http://127.0.0.1:{port}/json/list"))
                        .send()
                        .await
                    && let Ok(values) = response.json::<Value>().await
                    && let Some(target) = values
                        .as_array()
                        .into_iter()
                        .flatten()
                        .find(|entry| entry["type"] == "page" && entry["url"] == "about:blank")
                    && let Some(endpoint) = target["webSocketDebuggerUrl"].as_str()
                    && Url::parse(endpoint).is_ok_and(|url| {
                        url.scheme() == "ws"
                            && url.host_str() == Some("127.0.0.1")
                            && url.port() == Some(port)
                            && url.path().starts_with("/devtools/page/")
                            && url.username().is_empty()
                            && url.password().is_none()
                    })
                {
                    break Ok::<String, anyhow::Error>(endpoint.to_owned());
                }
                sleep(Duration::from_millis(160)).await;
            }
        })
        .await
        .context("汽水安全窗口启动超时")??;
        let (socket, _) = timeout(Duration::from_secs(4), connect_async(&endpoint))
            .await
            .context("汽水安全窗口连接超时")?
            .map_err(|_| anyhow::anyhow!("无法连接汽水安全窗口"))?;
        let mut connection = Self {
            child,
            socket,
            id: 0,
            base: base.to_owned(),
            observed: false,
            expected_path: String::new(),
            token: token.to_owned(),
            assets,
        };
        let patterns = std::iter::once(format!("{base}*"))
            .chain(SDK_LINKS.map(str::to_owned))
            .map(|url| json!({"urlPattern":url}))
            .collect::<Vec<_>>();
        connection
            .command("Fetch.enable", json!({"patterns":patterns}))
            .await?;
        connection.command("Network.enable", json!({})).await?;
        Ok(connection)
    }

    async fn send(&mut self, method: &str, parameters: Value) -> Result<u64> {
        self.id += 1;
        self.socket
            .send(Message::Text(
                json!({"id":self.id,"method":method,"params":parameters})
                    .to_string()
                    .into(),
            ))
            .await
            .map_err(|_| anyhow::anyhow!("汽水安全窗口已结束"))?;
        Ok(self.id)
    }

    async fn command(&mut self, method: &str, parameters: Value) -> Result<Value> {
        timeout(Duration::from_secs(23), async {
            let id = self.send(method, parameters).await?;
            while let Some(event) = self.socket.next().await {
                let Message::Text(text) =
                    event.map_err(|_| anyhow::anyhow!("汽水安全窗口已结束"))?
                else {
                    continue;
                };
                let data = serde_json::from_str::<Value>(&text).context("汽水安全窗口消息无效")?;
                if data["id"] == id {
                    ensure!(data["error"].is_null(), "汽水安全窗口无法完成操作");
                    return Ok(data["result"].clone());
                }
                if data["method"] == "Fetch.requestPaused" {
                    self.asset(&data["params"]).await?;
                }
                if data["method"] == "Network.requestWillBeSent" && !self.expected_path.is_empty() {
                    let target = data["params"]["request"]["url"]
                        .as_str()
                        .and_then(|name| Url::parse(name).ok());
                    self.observed |= target.as_ref().is_some_and(|target| {
                        target.path() == self.expected_path && self.signature(target)
                    });
                }
            }
            anyhow::bail!("汽水安全窗口已结束")
        })
        .await
        .context("汽水安全窗口处理超时")?
    }

    async fn asset(&mut self, payload: &Value) -> Result<()> {
        let url = payload["request"]["url"].as_str().unwrap_or_default();
        let name = if SDK_LINKS.contains(&url) {
            "bdms.js"
        } else {
            url.strip_prefix(&self.base).unwrap_or_default()
        };
        let media = if name.ends_with(".html") {
            "text/html; charset=utf-8"
        } else {
            "text/javascript; charset=utf-8"
        };
        let content = self.assets.get(name);
        self.send("Fetch.fulfillRequest", json!({"requestId":payload["requestId"],
            "responseCode":if content.is_some() {200} else {404},"body":content.map(String::as_str).unwrap_or(""),
            "responseHeaders":[{"name":"Content-Type","value":media},{"name":"Cache-Control","value":"no-store"},
                {"name":"Access-Control-Allow-Origin","value":HOST}]})).await?;
        Ok(())
    }

    fn signature(&self, url: &Url) -> bool {
        allowed(url)
            && url
                .query_pairs()
                .any(|(key, value)| key == "a_bogus" && value.len() == 44)
            && url
                .query_pairs()
                .any(|(key, value)| key == "msToken" && value == self.token)
    }

    async fn evaluate(&mut self, expression: String, await_promise: bool) -> Result<Value> {
        let reply = self
            .command(
                "Runtime.evaluate",
                json!({"expression":expression,
            "returnByValue":true,"awaitPromise":await_promise}),
            )
            .await?;
        ensure!(reply["exceptionDetails"].is_null(), "汽水安全组件执行失败");
        Ok(reply["result"]["value"].clone())
    }

    async fn navigate(&mut self, document: &str, ready: &str) -> Result<()> {
        let url = format!("{}{document}", self.base);
        let navigation = self.command("Page.navigate", json!({"url":url})).await?;
        ensure!(
            navigation["errorText"].is_null(),
            "汽水安全组件页面无法加载"
        );
        let condition = format!(
            "location.href === {} && ({ready}) ? true : false",
            serde_json::to_string(&url)?
        );
        let deadline = Instant::now() + Duration::from_secs(12);
        while Instant::now() < deadline {
            if self
                .evaluate(condition.clone(), false)
                .await
                .is_ok_and(|value| value == true)
            {
                return Ok(());
            }
            sleep(Duration::from_millis(150)).await;
        }
        anyhow::bail!("汽水安全组件初始化超时")
    }

    async fn close(&mut self) {
        let _ = timeout(
            Duration::from_secs(2),
            self.command("Browser.close", json!({})),
        )
        .await;
        if timeout(Duration::from_secs(3), self.child.wait())
            .await
            .is_err()
        {
            let _ = self.child.kill().await;
        }
    }
}

pub(super) struct Browser {
    connection: Connection,
    profile: tempfile::TempDir,
    executable: PathBuf,
    fingerprint: String,
    portrait: String,
    headed: bool,
}

impl Browser {
    pub(super) async fn open() -> Result<Self> {
        let executable = browser_path().context("汽水安全验证需要本机 Chrome 或 Edge")?;
        let profile = tempfile::Builder::new()
            .prefix("mineradio-qishui-auth-")
            .tempdir()?;
        let base = format!("{HOST}/__music_auth/{}/", uuid::Uuid::new_v4().simple());
        let mut secret = [0u8; 88];
        getrandom::fill(&mut secret).context("无法准备汽水登录会话")?;
        let token = format!("{}==", URL_SAFE_NO_PAD.encode(secret));
        let mut connection =
            Connection::open(&executable, profile.path(), &base, &token, true).await?;
        let fingerprint = Self::prepare(&mut connection).await?;
        Ok(Self {
            connection,
            profile,
            executable,
            fingerprint,
            portrait: format!("{}.login", uuid::Uuid::new_v4()),
            headed: false,
        })
    }

    async fn prepare(connection: &mut Connection) -> Result<String> {
        connection
            .navigate("security_seed.html", "document.readyState === 'complete'")
            .await?;
        let token = serde_json::to_string(&connection.token)?;
        connection.evaluate(format!("localStorage.setItem('xmst',{token});localStorage.setItem('xmsty',{token});true"), false).await?;
        connection
            .navigate(
                "security_host.html",
                "window.bdms && window._sdkGlueVersionMap?.bdmsVersion",
            )
            .await?;
        let fingerprint = connection
            .evaluate("window.__qishuiBrowserInfo()".into(), true)
            .await?;
        fingerprint["encrypted"]
            .as_str()
            .filter(|value| !value.is_empty() && value.len() < 8192)
            .map(str::to_owned)
            .context("汽水安全组件未返回浏览器标识")
    }

    async fn copy_cookies(&mut self, transport: &Transport) -> Result<()> {
        let cookies = self
            .connection
            .command(
                "Network.getCookies",
                json!({"urls":[HOST,"https://www.qishui.com","https://bff-pc.qishui.com"]}),
            )
            .await?;
        for cookie in cookies["cookies"].as_array().into_iter().flatten() {
            let domain = cookie["domain"]
                .as_str()
                .unwrap_or_default()
                .trim_start_matches('.');
            let Some((name, value)) = cookie["name"].as_str().zip(cookie["value"].as_str()) else {
                continue;
            };
            if !matches!(
                domain,
                "qishui.com" | "api.qishui.com" | "www.qishui.com" | "bff-pc.qishui.com"
            ) || !valid_cookie(name, value)
            {
                continue;
            }
            let address = Url::parse(&format!("https://{domain}"))?;
            transport.jar.add_cookie_str(
                &format!("{name}={value}; Domain={domain}; Path=/; Secure; HttpOnly"),
                &address,
            );
        }
        Ok(())
    }

    pub(super) async fn request(
        &mut self,
        mut url: Url,
        form: Option<&[(&str, &str)]>,
        transport: &Transport,
    ) -> Result<Value> {
        ensure!(
            allowed(&url) && url.path().starts_with("/passport/"),
            "汽水安全请求地址无效"
        );
        let trace = uuid::Uuid::new_v4().simple().to_string()[..8].to_owned();
        let query = url
            .query_pairs()
            .into_owned()
            .filter(|(key, _)| key != "passport_jssdk_version")
            .collect::<Vec<_>>();
        url.set_query(None);
        url.query_pairs_mut().extend_pairs(query).extend_pairs([
            ("passport_jssdk_version", "2.4.13"),
            ("p_js_v", "2.4.13"),
            ("p_js_t", "pro"),
            ("p_zt", "3.3.5"),
            ("p_ver", "1.0.29"),
            ("request_host", "app%3A%2F%2Fresources"),
            ("p_bd", "1.0.0.41"),
            ("biz_trace_id", &trace),
            ("msToken", &self.connection.token),
            ("account_sdk_source_info", &self.fingerprint),
        ]);
        let mut headers = json!({"accept":"application/json, text/javascript","x-tt-passport-verify-portrait":self.portrait,
            "x-tt-passport-trace-id":trace});
        let body = if let Some(form) = form {
            let body = serde_urlencoded::to_string(form)?;
            headers["content-type"] = json!("application/x-www-form-urlencoded");
            headers["x-ss-stub"] = json!(hex::encode_upper(Md5::digest(body.as_bytes())));
            let cookies = transport.cookies(HOST);
            if let Some(token) = cookies
                .get("passport_csrf_token")
                .or_else(|| cookies.get("passport_csrf_token_default"))
            {
                headers["x-tt-passport-csrf-token"] = json!(token);
            }
            Some(body)
        } else {
            None
        };
        self.connection.observed = false;
        self.connection.expected_path = url.path().to_owned();
        let parameters = json!({"url":url.as_str(),"method":if body.is_some(){"POST"}else{"GET"},"headers":headers,"body":body,"timeout":20000});
        let response = self
            .connection
            .evaluate(format!("window.__qishuiRequest({parameters})"), true)
            .await?;
        self.connection.expected_path.clear();
        let signed_url = response["responseURL"]
            .as_str()
            .and_then(|url| Url::parse(url).ok());
        ensure!(
            self.connection.observed
                || signed_url
                    .as_ref()
                    .is_some_and(|url| self.connection.signature(url)),
            "汽水官方安全签名未就绪，请重新获取二维码"
        );
        ensure!(
            response["status"]
                .as_u64()
                .is_some_and(|code| (200..400).contains(&code)),
            "汽水登录服务暂时不可用"
        );
        self.copy_cookies(transport).await?;
        let body = response["body"]
            .as_str()
            .filter(|body| body.len() <= 2 * 1024 * 1024)
            .context("汽水安全会话返回格式异常")?;
        serde_json::from_str(body).context("汽水安全会话返回格式异常")
    }

    pub(super) async fn begin_verification(
        &mut self,
        result: &Value,
        device: &str,
        installation: &str,
    ) -> Result<()> {
        let mut decision = result.clone();
        if let (Some(fields), Some(outer)) = (result["data"].as_object(), decision.as_object_mut())
        {
            outer.remove("data");
            outer.extend(fields.clone());
        }
        decision["verify_portrait_id"] = json!(self.portrait);
        if !self.headed {
            self.connection.close().await;
            let replacement = Connection::open(
                &self.executable,
                self.profile.path(),
                &self.connection.base,
                &self.connection.token,
                false,
            )
            .await?;
            self.connection = replacement;
            self.fingerprint = Self::prepare(&mut self.connection).await?;
            self.headed = true;
        }
        self.connection
            .command("Page.bringToFront", json!({}))
            .await?;
        let options = json!({"generalParams":{"device_id":device,"install_id":installation,"did":device,"iid":installation,
            "device_platform":"PC","version_code":"3.7.0"}});
        self.connection.evaluate(format!("window.__authMfaResult=null;window.__qishuiSecondVerify({decision},{options}).then(value=>window.__authMfaResult=value).catch(()=>window.__authMfaResult={{status:false}});true"), false).await?;
        Ok(())
    }

    pub(super) async fn verification(&mut self) -> Result<Option<bool>> {
        let result = self
            .connection
            .evaluate("window.__authMfaResult || null".into(), false)
            .await?;
        Ok((!result.is_null()).then(|| result["status"] == true))
    }

    pub(super) async fn close(&mut self) {
        self.connection.close().await;
    }
}
