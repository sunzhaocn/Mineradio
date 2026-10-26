"""Small Android transport port of QQMusicApi 0.8.2 (GPL-3.0-or-later).
Upstream: https://github.com/l-1124/QQMusicApi
Only anonymous device/session preparation and explicit songlist writes are used.
The port replaces orjson/niquests/cryptography with stdlib/PyCryptodome.
Never writes user credentials to the device cache; never retries a mutation.
"""
from __future__ import annotations
import base64, contextlib, hashlib, json as _json, random, re, time as _time
import urllib.request, urllib.parse
from dataclasses import dataclass, replace
from random import Random
from uuid import UUID
from datetime import datetime, timedelta, timezone
from functools import lru_cache
from time import time
from base64 import b64encode
from hashlib import sha1
from music_app.runtime_crypto import AES, PKCS1_v1_5, RSA
class _Json:
    @staticmethod
    def dumps(value): return _json.dumps(value, ensure_ascii=False, separators=(',',':')).encode('utf-8')
    loads=staticmethod(_json.loads)
json=_Json()
def calc_md5(*parts): return hashlib.md5(''.join(parts).encode()).hexdigest()

def random_imei(rng: Random | None = None) -> str:
    """生成满足标准 Luhn 校验的随机 IMEI 号码.

    Args:
        rng: 可选随机数生成器, 用于生成可复现设备.

    Returns:
        str: 随机生成的 IMEI 号码.
    """
    generator = rng or Random()
    digits = [generator.randint(0, 9) for _ in range(14)]
    sum_ = 0
    for idx, digit in enumerate(digits):
        checksum_digit = digit
        if idx % 2 == 1:
            checksum_digit *= 2
            if checksum_digit > 9:
                checksum_digit -= 9
        sum_ += checksum_digit
    ctrl_digit = (10 - (sum_ % 10)) % 10
    digits.append(ctrl_digit)
    return "".join(str(digit) for digit in digits)

@dataclass
class OSVersion:
    """系统版本信息."""

    incremental: str
    release: str
    codename: str
    sdk: int

@dataclass
class _DeviceProfile:
    """描述一组内部一致的 Android 设备属性."""

    display: str
    product: str
    device: str
    board: str
    model: str
    fingerprint: str
    proc_version: str
    brand: str
    manufacturer: str
    host: str
    first_api_level: int
    version: OSVersion
    vendor_name: str
    vendor_os_name: str

_DEVICE_PROFILES = {
    "vivo": _DeviceProfile(
        display="PD2408D_A_16.1.18.2.W10",
        product="PD2408",
        device="PD2408",
        board="sun",
        model="V2408A",
        fingerprint="vivo/PD2408/PD2408:15/AP3A.240905.015.A2/compiler250423182036:user/release-keys",
        proc_version=(
            "Linux localhost 6.6.89-android15-8-g1f71897ac249-abogki467805059-4k "
            "#1 SMP PREEMPT Thu Dec 11 01:56:00 UTC 2025 aarch64"
        ),
        brand="vivo",
        manufacturer="vivo",
        host="comdg01150014",
        first_api_level=35,
        version=OSVersion(incremental="compiler250423182036", release="15", codename="REL", sdk=35),
        vendor_name="OriginOS",
        vendor_os_name="OriginOS 5.0",
    ),
    "xiaomi": _DeviceProfile(
        display="OS3.0.260511.1.WOCCNXM.STABLE-OS31",
        product="dada",
        device="dada",
        board="sun",
        model="24129PN74C",
        fingerprint=("Xiaomi/dada/dada:16/BP2A.250605.031.A3/OS3.0.260511.1.WOCCNXM.STABLE-OS31:user/release-keys"),
        proc_version="",
        brand="Xiaomi",
        manufacturer="Xiaomi",
        host="",
        first_api_level=35,
        version=OSVersion(
            incremental="OS3.0.260511.1.WOCCNXM.STABLE-OS31",
            release="16",
            codename="REL",
            sdk=36,
        ),
        vendor_name="Xiaomi",
        vendor_os_name="HyperOS 3.0",
    ),
    "oppo": _DeviceProfile(
        display="V.1ab312a_1-2a261",
        product="PKB110",
        device="OP5A3DL1",
        board="mt6991",
        model="PKB110",
        fingerprint="OPPO/PKB110/OP5A3DL1:15/AP3A.240617.008/V.1ab312a_1-2a261:user/release-keys",
        proc_version="",
        brand="OPPO",
        manufacturer="OPPO",
        host="",
        first_api_level=35,
        version=OSVersion(incremental="V.1ab312a_1-2a261", release="15", codename="REL", sdk=35),
        vendor_name="ColorOS",
        vendor_os_name="ColorOS 15",
    ),
}

