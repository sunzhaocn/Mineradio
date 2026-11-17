use super::{
    Transport, bytes, cookie_header, image_data, qr_image, status, timestamp_ms, valid_cookie,
};
use crate::accounts::Account;
use crate::providers::{self, code, numeric_id, text};
use anyhow::{Context, Result, ensure};
use base64::{Engine, engine::general_purpose::STANDARD};
use cbc::cipher::{BlockEncryptMut, KeyIvInit, block_padding::Pkcs7};
use md5::{Digest, Md5};
use num_bigint::BigUint;
use serde_json::{Value, json};
use std::collections::BTreeMap;
use std::sync::LazyLock;
use url::Url;

const LOGIN: &str = "https://login-user.kugou.com";
const EXCHANGE: &str = "https://loginservice.kugou.com";
const SALT: &str = "NVPh5oo715z5DIWAeQlhMDsWXXQV4hwt";
const H5: &str = "https://h5.kugou.com/apps/loginQRCode/html/index.html";
static PUBLIC: LazyLock<BigUint> = LazyLock::new(|| {
    BigUint::parse_bytes(
        concat!(
            "B1B1EC76A1BBDBF0D18E8CD9A87E53FA3881E2F004C67C9DDA2CA677DBEFA3D6",
            "1DF8463FE12D84FF4B4699E02C9D41CAB917F5A8FB9E35580C4BDF97763A0420A",
            "476295D763EE10174E6F9EBF7DF8A77BA5B20CDA4EE705DEF5BBA3C88567B9656E5",
            "2C9CD5CD95CA735FF2D25F762B133273EEEB7B4F3EA8B6DA29040F3B67CD"
        )
        .as_bytes(),
        16,
    )
    .expect("Kugou public key")
});

pub struct Login {
    mid: String,
    qr: String,
    exchange_ticket: Option<(String, String)>,
}

impl Login {
    pub fn new() -> Self {
        let mid = hex::encode(Md5::digest(uuid::Uuid::new_v4().to_string().as_bytes()));
        Self {
            mid,
            qr: String::new(),
            exchange_ticket: None,
        }
    }

    pub(super) async fn create(&mut self, transport: &Transport) -> Result<Value> {
        let site = Url::parse(LOGIN)?;
        for name in ["kg_mid", "kg_mid_temp"] {
            transport.jar.add_cookie_str(
                &format!("{name}={}; Domain=.kugou.com; Path=/; Secure", self.mid),
                &site,
            );
        }
        let request = self
            .request(
                transport,
                LOGIN,
                "/v2/qrcode",
                &[
                    ("type", "1".into()),
                    ("plat", "4".into()),
                    ("qrcode_txt", format!("{H5}?appid=1014&")),
                ],
                false,
            )
            .await?;
        self.qr = text(&request["qrcode"]);
        ensure!(
            !self.qr.is_empty() && self.qr.len() < 4096,
            "酷狗未返回扫码会话"
        );
        let mut url = Url::parse(H5)?;
        url.query_pairs_mut()
            .append_pair("appid", "1014")
            .append_pair("qrcode", &self.qr);
        let mut result = status("waiting", "请使用酷狗音乐 App 扫码并确认登录");
        result["qr_url"] = json!(url.as_str());
        let official = request["qrcode_img"]
            .as_str()
            .and_then(|value| value.strip_prefix("data:image/"))
            .and_then(|value| value.split_once(";base64,"))
            .filter(|(mime, _)| matches!(*mime, "png" | "jpeg" | "gif"))
            .and_then(|(_, content)| STANDARD.decode(content).ok())
            .and_then(|image| image_data(&image).ok());
        result["qr_image"] = json!(match official {
            Some(image) => image,
            None => qr_image(&url)?,
        });
        Ok(result)
    }

