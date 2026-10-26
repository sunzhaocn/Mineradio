"""四平台只读专辑入口；凭据沿用当前请求上下文。"""
import urllib.error

from music_app.api import params as api_params
from music_app.providers.qishui.client import QishuiError


def album_response(one):
    platform = api_params.platform_of(one(*api_params.PLATFORM_PARAM_NAMES))
    if not platform:
        return 400, dict(code=400, error_code=400, msg='请提供有效的 platform：netease/qqmusic/kugou/qishui')
    identifier = one('mid', 'album_mid', 'albumMid', 'id', 'album_id', 'albumId').strip()
    try:
        offset = int(one('offset') or '0')
        limit = int(one('limit', 'size') or '100')
        if offset < 0 or not 1 <= limit <= 200:
            raise ValueError
    except ValueError:
        return 400, dict(code=400, error_code=400, msg='offset 应为非负整数，limit 应为 1–200')
    if not identifier:
        return 400, dict(code=400, error_code=400, msg='缺少专辑 ID；QQ 音乐也可使用专辑 mid')
    # 按需加载，专辑读取不初始化其他平台的网络请求。
    if platform == 'netease':
        from music_app.providers.netease.album import fetch_album
    elif platform == 'qqmusic':
        from music_app.providers.qqmusic.album import fetch_album
    elif platform == 'kugou':
        from music_app.providers.kugou.album import fetch_album
    else:
        from music_app.providers.qishui.album import fetch_album
    try:
        body = fetch_album(identifier, offset=offset, limit=limit)
    except FileNotFoundError:
        return 404, dict(code=404, error_code=404, platform=platform, msg='专辑不存在或已下架')
    except urllib.error.HTTPError as error:
        status = 404 if error.code == 404 else 502
        return status, dict(code=status, error_code=status, platform=platform, msg='专辑不存在或已下架' if status == 404 else '专辑上游暂时不可用，请稍后重试')
    except QishuiError as error:
        return error.status, dict(code=error.status, error_code=error.status,
                                  platform=platform, reason=error.code, msg=str(error))
    except ValueError:
        return 400, dict(code=400, error_code=400, platform=platform, msg='专辑标识格式错误，请使用该平台原生专辑 ID 或 mid')
    except (OSError, RuntimeError, TimeoutError):
        return 502, dict(code=502, error_code=502, platform=platform, msg='专辑上游暂时不可用，请稍后重试')
    return 200, api_params.with_meta(platform, 'album', body)
