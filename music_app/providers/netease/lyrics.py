"""平台适配：netease / lyrics。"""

import urllib.error
import urllib.parse
import urllib.request
from music_app.providers.netease import config as netease_config
from music_app.providers.netease import transport as netease_transport


def ne_get_lyric(song_id, cookie=None, *, strict=False):
    """返回 {"lrc","tlyric","klyric","romalrc"}；失败返回空串。"""
    q = urllib.parse.urlencode({"id": int(song_id), "lv": -1, "tv": -1, "kv": -1, "rv": -1})
    try:
        js = netease_transport.ne_http_json(
            netease_config.ne_LYRIC_API + "?" + q, netease_transport.ne_headers(cookie)
        )
    except Exception:
        if strict:
            raise ValueError('网易云歌词获取失败，请稍后重试') from None
        return {"lrc": "", "tlyric": "", "klyric": "", "romalrc": ""}
    if not isinstance(js, dict) or (js.get('code') != 200 if strict else js.get('code') not in (None, 200)):
        if strict:
            raise ValueError('网易云暂时无法返回歌词，请稍后重试')
        return {"lrc": "", "tlyric": "", "klyric": "", "romalrc": ""}
    result, has_lyric_field = {}, False
    for key in ('lrc', 'tlyric', 'klyric', 'romalrc'):
        part = js.get(key)
        if part is not None and (not isinstance(part, dict) or not isinstance(part.get('lyric', ''), str)):
            if strict:
                raise ValueError('网易云歌词响应不完整，请稍后重试')
            part = None
        if isinstance(part, dict) and 'lyric' in part:
            has_lyric_field = True
        result[key] = part.get('lyric', '') if part else ''
    if strict and not has_lyric_field and not (js.get('nolyric') is True or js.get('uncollected') is True):
        raise ValueError('网易云歌词响应不完整，请稍后重试')
    result.update(nolyric=bool(js.get('nolyric')), uncollected=bool(js.get('uncollected')))
    return result


def ne_get_lrc(song_id, cookie=None):
    """兼容只取原文的调用方式；实际通过 ne_get_lyric 获取并返回 lrc。"""
    return ne_get_lyric(song_id, cookie).get("lrc") or ""
