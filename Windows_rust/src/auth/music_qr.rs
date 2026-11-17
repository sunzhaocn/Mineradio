use super::{MAX_UPSTREAM, Transport, image_data, qq, status, timestamp_ms, valid_cookie};
use crate::providers::{code, first_text, numeric_id, text, uint};
use anyhow::{Context, Result, ensure};
use base64::{Engine, engine::general_purpose::STANDARD};
use bytes::BytesMut;
use futures_util::{SinkExt, StreamExt};
use rumqttc::v5::mqttbytes::v5::{
    Connect, ConnectProperties, ConnectReturnCode, Filter, Packet, PingReq, PubAck, PubComp,
    PubRec, Subscribe, SubscribeProperties, SubscribeReasonCode,
};
use rumqttc::v5::mqttbytes::{Error as PacketError, QoS};
use serde_json::{Value, json};
use std::time::Duration;
use tokio::{
    net::TcpStream,
    sync::{oneshot, watch},
    task::JoinHandle,
    time::{Instant, timeout},
};
use tokio_tungstenite::{
    MaybeTlsStream, WebSocketStream, connect_async_with_config,
    tungstenite::{Message, client::IntoClientRequest, protocol::WebSocketConfig},
};

type WebSocket = WebSocketStream<MaybeTlsStream<TcpStream>>;

#[derive(Clone)]
enum State {
    Waiting,
    Scanned,
    Canceled,
    Expired,
    Unavailable,
    Ticket { user: u64, token: String },
}

pub(super) struct Login {
    device: String,
    qr: String,
    updates: watch::Receiver<State>,
    listener: Option<JoinHandle<()>>,
    exchange_attempted: bool,
}

impl Default for Login {
    fn default() -> Self {
        Self {
            device: uuid::Uuid::new_v4()
                .simple()
                .to_string()
                .to_ascii_uppercase(),
            qr: String::new(),
            updates: watch::channel(State::Waiting).1,
            listener: None,
            exchange_attempted: false,
        }
    }
}

impl Drop for Login {
    fn drop(&mut self) {
        if let Some(task) = self.listener.take() {
            task.abort();
        }
    }
}

impl Login {
    async fn cgi(&self, transport: &Transport, create: bool, param: Value) -> Result<Value> {
        let mut comm = json!({"ct":if create {23}else{19},"cv":if create{0}else{2201},
            "chid":"0","g_tk":5381,"guid":self.device});
        if !create {
            comm["tmeLoginType"] = json!(6);
        }
        let response = transport
            .client
            .post("https://u.y.qq.com/cgi-bin/musicu.fcg")
            .header("referer", "https://y.qq.com/")
            .header("origin", "https://y.qq.com")
            .json(
                &json!({"comm":comm,"req":{"module":"music.login.LoginServer",
                "method":if create{"CreateQRCode"}else{"Login"},"param":param}}),
            )
            .send()
            .await?
            .error_for_status()?;
        let reply: Value = serde_json::from_slice(&super::bytes(response).await?)
            .context("QQ 音乐扫码服务响应无效")?;
        ensure!(
            code(&reply["code"], 0)
                && code(&reply["req"]["code"], 0)
                && reply["req"]["data"].is_object(),
            "QQ 音乐客户端暂未接受扫码请求"
        );
        Ok(reply["req"]["data"].clone())
    }

    pub(super) async fn create(&mut self, transport: &Transport) -> Result<Value> {
        let data = self
            .cgi(
                transport,
                true,
                json!({"tmeAppID":"qqmusic","ct":19,"cv":2201}),
            )
            .await?;
        self.qr = text(&data["qrcodeID"]);
        ensure!(
            (1..=192).contains(&self.qr.len()) && super::safe_id(&self.qr),
            "QQ 音乐未返回有效二维码编号"
        );
        let config: Value = serde_json::from_str(data["webConf"].as_str().unwrap_or_default())
            .context("QQ 音乐未返回客户端扫码配置")?;
        ensure!(
            config["qrcodeTitle"].is_string() || config["qrcodeDesc"].is_string(),
            "QQ 音乐未返回客户端扫码配置"
        );
        let raw = data["qrcode"].as_str().context("QQ 音乐未返回二维码")?;
        let bytes = STANDARD
            .decode(raw.rsplit(',').next().unwrap_or_default())
            .context("QQ 音乐二维码格式无效")?;
        ensure!(
            bytes.starts_with(b"\x89PNG\r\n\x1a\n"),
            "QQ 音乐二维码格式无效"
        );
        let decoded =
            image::load_from_memory_with_format(&bytes, image::ImageFormat::Png)?.to_rgba8();
        ensure!(
            decoded.width() <= 2048 && decoded.height() <= 2048,
            "QQ 音乐二维码尺寸无效"
        );
        let border = (decoded.width() / 18).max(12);
        let mut canvas = image::RgbaImage::from_pixel(
            decoded.width() + border * 2,
            decoded.height() + border * 2,
            image::Rgba([255, 255, 255, 255]),
        );
        image::imageops::overlay(&mut canvas, &decoded, i64::from(border), i64::from(border));
        let mut output = std::io::Cursor::new(Vec::new());
        canvas.write_to(&mut output, image::ImageFormat::Png)?;
        let ttl = match uint(&data["expiresIn"]) {
            0 => 180,
            ttl => ttl.clamp(30, 900),
        };
        let (state, updates) = watch::channel(State::Waiting);
        let (ready, subscribed) = oneshot::channel();
        let qr = self.qr.clone();
        self.updates = updates;
        self.listener = Some(tokio::spawn(async move {
            if listen(qr, ttl, state.clone(), ready).await.is_err() {
                let _ = state.send(State::Unavailable);
            }
        }));
        timeout(Duration::from_secs(28), subscribed)
            .await
            .ok()
            .and_then(std::result::Result::ok)
            .context("连接 QQ 音乐客户端扫码服务失败，请重新获取二维码")?;
        let mut result = status("waiting", "等待 QQ 音乐 App 扫码");
        result["qr_image"] = json!(image_data(output.get_ref())?);
        result["expires_in"] = json!(ttl);
        Ok(result)
    }

