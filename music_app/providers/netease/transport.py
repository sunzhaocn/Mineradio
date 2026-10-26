"""平台适配：netease / transport。"""

import base64
import gzip
import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request
from music_app.providers.netease import config as netease_config
from music_app.paths import CONFIG_DIR
from music_app.core import request_credentials
from music_app.core import request_lifecycle


def ne_cookie_fields(cookie=None):
    """返回 {"MUSIC_U","csrf","raw"}；只贴 MUSIC_U 裸值也能识别。"""
    raw = request_credentials.cookie('netease', cookie).strip().strip('"').strip("'")
    if re.fullmatch("[0-9A-Fa-f]{60,}", raw):
        return {"MUSIC_U": raw, "csrf": "", "raw": "MUSIC_U=" + raw}
    kv = {}
    for part in re.split("[;\\r\\n]+", raw):
        if "=" in part:
            k, v = part.split("=", 1)
            kv[k.strip()] = v.strip()
    return {
        "MUSIC_U": kv.get("MUSIC_U", ""),
        "csrf": kv.get("__csrf", ""),
        "raw": "; ".join(("%s=%s" % (k, v) for k, v in kv.items())),
    }


def ne_headers(cookie=None):
    """生成网易云通用请求头，带 Referer、UA、Origin 和对应 Cookie；POST 表单头由调用方添加。"""
    ck = ne_cookie_fields(cookie)
    h = {
        "User-Agent": netease_config.ne_UA,
        "Referer": netease_config.ne_REFERER,
        "Origin": netease_config.ne_BASE,
        "Accept": "*/*",
        "Accept-Encoding": "gzip",
    }
    if ck["raw"]:
        h["Cookie"] = ck["raw"]
    return h


def ne_http_get(url, hdrs=None, timeout=15, data=None):
    """发送网易云 HTTP 请求并返回字节；data 非空时 urllib 按 POST 处理。
    若响应声明 gzip 则先解压；timeout 单位为秒。"""
    request_lifecycle.check()
    req = urllib.request.Request(url, data=data, headers=hdrs or ne_headers())
    with urllib.request.urlopen(req, timeout=timeout) as r:
        raw = r.read()
        if (r.headers.get("Content-Encoding") or "").lower() == "gzip":
            raw = gzip.decompress(raw)
    request_lifecycle.check()
    return raw


def ne_http_json(url, hdrs=None, timeout=15):
    """调用网易云 HTTP 工具并将 UTF-8 响应解析为 JSON。"""
    return json.loads(ne_http_get(url, hdrs, timeout).decode("utf-8", "replace"))


def ne__pkcs7(data):
    """按 AES 的 16 字节块做 PKCS#7 填充；即使刚好对齐也补完整一块。"""
    n = 16 - len(data) % 16
    return data + bytes([n]) * n


def ne__aes(text, key):
    """先对输入字节做 PKCS#7 填充，再使用 AES-CBC 加密并返回 Base64 字符串。"""
    return base64.b64encode(
        netease_config.AES.new(key, netease_config.AES.MODE_CBC, netease_config.ne_CBC_IV).encrypt(
            ne__pkcs7(text)
        )
    ).decode()


def ne__rsa(text):
    """按网易云 weapi 规则反转随机密钥并做 RSA 模幂运算，输出固定长度十六进制串。"""
    m = int.from_bytes(text[::-1].encode("utf-8"), "big")
    return format(
        pow(m, int(netease_config.ne_RSA_EXP, 16), int(netease_config.ne_RSA_MOD, 16)), "x"
    ).zfill(256)


def ne_weapi_payload(data):
    """params = AES(AES(json))；encSecKey = RSA_NO_PADDING(随机 16 字节密钥反串)。"""
    secret = base64.b64encode(os.urandom(16))[:16].decode("utf-8")
    body = json.dumps(data, separators=(",", ":"), ensure_ascii=False)
    p1 = ne__aes(body.encode("utf-8"), netease_config.ne_CBC_KEY)
    return {
        "params": ne__aes(p1.encode("utf-8"), secret.encode("utf-8")),
        "encSecKey": ne__rsa(secret),
    }


