"""平台适配：qqmusic / lyrics。"""

import base64
import json
import re
import urllib.error
import urllib.parse
import urllib.request
from music_app.providers.qqmusic import config as qqmusic_config
from music_app.providers.qqmusic import transport as qqmusic_transport


def qq__b64text(v):
    """PlayLyricInfo 下发 base64；偶尔给明文，两种都吃。"""
    v = (v or "").strip()
    if not v:
        return ""
    if v.startswith("[") or v.startswith("{"):
        return v
    try:
        dec = base64.b64decode(v + "=" * (-len(v) % 4)).decode("utf-8", "replace")
        return dec if dec.strip() else ""
    except Exception:
        return v


def lyric_read_rpc(data, cookie=None, timeout=6):
    """歌词及 songmid 恢复专用只读 RPC，不加入音源解析的重试/限流队列。"""
    ck = qqmusic_transport.qq_cookie_fields(cookie)
    encoded = urllib.parse.quote(json.dumps(data, ensure_ascii=False, separators=(',', ':')))
    token = qqmusic_transport.qq_hash33(ck['key']) if ck['key'] else 5381
    url = qqmusic_config.qq_MUSICU + '?format=json&data=' + encoded + '&g_tk=' + str(token)
    return qqmusic_transport.qq_http_json(url, qqmusic_transport.qq_headers(cookie), timeout=timeout)


def _strict_lyric(mid, cookie):
    """确认上游结构后返回歌词；错误不能变成“暂无歌词”。"""
    if not re.fullmatch(r'[A-Za-z0-9]{10,14}', str(mid or '')):
        raise ValueError('QQ音乐歌曲标识无效')
    out = {'lrc': '', 'trans': '', 'tlyric': '', 'roma': '', 'kana': '', 'qrc': '', 'source': ''}
    confirmed_empty = False
    try:
        response = lyric_read_rpc({'lyric': {
            'module': 'music.musichallSong.PlayLyricInfo', 'method': 'GetPlayLyricInfo',
            'param': {'songMID': str(mid), 'songID': 0, 'songType': 0, 'trans': 1, 'roma': 1}}}, cookie)
        node = response.get('lyric') if isinstance(response, dict) else None
        data = node.get('data') if isinstance(node, dict) and node.get('code') == 0 else None
        if (isinstance(data, dict) and isinstance(data.get('lyric'), str) and
                all(data.get(key) is None or isinstance(data.get(key), str) for key in ('trans', 'qrc', 'roma'))):
            out['lrc'] = qq__b64text(data['lyric'])
            out['trans'] = qq__b64text(data.get('trans'))
            out['qrc'] = qq__b64text(data.get('qrc'))
            roma = qq__b64text(data.get('roma'))
            out['roma'] = roma if re.match(r'\s*\[', roma) else ''
            kana = re.search(r'^\[kana:(.*?)\]\s*$', out['trans'], re.M)
            if kana:
                out['kana'] = kana.group(1).strip()
                out['trans'] = re.sub(r'^\[kana:.*?\]\s*$', '', out['trans'], flags=re.M).strip()
            out['tlyric'] = out['trans']
            out['source'] = 'PlayLyricInfo'
            if out['lrc']:
                return out
            confirmed_empty = True
    except (OSError, ValueError, TypeError, AttributeError, TimeoutError):
        pass
    try:
        query = urllib.parse.urlencode({'songmid': str(mid), 'g_tk': 5381, 'format': 'json',
            'nobase64': 1, 'inCharset': 'utf8', 'outCharset': 'utf-8', 'notice': 0,
            'platform': 'yqq.json', 'hostUin': 0, 'needNewCode': 0})
        response = qqmusic_transport.qq_http_json(qqmusic_config.qq_LYRIC_FCG + '?' + query,
            qqmusic_transport.qq_headers(cookie, qqmusic_config.qq_LYRIC_REFERER), timeout=6)
        if (isinstance(response, dict) and response.get('retcode') == 0 and
                isinstance(response.get('lyric'), str) and
                (response.get('trans') is None or isinstance(response.get('trans'), str))):
            out['lrc'] = response['lyric']
            out['trans'] = out['trans'] or qq__b64text(response.get('trans'))
            out['tlyric'] = out['trans']
            out['source'] = 'fcg_query_lyric_new'
            return out
    except (OSError, ValueError, TypeError, AttributeError, TimeoutError):
        pass
    if confirmed_empty:
        return out
    raise ValueError('QQ音乐歌词获取失败，请稍后重试') from None


def qq_get_lyric(mid, cookie=None, *, strict=False):
    """返回 {"lrc","trans","tlyric","roma","qrc","source"}；失败都是空串。

    注意：QQ 的翻译必须显式带 param.trans=1 才会下发（默认是空的）；
    罗马音 roma 下发的是加密二进制，这里只收能被当成 LRC 明文的情况。
    """
    if strict:
        return _strict_lyric(mid, cookie)
    out = {"lrc": "", "trans": "", "tlyric": "", "roma": "", "kana": "", "qrc": "", "source": ""}
    if not mid:
        return out
    try:
        data = {
            "lyric": {
                "module": "music.musichallSong.PlayLyricInfo",
                "method": "GetPlayLyricInfo",
                "param": {"songMID": mid, "songID": 0, "songType": 0, "trans": 1, "roma": 1},
            }
        }
        j = qqmusic_transport.qq_musicu(data, cookie)
        node = j.get("lyric") or {}
        d = node.get("data") or {}
        if node.get("code") in (0, None) and d:
            out["lrc"] = qq__b64text(d.get("lyric"))
            out["trans"] = qq__b64text(d.get("trans"))
            out["qrc"] = qq__b64text(d.get("qrc"))
            roma = qq__b64text(d.get("roma"))
            if re.match("\\s*\\[", roma or ""):
                out["roma"] = roma
            kana = re.search("^\\[kana:(.*?)\\]\\s*$", out["trans"], re.M)
            if kana:
                out["kana"] = kana.group(1).strip()
                out["trans"] = re.sub("^\\[kana:.*?\\]\\s*$", "", out["trans"], flags=re.M).strip()
            out["tlyric"] = out["trans"]
            if out["lrc"]:
                out["source"] = "PlayLyricInfo"
    except Exception:
        pass
    if not out["lrc"]:
        try:
            q = urllib.parse.urlencode(
                {
                    "songmid": mid,
                    "g_tk": 5381,
                    "format": "json",
                    "nobase64": 1,
                    "inCharset": "utf8",
                    "outCharset": "utf-8",
                    "notice": 0,
                    "platform": "yqq.json",
                    "hostUin": 0,
                    "needNewCode": 0,
                }
            )
            j = qqmusic_transport.qq_http_json(
                qqmusic_config.qq_LYRIC_FCG + "?" + q,
                qqmusic_transport.qq_headers(cookie, qqmusic_config.qq_LYRIC_REFERER),
            )
            if j.get("retcode") in (0, None):
                out["lrc"] = j.get("lyric") or ""
                out["trans"] = out["trans"] or qq__b64text(j.get("trans"))
                out["tlyric"] = out["tlyric"] or out["trans"]
                out["source"] = out["source"] or "fcg_query_lyric_new"
        except Exception:
            pass
    return out


def qq_get_lrc(mid, cookie=None):
    """只返回 QQ 原文 LRC，复用 qq_get_lyric 的多接口回退逻辑。"""
    return qq_get_lyric(mid, cookie).get("lrc") or ""
