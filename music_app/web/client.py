"""只连接固定本机 API，校验汽水本机音频端点。"""
import json
import re
import urllib.error
import urllib.parse
import urllib.request
from music_app.core import request_credentials
from music_app.core import request_lifecycle

from . import constants as _web_constants


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, message, headers, newurl):
        # This internal JSON API has no redirect flow. Never forward a client's
        # credentials or cancellation ticket to a location in a response.
        return None


def upstream(path, *, request_timeout=85, **params):
    """只向固定的本机 API 请求 JSON，浏览器不能指定任意上游地址。"""
    url = _web_constants.API + path + '?' + urllib.parse.urlencode(params)
    with request_lifecycle.forward_ticket() as ticket:
        headers = {'X-Music-Credentials': request_credentials.header_value()}
        if ticket:
            headers[request_lifecycle.TICKET_HEADER] = ticket
        request = urllib.request.Request(url, headers=headers)
        try:
            request_lifecycle.check()
            opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), _NoRedirect())
            with opener.open(request, timeout=request_timeout) as response:
                data = json.load(response)
            request_lifecycle.check()
        except urllib.error.HTTPError as error:
            error.close()
            request_lifecycle.check()
            if 300 <= error.code < 400:
                raise ValueError('本机音乐接口返回了非预期跳转') from None
            raise
        except OSError:
            request_lifecycle.check()
            raise
    if not isinstance(data, dict):
        raise ValueError('本机音乐接口返回的数据格式无效')
    # 歌曲资料中的 error 可以是“音源加密/指定音质不可用”，仍需把音质和歌词送到网页。
    if data.get('error_code') not in (None, 0, 200) or data.get('code', 200) not in (0, 200):
        raise ValueError(data.get('msg') or data.get('error') or '音乐平台请求失败')
    return data

def local_qishui_audio_url(url):
    """只解析主 API 的汽水音频端点，不接受其它本机地址、参数或跳转目标。"""
    value = str(url or '')
    relative = value[len(_web_constants.API):] if value.startswith(_web_constants.API + '/') else value
    match = re.fullmatch(r'/qishui/audio\?id=([1-9]\d{0,24})&quality=(medium|higher|highest|lossless|spatial|hi_res)', relative)
    return _web_constants.API + relative if match else ''
