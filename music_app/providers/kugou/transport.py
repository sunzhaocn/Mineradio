"""平台适配：kugou / transport。"""

import hashlib
import json
import urllib.error
import urllib.parse
import urllib.request
from music_app.providers.kugou import config as kugou_config
from music_app.core import request_credentials
from music_app.core import request_lifecycle


def _cookie_value(value):
    """Remove browser cookie quoting without decoding opaque token contents."""
    value = value.strip()
    for _ in range(2):
        if len(value) >= 2 and value[0] == value[-1] and value[0] in ('\"', "'"):
            value = value[1:-1].strip()
        elif len(value) >= 6 and value[:3].lower() == value[-3:].lower() and value[:3].lower() in ('%22', '%27'):
            value = value[3:-3].strip()
        else:
            break
    return value


def _legacy_cookie_fields(value):
    """KuGoo can be a query string or an encoded query-string cookie value.

    Stop decoding once known keys can be parsed: token characters such as an
    escaped ampersand belong to the token and must not become separators.
    """
    value = _cookie_value(value)
    known = {'t', 'T', 'token', 'Token', 'KugooID', 'kugouID', 'UserId', 'userid', 'uid', 'uin'}
    for _ in range(3):
        fields = urllib.parse.parse_qs(value, keep_blank_values=True)
        if known.intersection(fields):
            return fields
        decoded = _cookie_value(urllib.parse.unquote(value))
        if decoded == value:
            break
        value = decoded
    return {}


def kg_cookie_fields(cookie=None):
    """拆解酷狗 Cookie，提取 mid/dfid（设备标识）、token（登录令牌）、uid（账号）。
    优先取顶层字段；旧格式把 t/KugooID 放在 KuGoo 的子查询串中，也予以兼容。
    raw 保留完整 Cookie，仅用于发给酷狗；cookie=None 时读取当前请求凭据。"""
    raw = request_credentials.cookie('kugou', cookie).strip()
    kv = {}
    for part in raw.split(";"):
        if "=" in part:
            k, v = part.split("=", 1)
            kv[k.strip()] = _cookie_value(v)
    ku = _legacy_cookie_fields(kv.get("KuGoo") or kv.get("kugou") or "")

    def first(names):
        return next((kv[name] for name in names if kv.get(name)), "")

    def nested(names):
        return next((_cookie_value(ku[name][0]) for name in names if ku.get(name) and ku[name][0]), "")

    return {
        "mid": first(("kg_mid", "KG_MID", "mid")),
        "dfid": first(("kg_dfid", "KG_DFID", "dfid")),
        "token": first(("t", "Token", "token", "T")) or nested(("t", "Token", "token", "T")),
        # QR/native token and web t belong to different service sessions.
        # Playback keeps t above; cloudlist needs the original client token.
        "cloud_token": first(("token", "Token", "t", "T")) or nested(("token", "Token", "t", "T")),
        "uid": first(("KugooID", "UserId", "userid", "uin", "kugouID", "uid")) or
               nested(("KugooID", "kugouID", "UserId", "userid", "uid", "uin")),
        "raw": raw,
    }


def kg_kg_sign(params):
    """生成酷狗详情请求的 signature：参数名排序 → 拼接 key=value → 两侧加 SALT → MD5。
    必须在参数全部确定后调用，signature 本身不应放进待签名参数。"""
    body = "".join(("%s=%s" % (k, params[k]) for k in sorted(params)))
    return hashlib.md5(
        (kugou_config.kg_SALT + body + kugou_config.kg_SALT).encode("utf-8")
    ).hexdigest()


def kg_http_get(url, headers=None, timeout=15):
    """发送酷狗 GET 请求，自动添加浏览器 UA 和酷狗 Referer；返回原始字节。
    headers 可覆盖默认头；timeout 单位为秒；网络异常交给调用方处理。"""
    request_lifecycle.check()
    h = {"User-Agent": kugou_config.kg_UA, "Referer": kugou_config.kg_REFERER}
    cookie = request_credentials.cookie('kugou')
    if cookie:
        h['Cookie'] = cookie
    if headers:
        h.update(headers)
    req = urllib.request.Request(url, headers=h)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        result = r.read()
    request_lifecycle.check()
    return result


def kg_http_json(url, headers=None, timeout=15):
    """调用 kg_http_get，再以 UTF-8 解码并解析 JSON；无效 JSON 会向上抛异常。"""
    return json.loads(kg_http_get(url, headers, timeout).decode("utf-8", "replace"))


def kgs_kg_sign(params):
    """生成酷狗搜索 signature；算法与详情相同，但读取搜索模块自己的 kgs_SALT。"""
    body = "".join(("%s=%s" % (k, params[k]) for k in sorted(params)))
    return hashlib.md5(
        (kugou_config.kgs_SALT + body + kugou_config.kgs_SALT).encode("utf-8")
    ).hexdigest()


def kgs_build_upstream(keyword, page=1, pagesize=100):
    """生成可重放的酷狗搜索 URL：复制最小参数，填关键词/页码/每页数量，再计算签名。"""
    p = dict(kugou_config.kgs_MIN_PARAMS, keyword=keyword, page=str(page), pagesize=str(pagesize))
    p["signature"] = kgs_kg_sign(p)
    return kugou_config.kgs_UPSTREAM + urllib.parse.urlencode(p)


def kgs_fetch_upstream(url, timeout=15):
    """请求酷狗搜索 URL 并解析 JSON；沿用原行为，不主动添加自定义请求头。"""
    headers = {}
    cookie = request_credentials.cookie('kugou')
    if cookie:
        headers['Cookie'] = cookie
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        result = json.loads(r.read().decode("utf-8", "replace"))
    return result