    pub(super) async fn poll(&mut self, transport: &Transport) -> Result<Value> {
        let event = self.updates.borrow().clone();
        Ok(match event {
            State::Waiting => status("waiting", "等待 QQ 音乐 App 扫码"),
            State::Scanned => status("scanned", "已扫码，请在 QQ 音乐 App 确认登录"),
            State::Canceled => status("cancelled", "已取消 QQ 音乐客户端登录"),
            State::Expired => status("expired", "二维码已过期，请重新生成"),
            State::Unavailable => status("expired", "QQ 音乐客户端扫码连接已断开，请重新生成"),
            State::Ticket { user, token } => {
                if self.exchange_attempted {
                    return Ok(status("expired", "QQ 音乐登录未确认，请重新获取二维码"));
                }
                self.exchange_attempted = true;
                let data = self
                    .cgi(
                        transport,
                        false,
                        json!({"musicid":user,"token":token,"qrCodeID":self.qr}),
                    )
                    .await?;
                let actual = first_text(&[&data["musicid"], &data["str_musicid"]]);
                let key = text(&data["musickey"]);
                numeric_id(&actual)?;
                ensure!(valid_cookie("qqmusic_key", &key), "QQ 音乐未返回完整授权");
                let kind = match uint(&data["loginType"]) {
                    1 => 1,
                    2 => 2,
                    _ if key.starts_with("W_X") => 1,
                    _ => 2,
                };
                qq::authorized(transport, &data, kind, &user.to_string(), "")?
            }
        })
    }
}

async fn send(socket: &mut WebSocket, packet: Packet) -> Result<()> {
    let mut bytes = BytesMut::new();
    packet.write(&mut bytes, Some(MAX_UPSTREAM as u32))?;
    Ok(socket.send(Message::Binary(bytes.freeze())).await?)
}

async fn receive(socket: &mut WebSocket, buffer: &mut BytesMut) -> Result<Packet> {
    loop {
        match Packet::read(buffer, Some(MAX_UPSTREAM as u32)) {
            Ok(packet) => return Ok(packet),
            Err(PacketError::InsufficientBytes(_)) => {}
            Err(error) => return Err(error.into()),
        }
        let message = socket.next().await.context("QQ 音乐扫码连接已经关闭")??;
        match message {
            Message::Binary(bytes) => {
                ensure!(
                    buffer.len() + bytes.len() <= MAX_UPSTREAM,
                    "QQ 音乐扫码响应过长"
                );
                buffer.extend_from_slice(&bytes);
            }
            Message::Ping(_) => socket.flush().await?,
            Message::Close(_) => anyhow::bail!("QQ 音乐扫码连接已经关闭"),
            _ => {}
        }
    }
}

