"""歌手资料及热门歌曲；旧歌曲可先通过原平台元数据恢复歌手标识。"""
import importlib
import urllib.error

from music_app.api import params
from music_app.providers.qishui.client import QishuiError


def artist_response(one):
    platform = params.platform_of(one(*params.PLATFORM_PARAM_NAMES))
    if not platform:
        return 400, dict(code=400, error_code=400, msg='请提供有效的 platform：netease/qqmusic/kugou/qishui')
    identifier = one('mid', 'artist_mid', 'artistMid', 'id', 'artist_id', 'artistId').strip()
    song_id = one('song_id', 'songId').strip()
    name = one('name', 'artist_name').strip()
    try:
        offset, limit = int(one('offset') or '0'), int(one('limit', 'size') or '50')
        if offset < 0 or not 1 <= limit <= 100 or len(name) > 200:
            raise ValueError
    except ValueError:
        return 400, dict(code=400, error_code=400, msg='offset 应为非负整数，limit 应为 1–100，歌手名称最长 200 字符')
    if not identifier and not song_id:
        return 400, dict(code=400, error_code=400, msg='请提供歌手 id/mid，或用于恢复歌手信息的 song_id')
    module = importlib.import_module('music_app.providers.' + platform + '.artist')
    restored = None
    try:
        if not identifier:
            ref = module.resolve_artist(song_id, name=name)
            restored = ref
            identifier = ref.get('mid') or ref['id']
        body = module.fetch_artist(identifier, offset=offset, limit=limit)
    except FileNotFoundError:
        return 404, dict(code=404, error_code=404, platform=platform, msg='未找到可确认的歌手资料，请重新搜索歌曲后重试')
    except urllib.error.HTTPError as error:
        status = 404 if error.code == 404 else 502
        error.close()
        return status, dict(code=status, error_code=status, platform=platform, msg='歌手资料不存在或暂时不可用')
    except QishuiError as error:
        return error.status, dict(code=error.status, error_code=error.status, platform=platform,
                                  reason=error.code, msg=str(error))
    except ValueError:
        return 400, dict(code=400, error_code=400, platform=platform, msg='歌手或歌曲标识格式错误，请使用原平台标识')
    except (OSError, RuntimeError, TimeoutError):
        return 502, dict(code=502, error_code=502, platform=platform, msg='歌手资料读取失败，请稍后重试')
    if restored is not None:
        body = dict(body, resolved_artist=restored)
    return 200, params.with_meta(platform, 'artist', body)