def _random_mac(rng: Random) -> str:
    """生成本地管理的单播 MAC 地址."""
    octets = [0x02, *(rng.getrandbits(8) for _ in range(5))]
    return ":".join(f"{octet:02X}" for octet in octets)

@dataclass
class Device(_DeviceProfile):
    """硬件设备信息."""

    boot_id: str
    imei: str
    bootloader: str
    base_band: str
    sim_info: str
    os_type: str
    mac_address: str
    wifi_bssid: str
    wifi_ssid: str
    imsi_md5: list[int]
    android_id: str
    apn: str
    open_udid: str
    open_udid2: str

def generate_device(profile: str | None = None, *, seed: int | str | None = None) -> Device:
    """根据一致的设备档案生成虚拟 Android 设备.

    Args:
        profile: 设备档案名称 (vivo, xiaomi, oppo). 省略时随机选择一个档案.
        seed: 可选随机种子, 相同档案和种子生成相同设备身份.

    Returns:
        新生成的设备信息.

    Raises:
        ValueError: 指定了未知设备档案时.
    """
    rng = Random(seed)
    if profile is None:
        selected = rng.choice(tuple(_DEVICE_PROFILES.values()))
    else:
        try:
            selected = _DEVICE_PROFILES[profile.lower()]
        except KeyError as exc:
            choices = ", ".join(_DEVICE_PROFILES)
            raise ValueError(f"未知设备档案: {profile}. 可选值: {choices}") from exc

    return Device(
        display=selected.display,
        product=selected.product,
        device=selected.device,
        board=selected.board,
        model=selected.model,
        fingerprint=selected.fingerprint,
        boot_id=str(UUID(int=rng.getrandbits(128), version=4)),
        proc_version=selected.proc_version,
        imei=random_imei(rng),
        brand=selected.brand,
        bootloader="U-boot",
        base_band="",
        version=replace(selected.version),
        sim_info="T-Mobile",
        os_type="android",
        mac_address=_random_mac(rng),
        wifi_bssid=_random_mac(rng),
        wifi_ssid="<unknown ssid>",
        imsi_md5=list(rng.randbytes(16)),
        android_id=f"{rng.getrandbits(64):016x}",
        apn="wifi",
        vendor_name=selected.vendor_name,
        vendor_os_name=selected.vendor_os_name,
        open_udid=UUID(int=rng.getrandbits(128), version=4).hex,
        open_udid2=UUID(int=rng.getrandbits(128), version=4).hex,
        manufacturer=selected.manufacturer,
        host=selected.host,
        first_api_level=selected.first_api_level,
    )

def rsa_encrypt(content): return PKCS1_v1_5.new(RSA.import_key(PUBLIC_KEY)).encrypt(content)
def aes_encrypt(key, content, iv=None):
    size=16-len(content)%16
    return AES.new(key,AES.MODE_CBC,iv or key).encrypt(content+bytes([size])*size)

PUBLIC_KEY = """-----BEGIN PUBLIC KEY-----
MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDEIxgwoutfwoJxcGQeedgP7FG9qaIuS0qzfR8gWkrkTZKM2iWHn2ajQpBRZjMSoSf6+KJGvar2ORhBfpDXyVtZCKpqLQ+FLkpncClKVIrBwv6PHyUvuCb0rIarmgDnzkfQAqVufEtR64iazGDKatvJ9y6B9NMbHddGSAUmRTCrHQIDAQAB
-----END PUBLIC KEY-----"""