    pub(super) async fn poll(&mut self, transport: &Transport) -> Result<Value> {
        if self.exchange_ticket.is_none() {
            let data = self
                .request(
                    transport,
                    LOGIN,
                    "/v2/get_userinfo_qrcode",
                    &[("plat", "4".into()), ("qrcode", self.qr.clone())],
                    false,
                )
                .await?;
            match providers::uint(&data["status"]) {
                0 if code(&data["status"], 0) => {
                    return Ok(status("expired", "酷狗登录二维码已过期，请重新生成"));
                }
                1 => return Ok(status("waiting", "等待酷狗音乐 App 扫码")),
                2 => return Ok(status("scanned", "已扫码，请在酷狗音乐 App 确认登录")),
                4 => {
                    let token = text(&data["token"]);
                    let user = text(&data["userid"]);
                    ensure!(valid_cookie("token", &token), "酷狗未返回有效的登录票据");
                    numeric_id(&user)?;
                    self.exchange_ticket = Some((token, user));
                }
                _ => return Ok(status("failed", "酷狗返回了未知的扫码状态")),
            }
        }
        let (token, user) = self.exchange_ticket.as_ref().context("酷狗缺少登录票据")?;
        let seed = uuid::Uuid::new_v4().simple().to_string()[..16].to_ascii_uppercase();
        let key = hex::encode(Md5::digest(seed.as_bytes()));
        let key_bytes = key.as_bytes();
        let encrypted = cbc::Encryptor::<aes::Aes256>::new_from_slices(key_bytes, &key_bytes[16..])
            .ok()
            .context("酷狗网页登录初始化失败")?
            .encrypt_padded_vec_mut::<Pkcs7>(&serde_json::to_vec(&json!({"token":token}))?);
        let now = timestamp_ms();
        let mut rsa = serde_json::to_vec(&json!({"clienttime_ms":now,"key":seed}))?;
        rsa.resize(128, 0);
        let pk = BigUint::from_bytes_be(&rsa).modpow(&BigUint::from(65537u32), &PUBLIC);
        let profile = self
            .request(
                transport,
                EXCHANGE,
                "/v1/login_by_token_get",
                &[
                    ("clientver", "1000".into()),
                    ("clienttime", (now / 1000).to_string()),
                    ("clienttime_ms", now.to_string()),
                    ("dev", "web".into()),
                    ("userid", user.clone()),
                    ("plat", "4".into()),
                    ("pk", format!("{pk:0>256x}")),
                    ("params", hex::encode(encrypted)),
                ],
                true,
            )
            .await?;
        let mut cookies = transport.cookies("https://www.kugou.com/");
        cookies.extend(transport.cookies(EXCHANGE));
        let context = Account {
            cookie: cookie_header(cookies.clone()),
            session_config: None,
        };
        let (web_token, web_user) = providers::kugou::login_fields(&context);
        ensure!(
            web_user == *user && valid_cookie("t", &web_token),
            "酷狗未签发完整的网页登录凭据"
        );
        cookies.extend([
            ("token".into(), token.clone()),
            ("userid".into(), user.clone()),
            ("t".into(), web_token),
            ("KugooID".into(), user.clone()),
            ("kg_mid".into(), self.mid.clone()),
            ("kg_dfid".into(), "-".into()),
        ]);
        let mut result = status("authorized", "酷狗音乐登录成功");
        result["cookie"] = json!(cookie_header(cookies));
        result["account"] =
            json!({"id":user,"name":text(&profile["nickname"]),"avatar":text(&profile["pic"])});
        Ok(result)
    }

    async fn request(
        &self,
        transport: &Transport,
        host: &str,
        route: &str,
        fields: &[(&str, String)],
        post: bool,
    ) -> Result<Value> {
        let mut params = BTreeMap::from([
            ("mid", self.mid.clone()),
            ("uuid", self.mid.clone()),
            ("dfid", "-".into()),
            ("appid", "1014".into()),
            ("srcappid", "2919".into()),
            ("clientver", "20000".into()),
            ("clienttime", timestamp_ms().to_string()),
        ]);
        params.extend(fields.iter().cloned());
        let mut hash = Md5::new();
        hash.update(SALT);
        for (key, value) in &params {
            hash.update(key);
            hash.update(b"=");
            hash.update(value);
        }
        hash.update(SALT);
        params.insert("signature", hex::encode(hash.finalize()));
        let url = format!("{host}{route}");
        let request = if post {
            transport.client.post(&url).body("").header("origin", LOGIN)
        } else {
            transport.client.get(&url)
        };
        let response = request
            .query(&params)
            .header("referer", "https://login-user.kugou.com/login/?appid=1014")
            .header("mid", &self.mid)
            .header("dfid", "-")
            .header("clienttime", &params["clienttime"])
            .header("accept", "application/json")
            .send()
            .await?
            .error_for_status()?;
        ensure!(
            !response.headers().contains_key("SSA-CODE"),
            "酷狗要求额外安全验证，请在官方客户端完成"
        );
        // Retain only recognized first-party cookies when the upstream uses legacy syntax.
        for header in response.headers().get_all("set-cookie") {
            let Some((name, value)) = header
                .to_str()
                .ok()
                .and_then(|raw| raw.split(';').next())
                .and_then(|pair| pair.trim().split_once('='))
            else {
                continue;
            };
            let value = value.trim_matches('"');
            if matches!(name, "KuGoo" | "KugooID" | "UserId" | "t" | "Token")
                && valid_cookie(name, value)
            {
                let site = Url::parse(host)?;
                transport.jar.add_cookie_str(
                    &format!("{name}={value}; Domain=.kugou.com; Path=/; Secure"),
                    &site,
                );
            }
        }
        let raw = bytes(response).await?;
        let parsed: Value =
            serde_json::from_slice(raw.strip_prefix(b"\xef\xbb\xbf").unwrap_or(&raw))?;
        ensure!(
            code(&parsed["status"], 1)
                && (parsed["error_code"].is_null() || code(&parsed["error_code"], 0))
                && parsed["data"].is_object(),
            "酷狗未接受扫码登录请求"
        );
        Ok(parsed["data"].clone())
    }
}