async fn connect(qr: &str) -> Result<(WebSocket, BytesMut)> {
    let mut url = "wss://mu.y.qq.com/ws/handshake".to_owned();
    for _ in 0..4 {
        let mut request = url.as_str().into_client_request()?;
        request
            .headers_mut()
            .insert("Sec-WebSocket-Protocol", "mqtt".parse()?);
        request
            .headers_mut()
            .insert("Origin", "https://y.qq.com".parse()?);
        request
            .headers_mut()
            .insert("Referer", "https://y.qq.com/".parse()?);
        request.headers_mut().insert("User-Agent","Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36".parse()?);
        let config = WebSocketConfig::default()
            .max_message_size(Some(MAX_UPSTREAM))
            .max_frame_size(Some(MAX_UPSTREAM));
        let (mut socket, _) = timeout(
            Duration::from_secs(10),
            connect_async_with_config(request, Some(config), false),
        )
        .await??;
        let mut properties = ConnectProperties::new();
        properties.authentication_method = Some("pass".into());
        properties.user_properties = [
            ("tmeAppID", "qqmusic"),
            ("business", "management"),
            ("hashTag", qr),
            ("clientTag", "management.user"),
            ("userID", qr),
        ]
        .into_iter()
        .map(|(key, value)| (key.to_owned(), value.to_owned()))
        .collect();
        send(
            &mut socket,
            Packet::Connect(
                Connect {
                    keep_alive: 45,
                    clean_start: true,
                    client_id: format!(
                        "{}{:04}",
                        timestamp_ms(),
                        uuid::Uuid::new_v4().as_u128() % 10_000
                    ),
                    properties: Some(properties),
                },
                None,
                None,
            ),
        )
        .await?;
        let mut buffer = BytesMut::new();
        let Packet::ConnAck(confirmation) =
            timeout(Duration::from_secs(10), receive(&mut socket, &mut buffer)).await??
        else {
            anyhow::bail!("QQ 音乐未确认扫码连接");
        };
        if confirmation.code == ConnectReturnCode::Success {
            return Ok((socket, buffer));
        }
        ensure!(
            matches!(
                confirmation.code,
                ConnectReturnCode::UseAnotherServer | ConnectReturnCode::ServerMoved
            ),
            "QQ 音乐拒绝扫码连接"
        );
        let reference = confirmation
            .properties
            .and_then(|item| item.server_reference)
            .filter(|reference| {
                (1..=200).contains(&reference.len())
                    && reference.bytes().all(|byte| {
                        byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b':' | b'-')
                    })
            })
            .context("QQ 音乐扫码重定向无效")?;
        url = format!("wss://mu.y.qq.com/ws/handshake/{reference}");
    }
    anyhow::bail!("QQ 音乐扫码服务重定向过多")
}

async fn listen(
    qr: String,
    ttl: u64,
    updates: watch::Sender<State>,
    ready: oneshot::Sender<()>,
) -> Result<()> {
    let deadline = Instant::now() + Duration::from_secs(ttl);
    let (mut socket, mut buffer) = connect(&qr).await?;
    let topic = format!("management.qrcode_login/{qr}");
    let mut subscribe = Subscribe::new(
        Filter::new(&topic, QoS::AtMostOnce),
        Some(SubscribeProperties {
            id: None,
            user_properties: vec![
                ("authorization".into(), "tmelogin".into()),
                ("pubsub".into(), "unicast".into()),
            ],
        }),
    );
    subscribe.pkid = 1;
    send(&mut socket, Packet::Subscribe(subscribe)).await?;
    let Packet::SubAck(agreement) =
        timeout(Duration::from_secs(10), receive(&mut socket, &mut buffer)).await??
    else {
        anyhow::bail!("QQ 音乐未确认扫码订阅");
    };
    ensure!(
        agreement.pkid == 1
            && agreement.return_codes == [SubscribeReasonCode::Success(QoS::AtMostOnce)],
        "QQ 音乐不接受扫码订阅"
    );
    ready.send(()).ok().context("登录会话已关闭")?;
    let mut keepalive = tokio::time::interval(Duration::from_secs(25));
    keepalive.tick().await;
    loop {
        let packet = tokio::select! {
            _=tokio::time::sleep_until(deadline)=>{let _=updates.send(State::Expired); return Ok(());}
            _=keepalive.tick()=>{send(&mut socket,Packet::PingReq(PingReq)).await?;continue;}
            packet=receive(&mut socket,&mut buffer)=>packet?,
        };
        match packet {
            Packet::Publish(event) if event.topic.as_ref() == topic.as_bytes() => {
                match event.qos {
                    QoS::AtMostOnce => {}
                    QoS::AtLeastOnce => {
                        send(&mut socket, Packet::PubAck(PubAck::new(event.pkid, None))).await?
                    }
                    QoS::ExactlyOnce => {
                        send(&mut socket, Packet::PubRec(PubRec::new(event.pkid, None))).await?
                    }
                }
                let mode = event
                    .properties
                    .as_ref()
                    .and_then(|props| props.user_properties.iter().find(|(key, _)| key == "type"))
                    .map_or("", |(_, value)| value.as_str());
                let state = match mode {
                    "scanned" => State::Scanned,
                    "canceled" => State::Canceled,
                    "timeout" => State::Expired,
                    "loginFailed" => State::Unavailable,
                    "cookies" => {
                        let ticket: Value = serde_json::from_slice(&event.payload)?;
                        let cookies = &ticket["cookies"];
                        let user = numeric_id(&text(&cookies["qqmusic_uin"]["value"]))?;
                        let token = text(&cookies["qqmusic_key"]["value"]);
                        ensure!(
                            valid_cookie("qqmusic_key", &token),
                            "QQ 音乐未返回有效扫码票据"
                        );
                        State::Ticket { user, token }
                    }
                    _ => continue,
                };
                let done = !matches!(state, State::Scanned);
                let _ = updates.send(state);
                if done {
                    return Ok(());
                }
            }
            Packet::PubRel(event) => {
                send(&mut socket, Packet::PubComp(PubComp::new(event.pkid, None))).await?
            }
            Packet::Disconnect(_) => anyhow::bail!("QQ 音乐扫码连接已经关闭"),
            _ => {}
        }
    }
}