SECRET = "ZdJqM15EeO2zWc08"

APP_KEY = "0AND0HD6FE4HY80F"

EXTRA = f'{{"appKey":"{APP_KEY}"}}'

CHANNEL_ID = "10003505"

PACKAGE_ID = "com.tencent.qqmusic"

HEX_CHARS = "0123456789abcdef"

DEVICE_TOKEN_KEY = b"lvcwmSYVr2Axv1gn"

DEVICE_TOKEN_IV = b"Zs0ntDqG2jyhKN0c"

_QIMEI_SIGN_KEY = "qimei_qq_androidpzAuCmaFAaFaHrdakPjLIEqKrGnSOOvH"

@lru_cache
def calc_device_oz(android_id: str) -> str:
    """根据 Android ID 计算设备安全字段 oz.

    Args:
        android_id: 当前设备的 Android ID.

    Returns:
        Base64 编码的设备安全字段.
    """
    encrypted = aes_encrypt(DEVICE_TOKEN_KEY, android_id.encode(), DEVICE_TOKEN_IV)
    return base64.b64encode(encrypted).decode()

@lru_cache
def calc_device_oo(model: str) -> str:
    """根据设备型号计算设备安全字段 oo.

    Args:
        model: 当前设备型号.

    Returns:
        Base64 编码的设备安全字段.
    """
    encrypted = aes_encrypt(DEVICE_TOKEN_KEY, model.encode(), DEVICE_TOKEN_IV)
    return base64.b64encode(encrypted).decode()

def random_beacon_id() -> str:
    """随机生成灯塔 ID.

    Returns:
        str: 随机生成的 BeaconID 字符串.
    """
    beacon_id = ""
    time_month = datetime.now(timezone.utc).strftime("%Y-%m-") + "01"
    rand1 = random.randint(100000, 999999)
    rand2 = random.randint(100000000, 999999999)

    for i in range(1, 41):
        if i in [1, 2, 13, 14, 17, 18, 21, 22, 25, 26, 29, 30, 33, 34, 37, 38]:
            beacon_id += f"k{i}:{time_month}{rand1}.{rand2}"
        elif i == 3:
            beacon_id += "k3:0000000000000000"
        elif i == 4:
            beacon_id += f"k4:{''.join(random.choices(HEX_CHARS[1:], k=16))}"
        else:
            beacon_id += f"k{i}:{random.randint(0, 9999)}"
        beacon_id += ";"
    return beacon_id

@lru_cache
def _private_ip_for_device(android_id: str) -> str:
    """根据设备标识生成稳定的 IPv4 私网地址."""
    digest = bytes.fromhex(calc_md5(android_id))
    return f"192.168.{digest[0]}.{digest[1] % 253 + 2}"

def random_payload_by_device(device: Device, version: str, sdk_version: str) -> dict:
    """根据设备信息随机生成 QIMEI 请求负载.

    Args:
        device: 设备对象.
        version: 客户端版本.
        sdk_version: QIMEI SDK 版本.

    Returns:
        dict: 构造好的负载字典.
    """
    fixed_rand = random.randint(0, 14400)
    reserved = {
        "harmony": "1" if device.vendor_os_name.lower().startswith("harmonyos") else "0",
        "clone": "0",
        "containe": "",
        "oz": calc_device_oz(device.android_id),
        "oo": calc_device_oo(device.model),
        "kelong": "0",
        "ip": _private_ip_for_device(device.android_id),
        "uptimes": (datetime.now(timezone.utc) - timedelta(seconds=fixed_rand)).strftime("%Y-%m-%d %H:%M:%S"),
        "multiUser": "0",
        "bod": device.board,
        "brd": device.brand,
        "dv": device.device,
        "firstLevel": str(device.first_api_level),
        "manufact": device.manufacturer or device.brand,
        "name": device.product,
        "host": device.host,
        "kernel": device.proc_version,
        "pre": "0",
        "av": version,
        "ch": "",
    }
    return {
        "androidId": device.android_id,
        "platformId": 1,
        "appKey": APP_KEY,
        "appVersion": version,
        "beaconIdSrc": random_beacon_id(),
        "brand": device.brand,
        "channelId": CHANNEL_ID,
        "cid": "",
        "imei": device.imei,
        "imsi": "",
        "mac": "",
        "model": device.model,
        "networkType": "wifi",
        "oaid": "",
        "osVersion": f"Android {device.version.release},level {device.version.sdk}",
        "qimei": "",
        "qimei36": "",
        "sdkVersion": sdk_version,
        "targetSdkVersion": "30",
        "audit": "",
        "userId": "{}",
        "packageId": PACKAGE_ID,
        "deviceType": "Phone",
        "sdkName": "",
        "reserved": json.dumps(reserved).decode(),
    }

