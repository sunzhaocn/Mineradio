// QQ Music's Android playlist transport, ported from music_app/providers/qqmusic/
// mobile_protocol.py and its GPL-3.0-or-later QQMusicApi source.
use crate::accounts::Account;
use crate::providers::{code, numeric_id, request_json, text};
use aes::Aes128;
use aes::cipher::{BlockEncryptMut, KeyIvInit, block_padding::Pkcs7};
use anyhow::{Context, Result, ensure};
use base64::{Engine, engine::general_purpose::STANDARD};
use md5::{Digest, Md5};
use num_bigint::BigUint;
use ring::digest::{SHA1_FOR_LEGACY_USE_ONLY, digest};
use serde_json::{Value, json};
use sha2::Sha256;
use std::collections::VecDeque;
use std::sync::LazyLock;
use std::time::{Duration, Instant};
use time::OffsetDateTime;
use tokio::sync::Mutex;

const VERSION: &str = "20090008";
const VERSION_NAME: &str = "20.9.0.8";
const CHANNEL: &str = "10003505";
const APP_KEY: &str = "0AND0HD6FE4HY80F";
const APP_ID: &str = "qimei_qq_android";
const USER_AGENT: &str = "QQMusic 20090008(android 15)";
const QIMEI_SECRET: &str = "ZdJqM15EeO2zWc08";
const QIMEI_SIGN_KEY: &str = "qimei_qq_androidpzAuCmaFAaFaHrdakPjLIEqKrGnSOOvH";
const DEVICE_KEY: &[u8; 16] = b"lvcwmSYVr2Axv1gn";
const DEVICE_IV: &[u8; 16] = b"Zs0ntDqG2jyhKN0c";
const PUBLIC_MODULUS: &str = concat!(
    "c4231830a2eb5fc2827170641e79d80fec51bda9a22e4b4ab37d1f205a4ae44d9",
    "28cda25879f66a3429051663312a127faf8a246bdaaf63918417e90d7c95b5908",
    "aa6a2d0f852e4a6770294a548ac1c2fe8f1f252fb826f4ac86ab9a00e7ce47d",
    "002a56e7c4b51eb889acc60ca6adbc9f72e81f4d31b1dd7464805264530ab1d",
);

static SESSIONS: LazyLock<Mutex<VecDeque<Session>>> = LazyLock::new(Mutex::default);

struct Device {
    android: String,
    open_id: String,
    open_id2: String,
    imei: String,
}

#[derive(Clone)]
struct Session {
    scope: [u8; 32],
    issued: Instant,
    communication: Value,
}

#[derive(Debug)]
pub struct WriteRequiresLogin;

impl std::fmt::Display for WriteRequiresLogin {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("QQ 音乐拒绝当前 Cookie 的写入授权，请重新登录或更新服务器 Cookie")
    }
}

impl std::error::Error for WriteRequiresLogin {}

fn random<const N: usize>() -> Result<[u8; N]> {
    let mut bytes = [0; N];
    getrandom::fill(&mut bytes).context("无法生成 QQ 设备所需的随机数")?;
    Ok(bytes)
}

impl Device {
    fn new() -> Result<Self> {
        let mut digits = random::<14>()?.map(|byte| byte % 10);
        let mut checksum = 0u32;
        for (index, digit) in digits.iter_mut().enumerate() {
            let value = u32::from(*digit) * (1 + index as u32 % 2);
            checksum += value / 10 + value % 10;
            *digit += b'0';
        }
        let imei = format!(
            "{}{}",
            std::str::from_utf8(&digits).expect("decimal digits"),
            (10 - checksum % 10) % 10
        );
        Ok(Self {
            android: hex::encode(random::<8>()?),
            open_id: uuid::Uuid::new_v4().simple().to_string(),
            open_id2: uuid::Uuid::new_v4().simple().to_string(),
            imei,
        })
    }
}