def ne_weapi_post(path, payload, cookie=None, timeout=20):
    """将网易云 weapi 请求体经 ne_weapi_payload 加密并以表单 POST；csrf_token 由调用方填入。
    path 是以 /weapi 开头的相对路径；cookie=None 使用详情模块当前 Cookie。"""
    if netease_config.AES is None:
        raise RuntimeError("缺少 pycryptodome：pip install pycryptodome")
    h = ne_headers(cookie)
    h["Content-Type"] = "application/x-www-form-urlencoded"
    body = urllib.parse.urlencode(ne_weapi_payload(payload)).encode("utf-8")
    return json.loads(
        ne_http_get(netease_config.ne_BASE + path, h, timeout, body).decode("utf-8", "replace")
    )


def nes_parse_cookie(raw):
    """'k=v; k2=v2' → dict；只贴了 MUSIC_U 裸值（802 位 hex）也能识别。"""
    raw = (raw or "").strip().strip('"').strip("'").strip()
    if not raw:
        return {}
    if re.fullmatch("[0-9A-Fa-f]{60,}", raw):
        return {"MUSIC_U": raw}
    out = {}
    for part in re.split("[;\\r\\n]+", raw):
        part = part.strip()
        if "=" in part:
            k, v = part.split("=", 1)
            out[k.strip()] = v.strip()
    return out


def nes_cookie_from_input(value):
    """文件路径 / cookie 串 / 裸 token → 'k=v; k2=v2'；无法识别时返回空串（游客模式）。"""
    if not value:
        return ""
    cand = value
    if os.path.isfile(cand):
        with open(cand, "r", encoding="utf-8", errors="replace") as f:
            cand = f.read().strip()
    jar = nes_parse_cookie(cand)
    return "; ".join(("%s=%s" % (k, v) for k, v in jar.items()))


def nes_default_cookie():
    """网易云专用 Cookie 回退：NE_COOKIE 环境变量 → 当前目录/脚本目录/桌面的 ne_cookie.txt。
    统一 cookies.txt 的优先级更高，由后面的平台初始化层先读取；本函数不读统一文件。"""
    return request_credentials.cookie('netease')


def nes_csrf_token():
    """从搜索模块 nes_COOKIE 提取 __csrf，用于网易云 weapi 表单。"""
    return nes_parse_cookie(request_credentials.cookie('netease')).get("__csrf", "")


def nes__pkcs7(data):
    """为网易云搜索/播放加密进行 PKCS#7 字节填充，块大小为 16。"""
    n = 16 - len(data) % 16
    return data + bytes([n]) * n


def nes__aes_b64(text, key):
    """使用搜索模块的固定 IV 做 AES-CBC 加密，并输出 Base64 文本。"""
    return base64.b64encode(
        netease_config.AES.new(
            key, netease_config.AES.MODE_CBC, netease_config.nes__AES_IV
        ).encrypt(nes__pkcs7(text))
    ).decode()


def nes__rsa_hex(secret):
    """对随机密钥按网易云规则做 RSA 运算，返回 256 位十六进制字符串。"""
    m = int.from_bytes(secret.encode()[::-1], "big")
    return format(pow(m, netease_config.nes__RSA_E, netease_config.nes__RSA_N), "x").zfill(256)


def nes_weapi_payload(data):
    """params=AES(AES(明文)) + encSecKey=RSA(随机16字节密钥)，纯标准库大整数实现。"""
    secret = base64.b64encode(os.urandom(16))[:16].decode()
    plain = json.dumps(data, separators=(",", ":"), ensure_ascii=False).encode()
    p1 = nes__aes_b64(plain, netease_config.nes__AES_KEY)
    return {"params": nes__aes_b64(p1.encode(), secret.encode()), "encSecKey": nes__rsa_hex(secret)}


def nes_weapi_post(path, data, timeout=15):
    """搜索模块的网易云 weapi POST 入口：检查加密依赖、加密并带 Cookie 请求；csrf 由调用方补入。"""
    if not netease_config.nes__HAS_CRYPTO:
        raise RuntimeError("缺少 pycryptodome：pip install pycryptodome")
    body = urllib.parse.urlencode(nes_weapi_payload(data)).encode()
    headers = {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": netease_config.nes_UA,
        "Referer": netease_config.nes_BASE + "/",
        "Origin": netease_config.nes_BASE,
    }
    cookie = request_credentials.cookie('netease')
    if cookie:
        headers["Cookie"] = cookie
    req = urllib.request.Request(
        netease_config.nes_BASE + path, data=body, headers=headers, method="POST"
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8", "replace"))
