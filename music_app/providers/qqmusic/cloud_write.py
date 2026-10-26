"""QQ 歌单写入使用已验证的 Android 客户端协议与匿名设备会话。

认证资料只来自当前请求；设备及匿名会话缓存按凭据指纹隔离。
不自动重试写请求，也不保存用户 Cookie 或 musickey。
"""
import asyncio
import threading

from music_app.core import request_credentials
from music_app.paths import CACHE_DIR
from . import transport

_LOCK_GUARD = threading.Lock()
_DEVICE_LOCKS = {}


async def _send(method, param, musicid, musickey, login_type, device_path):
    from music_app import platform_runtime
    if platform_runtime.is_mobile():
        from . import mobile_protocol
        return mobile_protocol.write(method, param, musicid, musickey, login_type, device_path)
    from qqmusic_api import Client, Credential
    from qqmusic_api.core.transport import NiquestsTransport

    # Explicitly disable even connection retries; the bridge owns requestId
    # deduplication and a caller must read cloud state after uncertain failures.
    network = NiquestsTransport(connect_retries=0, timeout=(10, 45), max_concurrency=1)
    credential = Credential(musicid=int(musicid), musickey=musickey, login_type=login_type)
    async with asyncio.timeout(70):
        async with Client(credential=credential, device_path=str(device_path), transport=network,
                          max_concurrency=1) as client:
            operation = client.songlist.add_songs if method == 'AddSonglist' else client.songlist.del_songs
            songs = [(int(row['songId']), int(row['songType'])) for row in param['v_songInfo']]
            return await operation(int(param['dirId']), songs, tid=int(param.get('tid', 0)))


def write(method, param, musicid):
    from music_app.web.library import LibraryError

    if method not in ('AddSonglist', 'DelSonglist'):
        raise LibraryError('qq_write_invalid', 'QQ 音乐歌单操作无效')
    cookie = request_credentials.cookie('qqmusic')
    fingerprint = request_credentials.fingerprint('qqmusic')
    fields = transport.qq_cookie_fields(cookie)
    if not cookie or not fingerprint or not fields['key']:
        raise LibraryError('library_login_required', '请先提供当前 QQ 音乐登录凭据')
    cookie_fields = dict(part.strip().split('=', 1) for part in cookie.split(';') if '=' in part)
    supplied_type = cookie_fields.get('tmeLoginType')
    login_type = int(supplied_type) if supplied_type and supplied_type.isdigit() else (
        1 if fields['key'].startswith('W_X') else 2)
    device_dir = CACHE_DIR / 'qq-devices'
    device_path = device_dir / (fingerprint + '.json')
    with _LOCK_GUARD:
        device_lock = _DEVICE_LOCKS.setdefault(fingerprint, threading.Lock())
    try:
        with device_lock:
            device_dir.mkdir(parents=True, exist_ok=True)
            confirmed = asyncio.run(_send(method, param, musicid, fields['key'], login_type, device_path))
    except ImportError:
        from music_app import platform_runtime
        if platform_runtime.is_android():
            raise LibraryError('qq_write_android_unavailable', '此 Android 版本暂不支持 QQ 云歌单增删，请先使用本机歌单') from None
        if platform_runtime.is_ios():
            raise LibraryError('qq_write_mobile_unavailable', '此移动版本暂不支持 QQ 云歌单增删，请先使用本机歌单') from None
        raise LibraryError('qq_write_dependency_missing', 'QQ 音乐同步组件未安装，请安装项目 requirements.txt 后重试') from None
    except Exception as error:
        # Exceptions may contain authenticated URLs or payloads. Only expose
        # the numeric service code, never an arbitrary exception message.
        code = getattr(error, 'code', None)
        safe_code = str(code) if isinstance(code, (int, str)) and str(code).lstrip('-').isdigit() else ''
        suffix = '（状态码 ' + safe_code + '）' if safe_code else ''
        raise LibraryError('qq_write_unconfirmed', 'QQ 音乐同步尚未确认' + suffix + '，请刷新平台状态后核对') from None
    if confirmed is not True:
        raise LibraryError('qq_write_unconfirmed', 'QQ 音乐未确认歌单修改，请刷新平台状态后核对')