fn rsa_encrypt(key: &[u8]) -> Result<String> {
    let mut encoded = [0; 128];
    encoded[1] = 2;
    let delimiter = encoded.len() - key.len() - 1;
    for byte in &mut encoded[2..delimiter] {
        while *byte == 0 {
            *byte = random::<1>()?[0];
        }
    }
    encoded[delimiter + 1..].copy_from_slice(key);
    let modulus = BigUint::parse_bytes(PUBLIC_MODULUS.as_bytes(), 16).expect("QQ public key");
    let coded = BigUint::from_bytes_be(&encoded)
        .modpow(&BigUint::from(65_537u32), &modulus)
        .to_bytes_be();
    let offset = encoded.len() - coded.len();
    encoded.fill(0);
    encoded[offset..].copy_from_slice(&coded);
    Ok(STANDARD.encode(encoded))
}

fn aes_encrypt(key: &[u8; 16], iv: &[u8; 16], input: &[u8]) -> String {
    STANDARD.encode(
        cbc::Encryptor::<Aes128>::new(key.into(), iv.into()).encrypt_padded_vec_mut::<Pkcs7>(input),
    )
}

fn md5(parts: &[&str]) -> String {
    let mut hash = Md5::new();
    for part in parts {
        hash.update(part);
    }
    hex::encode(hash.finalize())
}

fn signature(payload: &[u8]) -> String {
    let hash = digest(&SHA1_FOR_LEGACY_USE_ONLY, payload);
    let hexadecimal = hex::encode(hash.as_ref());
    let indices = |order: &[usize]| {
        order
            .iter()
            .map(|index| hexadecimal.as_bytes()[*index] as char)
            .collect::<String>()
    };
    let scrambled = [
        89, 39, 179, 150, 218, 82, 58, 252, 177, 52, 186, 123, 120, 64, 242, 133, 143, 161, 121,
        179,
    ]
    .into_iter()
    .zip(hash.as_ref())
    .map(|(mask, byte)| mask ^ byte)
    .collect::<Vec<_>>();
    let middle = STANDARD.encode(scrambled).replace(['/', '+', '='], "");
    format!(
        "zzc{}{}{}",
        indices(&[23, 14, 6, 36, 16, 7, 19]),
        middle,
        indices(&[16, 1, 32, 12, 19, 27, 8, 5])
    )
    .to_ascii_lowercase()
}

fn beacon(now: OffsetDateTime) -> Result<String> {
    let date = format!("{:04}-{:02}-01", now.year(), u8::from(now.month()));
    let entropy = random::<84>()?;
    let marker = format!(
        "{date}{}.{}",
        100000 + u32::from(u16::from_le_bytes([entropy[80], entropy[81]])),
        150000000 + 90 * u32::from(u16::from_le_bytes([entropy[82], entropy[83]]))
    );
    let hex_id = hex::encode(random::<8>()?).replace('0', "1");
    let mut result = String::new();
    use std::fmt::Write;
    for (index, bytes) in entropy.chunks_exact(2).take(40).enumerate() {
        let key = index + 1;
        let value = match key {
            1 | 2 | 13 | 14 | 17 | 18 | 21 | 22 | 25 | 26 | 29 | 30 | 33 | 34 | 37 | 38 => {
                marker.clone()
            }
            3 => "0000000000000000".to_owned(),
            4 => hex_id.clone(),
            _ => (u16::from_le_bytes([bytes[0], bytes[1]]) % 10_000).to_string(),
        };
        let _ = write!(result, "k{key}:{value};");
    }
    Ok(result)
}

