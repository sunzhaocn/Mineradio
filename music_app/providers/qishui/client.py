"""汽水请求级会话参数、客户端 SDK 签名与只读 HTTP 请求。"""

import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import urllib.error
import urllib.parse
import urllib.request
from music_app.paths import CONFIG_DIR, resolve_project_path
from music_app.core import request_credentials
from music_app.core import request_lifecycle


HOST = "https://api.qishui.com"


class QishuiError(Exception):
    """携带可安全展示的状态码；禁止把上游 URL、Cookie 或签名塞进异常文本。"""

    def __init__(self, status, code, message):
        super().__init__(message)
        self.status, self.code = status, code


def session_path():
    return resolve_project_path(os.environ.get("QISHUI_SESSION", str(CONFIG_DIR / "qishui_session.json")))


def load_session():
    """只使用本次客户端请求的会话参数，缺少 Cookie 时只影响汽水平台。"""
    try:
        data = request_credentials.session_config()
        query, headers = data["query"], data["headers"]
        headers = {str(k).lower(): str(v) for k, v in headers.items()
                   if str(k).lower() in {"cookie", "user-agent", "x-luna-background-type",
                                        "x-luna-is-background-req", "x-luna-is-local-user"}}
        if not headers.get("cookie") or not query.get("device_id"):
            raise ValueError()
        if any("\r" in v or "\n" in v for v in headers.values()):
            raise ValueError()
        return {"query": query, "headers": headers}
    except (OSError, ValueError, KeyError, TypeError, AttributeError):
        from music_app import platform_runtime
        if platform_runtime.is_mobile():
            return {'query': {'aid': '386088', 'app_name': 'luna_pc', 'region': 'cn',
                'geo_region': 'cn', 'os_region': 'cn', 'version_name': '3.7.0',
                'device_platform': 'windows', 'device_type': 'Windows', 'ac': 'wifi'},
                'headers': {'user-agent': 'Mineradio/1.0 ' + ('iOS' if platform_runtime.is_ios() else 'Android'), 'accept': 'application/json'},
                'guest': True}
        raise QishuiError(503, "qishui_session_missing", "本次请求缺少汽水 Cookie 或设备会话参数，请在客户端登录后重试") from None


def sdk_directory():
    """网页与桌面共用独立 SDK；显式配置优先，其次项目内资源。"""
    from music_app import platform_runtime
    if platform_runtime.is_mobile():
        return Path(__file__).parent
    configured = os.environ.get("QISHUI_SDK_DIR")
    if configured:
        directory = Path(configured)
        if (directory / "bdms.node").is_file():
            return directory
    else:
        bundled = Path(__file__).resolve().parents[3] / "Windows_exe" / "sdk"
        if (bundled / "bdms.node").is_file():
            return bundled
        base = Path(os.environ.get("LOCALAPPDATA", "")) / "Programs" / "Soda Music"
        def version_key(p):
            return tuple(int(n) for n in re.findall(r"\d+", p.name))
        for version in sorted(base.glob("*"), key=version_key, reverse=True):
            directory = version / "resources" / "app.asar.unpacked"
            if (directory / "bdms.node").is_file():
                return directory
    raise QishuiError(503, "qishui_sdk_missing", "未找到汽水客户端签名 SDK，请安装客户端或设置 QISHUI_SDK_DIR")