def _build_qimei_request(device: Device, version: str, sdk_version: str) -> tuple[dict[str, str], dict[str, Any]]:
    """构建 QIMEI 请求头和请求体.

    Args:
        device: 设备对象.
        version: 客户端版本.
        sdk_version: QIMEI SDK 版本.

    Returns:
        tuple[dict[str, str], dict[str, Any]]: 包含请求头及请求体的元组.
    """
    payload = random_payload_by_device(device, version, sdk_version)
    crypt_key = "".join(random.choices(HEX_CHARS, k=16))
    nonce = "".join(random.choices(HEX_CHARS, k=16))
    ts = int(time())

    key = base64.b64encode(rsa_encrypt(crypt_key.encode())).decode()
    params = base64.b64encode(aes_encrypt(crypt_key.encode(), json.dumps(payload))).decode()
    req_sign = calc_md5(key, params, str(ts * 1000), nonce, SECRET, EXTRA)

    headers = {
        "Host": "api.tencentmusic.com",
        "method": "GetQimei",
        "service": "trpc.tme_datasvr.qimeiproxy.QimeiProxy",
        "appid": "qimei_qq_android",
        "sign": calc_md5(_QIMEI_SIGN_KEY, str(ts)),
        "user-agent": "QQMusic",
        "timestamp": str(ts),
    }
    request_json = {
        "app": 0,
        "os": 1,
        "qimeiParams": {
            "key": key,
            "params": params,
            "time": str(ts),
            "nonce": nonce,
            "sign": req_sign,
            "extra": EXTRA,
        },
    }
    return headers, request_json
PART_1_INDEXES = [23, 14, 6, 36, 16, 7, 19]

PART_2_INDEXES = [16, 1, 32, 12, 19, 27, 8, 5]

SCRAMBLE_VALUES = [89, 39, 179, 150, 218, 82, 58, 252, 177, 52, 186, 123, 120, 64, 242, 133, 143, 161, 121, 179]

def zzc_sign(payload: str | bytes | bytearray) -> str:
    """计算 QQ 音乐客户端请求的 zzc 签名.

    Args:
        payload: 待签名的明文 (字符串或二进制数据).

    Returns:
        str: 计算出的签名值.
    """
    payload_bytes = payload.encode("utf-8") if isinstance(payload, str) else bytes(payload)
    hash_hex = sha1(payload_bytes).hexdigest().upper()

    part1 = "".join(hash_hex[i] for i in PART_1_INDEXES)
    part2 = "".join(hash_hex[i] for i in PART_2_INDEXES)

    part3 = bytearray(20)
    for i, v in enumerate(SCRAMBLE_VALUES):
        value = v ^ int(hash_hex[i * 2 : i * 2 + 2], 16)
        part3[i] = value
    b64_part = re.sub(rb"[\\/+=]", b"", b64encode(part3)).decode("utf-8")
    return f"zzc{part1}{b64_part}{part2}".lower()


class ProtocolError(Exception):
    def __init__(self, code):
        self.code = code
        super().__init__('QQ music request was not confirmed')


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        raise ProtocolError('redirect')