async fn qimei(client: &reqwest::Client, device: &Device, now: OffsetDateTime) -> Result<String> {
    let uptime = now - time::Duration::minutes(i64::from(random::<1>()?[0]) % 240);
    let ip = &Md5::digest(device.android.as_bytes())[..2];
    let properties = json!({"harmony":"0","clone":"0","containe":"",
        "oz":aes_encrypt(DEVICE_KEY,DEVICE_IV,device.android.as_bytes()),
        "oo":aes_encrypt(DEVICE_KEY,DEVICE_IV,b"PKB110"),"kelong":"0","ip":format!("192.168.{}.{}",ip[0],ip[1]%253+2),
        "uptimes":format!("{} {:02}:{:02}:{:02}",uptime.date(),uptime.hour(),uptime.minute(),uptime.second()),
        "multiUser":"0","bod":"mt6991","brd":"OPPO","dv":"PKB110","firstLevel":"35","manufact":"OPPO",
        "name":"PKB110","host":"","kernel":"","pre":"0","av":VERSION_NAME,"ch":""});
    let data = json!({"androidId":device.android,"platformId":1,"appKey":APP_KEY,"appVersion":VERSION_NAME,
        "beaconIdSrc":beacon(now)?,"brand":"OPPO","channelId":CHANNEL,"cid":"","imei":device.imei,
        "imsi":"","mac":"","model":"PKB110","networkType":"wifi","oaid":"","osVersion":"Android 15,level 35",
        "qimei":"","qimei36":"","sdkVersion":"1.2.13.6","targetSdkVersion":"30","audit":"","userId":"{}",
        "packageId":"com.tencent.qqmusic","deviceType":"Phone","sdkName":"","reserved":properties.to_string()});
    let secret = hex::encode(random::<8>()?);
    let key = rsa_encrypt(secret.as_bytes())?;
    let binary: &[u8; 16] = secret.as_bytes().try_into().expect("16-byte hex key");
    let params = aes_encrypt(binary, binary, data.to_string().as_bytes());
    let nonce = hex::encode(random::<8>()?);
    let seconds = now.unix_timestamp().to_string();
    let milliseconds = format!("{seconds}000");
    let extra = format!(r#"{{"appKey":"{APP_KEY}"}}"#);
    let sign = md5(&[&key, &params, &milliseconds, &nonce, QIMEI_SECRET, &extra]);
    let response = request_json(
        client
            .post("https://api.tencentmusic.com/tme/trpc/proxy")
            .header("method", "GetQimei")
            .header("service", "trpc.tme_datasvr.qimeiproxy.QimeiProxy")
            .header("appid", APP_ID)
            .header("sign", md5(&[QIMEI_SIGN_KEY, &seconds]))
            .header("user-agent", "QQMusic")
            .header("timestamp", &seconds)
            .json(&json!({"app":0,"os":1,"qimeiParams":{
            "key":key,"params":params,"time":seconds,"nonce":nonce,"sign":sign,"extra":extra}})),
    )
    .await
    .map_err(|_| anyhow::anyhow!("QQ 设备服务暂不可连接"))?;
    let inner = match response["data"].as_str() {
        Some(encoded) => {
            serde_json::from_str::<Value>(encoded).context("QQ 设备服务应答格式异常")?
        }
        None => response["data"].clone(),
    };
    ensure!(!text(&inner["data"]["q16"]).is_empty(), "QQ 未确认本机设备");
    inner["data"]["q36"]
        .as_str()
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
        .context("QQ 未确认本机设备")
}

async fn rpc(client: &reqwest::Client, payload: Value, signed: bool) -> Result<Value> {
    let body = payload.to_string();
    let mut request = if signed {
        client
            .post("https://u.y.qq.com/cgi-bin/musics.fcg")
            .query(&[
                (
                    "_",
                    (OffsetDateTime::now_utc().unix_timestamp_nanos() / 1_000_000).to_string(),
                ),
                ("sign", signature(body.as_bytes())),
            ])
    } else {
        client.post("https://u.y.qq.com/cgi-bin/musicu.fcg")
    };
    request = request
        .header("user-agent", USER_AGENT)
        .header("content-type", "application/json");
    let response = request_json(request.body(body)).await.map_err(|_| {
        anyhow::anyhow!(
            "QQ {}接口暂不可连接",
            if signed {
                "歌单写入"
            } else {
                "设备会话"
            }
        )
    })?;
    let node = &response["req_0"];
    if signed
        && [&response["code"], &node["code"]]
            .iter()
            .any(|value| matches!(crate::providers::uint(value), 1000 | 104401 | 104400))
    {
        return Err(WriteRequiresLogin.into());
    }
    ensure!(
        code(&response["code"], 0) && code(&node["code"], 0) && node["data"].is_object(),
        "QQ {}未确认本机请求（{} / {}）",
        if signed {
            "歌单写入"
        } else {
            "设备会话"
        },
        crate::providers::uint(&response["code"]),
        crate::providers::uint(&node["code"])
    );
    Ok(node["data"].clone())
}

async fn session(client: &reqwest::Client, scope: [u8; 32]) -> Result<Value> {
    let mut sessions = SESSIONS.lock().await;
    sessions.retain(|value| value.issued.elapsed() < Duration::from_secs(3600 * 6));
    if let Some(value) = sessions.iter().find(|value| value.scope == scope) {
        return Ok(value.communication.clone());
    }
    let now = OffsetDateTime::now_utc();
    let device = Device::new()?;
    let qimei = qimei(client, &device, now).await?;
    let mut communication = json!({"ct":"11","cv":VERSION,"v":VERSION,"chid":CHANNEL,"tmeAppID":"qqmusic",
        "traceid":format!("10002_{}_{}",device.open_id,now.unix_timestamp()),"QIMEI36":qimei,
        "OpenUDID":device.open_id,"udid":device.open_id,"OpenUDID2":device.open_id2,
        "aid":device.android,"os_ver":"15","phonetype":"PKB110"});
    let data = rpc(client,json!({"comm":communication,"req_0":{
        "module":"music.getSession.session","method":"GetSession","param":{"uid":"","vkey":0,"caller":2}}}),false).await?;
    let uid = text(&data["session"]["uid"]);
    let sid = text(&data["session"]["sid"]);
    ensure!(!uid.is_empty() && !sid.is_empty(), "QQ 未返回本机设备会话");
    communication["uid"] = json!(uid);
    communication["sid"] = json!(sid);
    sessions.push_front(Session {
        scope,
        issued: Instant::now(),
        communication: communication.clone(),
    });
    sessions.truncate(16);
    Ok(communication)
}

pub(super) async fn write(
    client: &reqwest::Client,
    parameters: Value,
    add: bool,
    account: &Account,
) -> Result<()> {
    let id = account
        .field("qqmusic_uin")
        .unwrap_or_else(|| super::identity(account))
        .trim_matches(['"', '\''])
        .trim_start_matches('o');
    numeric_id(id)?;
    let key = [
        "qqmusic_key",
        "qm_keyst",
        "qqmusic_key2",
        "wxmusickey",
        "p_skey",
        "skey",
    ]
    .into_iter()
    .find_map(|name| account.field(name))
    .map(|key| key.trim_matches('"'))
    .filter(|key| !key.is_empty())
    .ok_or(WriteRequiresLogin)?;
    let mode = account
        .field("tmeLoginType")
        .filter(|value| matches!(*value, "1" | "2"))
        .unwrap_or(if key.starts_with("W_X") { "1" } else { "2" });
    let scope = Sha256::digest(account.cookie.as_bytes()).into();
    let mut communication = session(client, scope).await?;
    communication["traceid"] = json!(format!(
        "10002_{id}_{}",
        OffsetDateTime::now_utc().unix_timestamp()
    ));
    communication["qq"] = json!(id);
    communication["authst"] = json!(key);
    communication["tmeLoginType"] = json!(mode);
    let result = rpc(
        client,
        json!({"comm":communication,"req_0":{"module":"music.musicasset.PlaylistDetailWrite",
        "method":if add {"AddSonglist"} else {"DelSonglist"},"param":parameters}}),
        true,
    )
    .await?;
    ensure!(
        code(&result["retCode"], 0),
        "QQ 音乐暂未确认歌单修改（{}）",
        crate::providers::uint(&result["retCode"])
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    #[test]
    fn signs_the_same_bytes_as_the_legacy_mobile_request() {
        assert_eq!(
            super::signature(b"{}"),
            "zzcf8e26805gyafigxmxjehoe02mvsjjgtwzw6f1a05f9"
        );
    }
}