def signed_headers(url, headers, session):
    """SDK 输入/输出均为名称、值交替的 CRLF 文本，并非 JSON 或请求体。

    敏感输入通过 stdin 传递，避免出现在进程命令行；原始输出只在内存解析。
    SDK 启动时可能输出自有消息，父进程只读取约定标记之后的签名结果。
    """
    request_lifecycle.check()
    from music_app import platform_runtime
    if platform_runtime.is_mobile():
        try:
            return platform_runtime.sign_headers(url, headers)
        except Exception as error:
            if platform_runtime.is_ios() and getattr(error, 'code', '') in ('signer_not_enabled', 'signer_privacy_consent_required'):
                raise QishuiError(503, 'qishui_activation_required', '请在汽水入口同意并启用连接组件') from None
            raise QishuiError(503, 'qishui_signing_failed', '设备本地签名服务暂不可用，请重新打开应用') from None
    node = shutil.which("node")
    windows_node = os.environ.get('QISHUI_WINDOWS_NODE')
    script = str(Path(__file__).with_name('runtime') / 'signer.cjs')
    directory = str(sdk_directory())
    if windows_node and os.name != 'nt':
        wine = shutil.which('wine') or '/usr/lib/wine/wine64'
        if not Path(wine).is_file() or not Path(windows_node).is_file():
            raise QishuiError(503, 'qishui_runtime_missing', '汽水服务器运行组件尚未就绪')
        def wine_path(value):
            return 'Z:' + str(Path(value).resolve()).replace('/', '\\')
        command = [wine, windows_node, wine_path(script)]
        directory = wine_path(directory)
    elif node:
        command = [node, script]
    else:
        raise QishuiError(503, "qishui_node_missing", "汽水请求签名需要本机 Node.js")
    payload = {"sdkDirectory": directory, "deviceId": session["query"]["device_id"],
               "url": url, "headers": "\r\n".join(str(x) for pair in headers.items() for x in pair)}
    try:
        process = subprocess.run(command,
                                 input=json.dumps(payload), capture_output=True, text=True,
                                 encoding="utf-8", errors="replace", timeout=12,
                                 creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        if process.returncode:
            raise ValueError()
        message = process.stdout.rsplit("QISHUI_SIGNATURE:", 1)[1].splitlines()[0]
        rows = json.loads(message)["output"].splitlines()
        result = {k: v for k, v in zip(rows[::2], rows[1::2]) if k in ("X-Helios", "X-Medusa")}
        if len(result) != 2 or any("\r" in v or "\n" in v for v in result.values()):
            raise ValueError()
        request_lifecycle.check()
        return result
    except (OSError, ValueError, KeyError, IndexError, TypeError, AttributeError, subprocess.SubprocessError):
        raise QishuiError(503, "qishui_signing_failed", "汽水签名失败，请检查 Node.js 与已安装客户端 SDK 是否兼容") from None


def request_json(route, query=None, body=None):
    """只开放已确认的数据读取接口，不转发收藏、账号和播放历史写入接口。

    discover 虽然使用 POST，语义仍是读取发现页；榜单详情只接受安全的榜单 ID，
    不允许调用方拼接任意路径。请求签名和登录资料仍只在本机内存中使用。
    """
    if route not in ("search/track", "track_v2", "discover", "me", "user/playlist", "comments",
                      "me/collection/mixed", "playlist/detail") and not re.fullmatch(r"charts/[A-Za-z0-9_-]{1,80}", route) and not re.fullmatch(r"albums/[1-9]\d{0,24}", route) and not re.fullmatch(r"artists/[1-9]\d{0,24}(?:/tracks)?", route):
        raise ValueError("Unsupported Qishui route")
    # POST /comments is CreateComment in the official IDL; this read entry must
    # never be usable as a comment publisher through a caller-supplied body.
    if route == 'comments' and body is not None:
        raise ValueError('Qishui comments only supports read requests')
    return _request_json(route, query, body)


def read_track(song_id, media_type=None, *, requester=None):
    """Read one native type; only an explicit type rejection permits one UGC retry."""
    if not re.fullmatch(r'[1-9]\d{0,24}', str(song_id)) or media_type not in (None, 'track', 'ugc_clip'):
        raise ValueError('汽水歌曲标识或音源类型格式错误')
    request = requester or request_json
    for native in ((media_type,) if media_type else ('track', 'ugc_clip')):
        try:
            return request('track_v2', body={'track_id': str(song_id), 'media_type': native,
                'queue_type': 'search_one_track', 'scene_name': 'search'})
        except QishuiError as error:
            if media_type is None and native == 'track' and getattr(error, 'upstream_code', None) == 1000005:
                continue
            raise
    raise QishuiError(404, 'qishui_track_missing', '当前汽水歌曲资料无法读取')


def write_library(operation, playlist_id, song_id, *, liked=False, media_type='track'):
    """仅开放已确认的个人歌单写入协议，不接收调用方提供的路径。"""
    if operation not in ('add', 'remove') or not re.fullmatch(r'[1-9]\d{0,24}', str(song_id)):
        raise ValueError('汽水歌单同步参数错误')
    if not re.fullmatch(r'[A-Za-z0-9_-]{1,128}', str(playlist_id)):
        raise ValueError('汽水歌单标识格式错误')
    if media_type not in ('track', 'ugc_clip'):
        raise ValueError('当前汽水音源类型暂不支持云歌单同步')
    if liked:
        route = 'me/collection/media' + ('/delete' if operation == 'remove' else '')
        body = {'media': [{'type': media_type, 'id': str(song_id)}]}
        if operation == 'add':
            # Soda 3.7.0's actual CollectService.setCollect omits the IDL's
            # collect_action field (casts as never); deletion has no scene.
            body['scene'] = ''
    else:
        # Official Soda 3.7.0 source maps define DeletePlaylistMedia with the
        # same playlist_id/media body as MAppendPlaylistMedia.
        route = 'me/playlist/media/' + ('append' if operation == 'add' else 'delete')
        body = {'playlist_id': str(playlist_id), 'media': [{'id': str(song_id), 'type': media_type}]}
    return _request_json(route, body=body)


def write_comment_like(song_id, comment_id, liked):
    """Soda 3.7.0 CommentAction 的显式点赞/取消赞入口，不开放任意写路由。

    客户端主评论使用空 reply_id；type=1 为赞，type=3 为取消赞。
    回复需要另带主评论 ID，当前此入口只允许主评论。
    """
    if (not re.fullmatch(r'[1-9]\d{0,24}', str(song_id)) or
            not re.fullmatch(r'[1-9]\d{0,24}', str(comment_id)) or type(liked) is not bool):
        raise ValueError('汽水评论点赞参数格式错误')
    return _request_json('comments/action', body={
        'comment_id': str(comment_id), 'reply_id': '', 'group_id': str(song_id),
        'type': 1 if liked else 3, 'scene_name': 'comment_detail'})


def _request_json(route, query=None, body=None):
    request_lifecycle.check()
    session = load_session()
    from music_app import platform_runtime
    native_search = platform_runtime.is_mobile() and route == 'search/track'
    common = dict(session['query'])
    if native_search:
        # Original Android SearchResultApi is POST /luna/search/{search_type}.
        # A PC GET URL with mobile SDK signatures can return an empty body even
        # when the public discover route accepts the same signing bridge.
        common.update(aid='8478', app_name='luna', channel='oppo_8478_64',
            version_name='21.3.0', version_code='100213030',
            manifest_version_code='100213030', update_version_code='100213030',
            device_platform='android', ssmix='a', os='android')
        common.pop('device_type', None)
        if platform_runtime.is_ios():
            common.update(device_platform='iphone', os='ios', channel='App Store')
        body = {**(query or {}), 'search_type':'track'}
        query = None
    url = HOST + ("/luna/" if native_search else "/luna/pc/") + route + "?" + urllib.parse.urlencode({**common, **(query or {})})
    headers = dict(session["headers"])
    data = None
    if body is not None:
        data = json.dumps(body, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        headers["content-type"] = "application/json; charset=UTF-8"
        # MD5 在这里用于协议校验；必须与真正发送的字节完全一致。
        headers["X-SS-STUB"] = hashlib.md5(data).hexdigest().upper()
    headers.update(signed_headers(url, headers, session))
    request_lifecycle.check()
    try:
        req = urllib.request.Request(url, data=data, headers=headers)
        with urllib.request.urlopen(req, timeout=20) as response:
            result = json.loads(response.read(8 * 1024 * 1024))
    except urllib.error.HTTPError as exc:
        status = 401 if exc.code in (401, 403) else 502
        raise QishuiError(status, "qishui_upstream_error", "汽水请求被拒绝，请检查登录是否过期或稍后重试") from None
    except (OSError, ValueError):
        raise QishuiError(502, "qishui_upstream_error", "汽水返回为空、格式异常或请求超时，请稍后重试") from None
    request_lifecycle.check()
    if not isinstance(result, dict):
        raise QishuiError(502, "qishui_invalid_response", "汽水返回格式异常")
    if result.get("status_code", 0):
        error = QishuiError(502, "qishui_upstream_rejected", "汽水未接受请求，请检查登录资料是否有效")
        error.upstream_code = result.get("status_code")
        raise error
    return result