def _post(url, payload, headers=None):
    request = urllib.request.Request(url, data=json.dumps(payload), headers={
        'Content-Type':'application/json', 'User-Agent':'QQMusic 20090008(android 15)', **(headers or {})})
    with urllib.request.build_opener(_NoRedirect()).open(request, timeout=35) as response:
        raw = response.read(4 * 1024 * 1024 + 1)
    if len(raw) > 4 * 1024 * 1024: raise ProtocolError('size')
    return json.loads(raw)


def _cgi(payload, signed=False):
    url = 'https://u.y.qq.com/cgi-bin/' + ('musics.fcg' if signed else 'musicu.fcg')
    if signed: url += '?' + urllib.parse.urlencode({'_':str(int(time()*1000)), 'sign':zzc_sign(json.dumps(payload))})
    result = _post(url, payload)
    node = result.get('req_0') or {}
    if result.get('code', 0) != 0 or node.get('code') != 0:
        raise ProtocolError(node.get('code', result.get('code', -1)))
    data = node.get('data')
    if not isinstance(data, dict): raise ProtocolError('data')
    return data


def _comm(device, qimei, musicid='', musickey='', login_type=2, session=None):
    session = session or {}
    result = {'ct':'11', 'cv':'20090008', 'v':'20090008', 'chid':'10003505', 'tmeAppID':'qqmusic',
        'traceid':f'10002_{musicid or device.open_udid}_{int(time())}', 'QIMEI36':qimei.get('q36',''),
        'OpenUDID':device.open_udid, 'udid':device.open_udid, 'OpenUDID2':device.open_udid2,
        'aid':device.android_id, 'os_ver':device.version.release, 'phonetype':device.model}
    if musicid: result.update(qq=str(musicid), authst=musickey, tmeLoginType=str(login_type))
    if session.get('uid') and session.get('sid'): result.update(uid=str(session['uid']), sid=session['sid'])
    return result


def prepare(device_path):
    path = device_path.with_suffix('.mobile.json')
    try: state = _json.loads(path.read_text(encoding='utf-8'))
    except (OSError, ValueError): state = {}
    seed = state.get('seed') or UUID(int=random.getrandbits(128)).hex
    device = generate_device('oppo', seed=seed)
    state['seed'] = seed
    qimei = state.get('qimei') or {}
    if not qimei.get('q36') or time() - state.get('qimei_time', 0) > 86400:
        headers, payload = _build_qimei_request(device, '20.9.0.8', '1.2.13.6')
        response = _post('https://api.tencentmusic.com/tme/trpc/proxy', payload, headers)
        inner = response.get('data') or '{}'
        if isinstance(inner, str): inner = json.loads(inner)
        qimei = inner.get('data') or {}
        if not qimei.get('q36') or not qimei.get('q16'): raise ProtocolError('qimei')
        state.update(qimei=qimei, qimei_time=int(time()))
    session = state.get('session') or {}
    today = datetime.now().astimezone().date().isoformat()
    if not session.get('uid') or not session.get('sid') or state.get('session_day') != today:
        session = _cgi({'comm':_comm(device,qimei), 'req_0':{'module':'music.getSession.session',
            'method':'GetSession', 'param':{'uid':session.get('uid',''), 'vkey':0, 'caller':1 if session else 2}}}).get('session') or {}
        if not session.get('uid') or not session.get('sid'): raise ProtocolError('session')
        state.update(session=session, session_day=today)
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix('.tmp')
    temp.write_text(_json.dumps(state), encoding='utf-8'); temp.replace(path)
    return device, qimei, session


def write(method, param, musicid, musickey, login_type, device_path):
    if method not in ('AddSonglist','DelSonglist'): raise ValueError('Unsupported mutation')
    device, qimei, session = prepare(device_path)
    # This is the only authenticated physical request, sent once. The caller
    # independently reads membership to confirm before presenting success.
    native_param = dict(param)
    if method == 'DelSonglist': native_param['bFmtUtf8'] = 1
    response = _cgi({'comm':_comm(device,qimei,musicid,musickey,login_type,session),
        'req_0':{'module':'music.musicasset.PlaylistDetailWrite', 'method':method, 'param':native_param}}, signed=True)
    return response.get('retCode') == 0
