"""平台适配：qqmusic / search_transport。"""

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


def qqs__strip_comments(s):
    """cookie 文件里以 # 开头的行按注释丢掉（模板里写了说明也不影响解析）。"""
    return "\n".join((ln for ln in (s or "").splitlines() if not ln.strip().startswith("#")))


def qqs_cookie_fields(cookie=None):
    """拆解 QQ 搜索 Cookie 的 uin、qqmusic_key 等字段，兼容旧字段名。
    raw 用于请求头；cookie=None 时使用搜索模块 qqs_COOKIE。"""
    raw = request_credentials.cookie('qqmusic', cookie)
    raw = qqs__strip_comments(raw).strip().strip('"').strip("'")
    kv = {}
    for part in re.split("[;\\r\\n]+", raw):
        part = part.strip()
        if "=" in part:
            k, v = part.split("=", 1)
            kv[k.strip()] = v.strip()
    uin = kv.get("uin") or kv.get("qqmusic_uin") or kv.get("p_uin") or kv.get("wxuin") or ""
    key = kv.get("qqmusic_key") or kv.get("qm_keyst") or kv.get("qqmusic_key2") or kv.get("wxmusickey") or kv.get("p_skey") or kv.get("skey") or ""
    return {"uin": uin.strip('"'), "key": key.strip('"'), "raw": raw}


def qqs_hash33(s):
    """把 QQ 登录 key 转成 g_tk：从 5381 开始按 hash*33+字符值累加，最后取 31 位。"""
    h = 5381
    for ch in s or "":
        h = (h << 5) + h + ord(ch) & 4294967295
    return h & 2147483647


def qqs_headers(cookie=None):
    """生成 QQ 搜索请求头，使用搜索模块独立的 UA/Referer/Cookie 配置。"""
    ck = qqs_cookie_fields(cookie)
    h = {
        "User-Agent": qqmusic_config.qqs_UA,
        "Referer": qqmusic_config.qqs_REFERER,
        "Accept": "*/*",
    }
    if ck["raw"]:
        h["Cookie"] = ck["raw"]
    return h


def qqs_parse_cookie(raw):
    """整段 cookie / 只有 uin+qqmusic_key 的裸串 → 'k=v; k2=v2'"""
    raw = qqs__strip_comments(raw).strip().strip('"').strip("'")
    if not raw:
        return ""
    kv = {}
    for part in re.split("[;\\r\\n]+", raw):
        part = part.strip()
        if "=" in part:
            k, v = part.split("=", 1)
            if k.strip():
                kv[k.strip()] = v.strip()
    return "; ".join(("%s=%s" % (k, v) for k, v in kv.items()))


def qqs_cookie_from_input(value):
    """将输入解释为 Cookie 文本或文件路径；存在的文件会读取并交给 qqs_parse_cookie。"""
    if not value:
        return ""
    cand = value
    if os.path.isfile(cand):
        with open(cand, "r", encoding="utf-8", errors="replace") as f:
            cand = f.read().strip()
    return qqs_parse_cookie(cand)


def qqs_default_cookie():
    """QQ 音乐搜索专用 Cookie 回退：QQMUSIC_COOKIE 环境变量 → 当前目录/脚本目录/桌面的 qq_cookie.txt。
    统一 cookies.txt 的优先级更高，由后面的平台初始化层先读取；本函数不读统一文件。"""
    return request_credentials.cookie('qqmusic')


qqs__THROTTLE_LOCK = threading.Lock()


qqs__THROTTLE = {"last": 0.0, "gap": 0.45, "window": [], "budget": 15}


def qqs__throttle():
    """串行 + 最小间隔 0.45s；60 秒窗口内最多 15 次上游请求（超了就等窗口滚出去）。
    上游软限流很“软”：超了只是 list 变空、不报错，所以这里主动收敛突发量。"""
    with qqs__THROTTLE_LOCK:
        now = time.time()
        win = [t for t in qqs__THROTTLE["window"] if now - t < 60]
        qqs__THROTTLE["window"] = win
        if len(win) >= qqs__THROTTLE["budget"]:
            time.sleep(max(0.0, 60 - (now - win[0])))
            now = time.time()
            qqs__THROTTLE["window"] = [t for t in qqs__THROTTLE["window"] if now - t < 60]
        wait = qqs__THROTTLE["gap"] - (now - qqs__THROTTLE["last"])
        if wait > 0:
            time.sleep(wait)
        qqs__THROTTLE["last"] = time.time()
        qqs__THROTTLE["window"].append(qqs__THROTTLE["last"])


def qqs_musicu(data, cookie=None, timeout=20, retries=0):
    """QQ 搜索模块的 musicu.fcg 入口；把 data 编为查询串并附加 g_tk。
    请求前执行搜索模块自己的节流；网络异常最多重试 retries 次，最终仍失败则抛出。"""
    ck = qqs_cookie_fields(cookie)
    body = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    url = qqmusic_config.qqs_MUSICU + "?format=json&data=" + urllib.parse.quote(body)
    url += "&g_tk=%d" % (qqs_hash33(ck["key"]) if ck["key"] else 5381)
    last = None
    for attempt in range(retries + 1):
        try:
            qqs__throttle()
            req = urllib.request.Request(url, headers=qqs_headers(cookie))
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.loads(r.read().decode("utf-8", "replace"))
        except Exception as e:
            last = e
            if attempt < retries:
                time.sleep(1.2)
    raise last
