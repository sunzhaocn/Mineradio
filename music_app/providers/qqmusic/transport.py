"""平台适配：qqmusic / transport。"""

import gzip
import json
import os
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from music_app.providers.qqmusic import config as qqmusic_config
from music_app.paths import CONFIG_DIR
from music_app.core import request_credentials
from music_app.core import request_lifecycle


def qq__strip_comments(s):
    """cookie 文件里以 # 开头的行按注释丢掉（模板里写了说明也不影响解析）。"""
    return "\n".join((ln for ln in (s or "").splitlines() if not ln.strip().startswith("#")))


def qq_cookie_fields(cookie=None):
    """返回 {"uin","key","skey","raw"}；支持整段 Cookie、只有 uin/qqmusic_key 两字段的裸串。"""
    raw = request_credentials.cookie('qqmusic', cookie)
    raw = qq__strip_comments(raw).strip().strip('"').strip("'")
    kv = {}
    for part in re.split("[;\\r\\n]+", raw):
        part = part.strip()
        if "=" in part:
            k, v = part.split("=", 1)
            kv[k.strip()] = v.strip()
    uin = kv.get("uin") or kv.get("qqmusic_uin") or kv.get("p_uin") or kv.get("wxuin") or ""
    key = (
        kv.get("qqmusic_key")
        or kv.get("qm_keyst")
        or kv.get("qqmusic_key2")
        or kv.get("wxmusickey")
        or kv.get("p_skey")
        or kv.get("skey")
        or ""
    )
    return {
        "uin": uin.strip('"'),
        "key": key.strip('"'),
        "skey": (kv.get("skey") or kv.get("p_skey") or "").strip('"'),
        "raw": raw,
    }


def qq_hash33(s):
    """QQ 系 g_tk：h=5381; h+=(h<<5)+ord(c); 取低 31 位。"""
    h = 5381
    for ch in s or "":
        h = (h << 5) + h + ord(ch)
        h &= 4294967295
    return h & 2147483647


def qq_headers(cookie=None, referer=qqmusic_config.qq_REFERER):
    """生成 QQ 音乐请求头：带指定 Referer、UA 与对应 Cookie。"""
    ck = qq_cookie_fields(cookie)
    h = {"User-Agent": qqmusic_config.qq_UA, "Referer": referer, "Accept": "*/*"}
    if ck["raw"]:
        h["Cookie"] = ck["raw"]
    return h


def qq_http_get(url, hdrs=None, timeout=20):
    """发送 QQ 音乐 GET 并返回字节；按响应头处理 gzip，异常交给上层重试。"""
    request_lifecycle.check()
    req = urllib.request.Request(url, headers=hdrs or qq_headers())
    with urllib.request.urlopen(req, timeout=timeout) as r:
        raw = r.read()
        if (r.headers.get("Content-Encoding") or "").lower() == "gzip":
            raw = gzip.decompress(raw)
    request_lifecycle.check()
    return raw


def qq_http_json(url, hdrs=None, timeout=20):
    """将 QQ 音乐 HTTP 响应按 UTF-8 解码并解析为 JSON。"""
    return json.loads(qq_http_get(url, hdrs, timeout).decode("utf-8", "replace"))


qq__THROTTLE_LOCK = threading.Lock()


qq__THROTTLE = {"last": 0.0, "gap": 0.45, "window": [], "budget": 15}


def qq__throttle():
    """最小间隔 0.45s，60 秒窗口内最多 15 次上游请求；等待时释放配额锁。
    上游软限流很“软”：超了只是 list 变空，不报错，所以这里主动收敛突发量。"""
    while True:
        request_lifecycle.check()
        with qq__THROTTLE_LOCK:
            now = time.time()
            win = [t for t in qq__THROTTLE['window'] if now - t < 60]
            qq__THROTTLE['window'] = win
            quota_wait = max(0, 60 - (now - win[0])) if len(win) >= qq__THROTTLE['budget'] else 0
            gap_wait = max(0, qq__THROTTLE['gap'] - (now - qq__THROTTLE['last']))
            wait = max(quota_wait, gap_wait)
            if wait <= 0:
                request_lifecycle.check()
                qq__THROTTLE['last'] = now
                win.append(now)
                return
        # No socket owns the shared quota lock while waiting. Cancelled reads
        # stop before claiming a slot; already consumed quota is never refunded.
        request_lifecycle.sleep(min(.05, wait))


def qq_musicu(data, cookie=None, timeout=20, retries=1):
    """musicu.fcg 统一入口：GET ?format=json&data=<json>&g_tk=<hash33(qqmusic_key)>"""
    ck = qq_cookie_fields(cookie)
    body = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    url = qqmusic_config.qq_MUSICU + "?format=json&data=" + urllib.parse.quote(body)
    url += "&g_tk=%d" % (qq_hash33(ck["key"]) if ck["key"] else 5381)
    last = None
    for attempt in range(retries + 1):
        request_lifecycle.check()
        try:
            qq__throttle()
            return qq_http_json(url, qq_headers(cookie), timeout)
        except Exception as e:
            request_lifecycle.check()
            last = e
            if attempt < retries:
                request_lifecycle.sleep(1.2)
    raise last


def qq_cookie_from_input(value):
    """文件路径 / 整段 Cookie 串 → 'k=v; k2=v2'；空输入返回空串（游客）。"""
    if not value:
        return ""
    cand = value
    if os.path.isfile(cand):
        with open(cand, "r", encoding="utf-8", errors="replace") as f:
            cand = f.read().strip()
    cand = cand.strip().strip('"').strip("'")
    cand = qq__strip_comments(cand).strip()
    if not cand:
        return ""
    kv = {}
    for part in re.split("[;\\r\\n]+", cand):
        part = part.strip()
        if "=" in part:
            k, v = part.split("=", 1)
            if k.strip():
                kv[k.strip()] = v.strip()
    return "; ".join(("%s=%s" % (k, v) for k, v in kv.items()))


def qq_default_cookie():
    """QQ 音乐专用 Cookie 回退：QQMUSIC_COOKIE 环境变量 → 当前目录/脚本目录/桌面的 qq_cookie.txt。
    统一 cookies.txt 的优先级更高，由后面的平台初始化层先读取；本函数不读统一文件。"""
    return request_credentials.cookie('qqmusic')
