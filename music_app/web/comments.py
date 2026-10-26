"""当前音源的评论及显式点赞桥接，按请求凭据隔离，绝不使用共享账号。"""
from importlib import import_module
import re
import threading
import time

from music_app.core import request_credentials
from music_app.core.comments import CommentError, normalize_comment, number, text


ROUTES = {'/api/song/comments': 'netease', '/api/qq/song/comments': 'qq',
          '/api/kugou/song/comments': 'kugou', '/api/qishui/song/comments': 'qishui'}
LIKE_ROUTES = {path + '/like': provider for path, provider in ROUTES.items()}
_LOCK = threading.Lock()
_WRITE_LOCKS = {}
_RESULTS = {}


def _adapter(provider):
    return import_module('music_app.providers.' + ('qqmusic' if provider == 'qq' else provider) + '.comments')


def _identifier(value, *, comment=False):
    if not isinstance(value, (str, int)) or isinstance(value, bool):
        raise CommentError('comment_id_invalid', '歌曲或评论标识无效')
    value = str(value)
    pattern = r'[A-Za-z0-9_!.*:+-]+' if comment else r'[A-Za-z0-9_-]+'
    if not value or len(value) > 256 or not re.fullmatch(pattern, value):
        raise CommentError('comment_id_invalid', '歌曲或评论标识无效')
    return value


def read(provider, query):
    try:
        limit = int(query.get('limit', 20))
        if not 1 <= limit <= 50:
            raise ValueError()
        sort = query.get('sort', 'hot')
        if sort not in ('hot', 'new', 'default'):
            raise ValueError()
        cursor = query.get('cursor', '')
        if len(cursor) > 2048 or any(ord(c) < 32 for c in cursor):
            raise ValueError()
        identifier = _identifier(query.get('id') or query.get('mid') or query.get('hash') or '')
        options = dict(limit=limit, cursor=cursor, sort=sort, mid=str(query.get('mid') or ''))
        if provider == 'qishui':
            options['media_type'] = query.get('nativeMediaType') or None
        if provider == 'kugou' and query.get('albumAudioId'):
            options['native_id'] = query['albumAudioId']
        result = _adapter(provider).read_comments(identifier, **options)
        if not isinstance(result, dict) or result.get('ok') is not True or not isinstance(result.get('comments'), list):
            raise CommentError('comments_response_invalid', '评论响应不完整，请重试', 502)
        rows = [row for value in result['comments'][:50] if (row := normalize_comment(value))]
        capabilities = result.get('capabilities') or {}
        return dict(ok=True, provider=provider, songId=identifier, comments=rows, total=number(result.get('total')),
                    hasMore=bool(result.get('hasMore')), nextCursor=text(result.get('nextCursor'), 2048),
                    sort=result.get('sort') or sort, capabilities=dict(read=True, like=bool(capabilities.get('like')), write=False,
                        sorts=[key for key in capabilities.get('sorts', ['hot', 'new']) if key in ('hot', 'new', 'default')]),
                    message=text(result.get('message'), 500))
    except (ValueError, TypeError):
        return dict(ok=False, provider=provider, error='comment_params_invalid', message='评论分页或歌曲参数无效')
    except CommentError as error:
        return dict(ok=False, provider=provider, error=error.code, message=error.message, status=error.status)
    except Exception:
        return dict(ok=False, provider=provider, error='comments_upstream_failed', message='评论暂时无法读取，请稍后重试')


def like(provider, payload):
    allowed = {'songId', 'commentId', 'liked', 'requestId', 'mid', 'nativeMediaType'}
    if not isinstance(payload, dict) or set(payload) - allowed or type(payload.get('liked')) is not bool:
        raise CommentError('comment_like_invalid', '点赞请求格式无效')
    song_id, comment_id = _identifier(payload.get('songId')), _identifier(payload.get('commentId'), comment=True)
    request_id = payload.get('requestId')
    if not isinstance(request_id, str) or not re.fullmatch(r'[A-Za-z0-9_-]{8,100}', request_id):
        raise CommentError('comment_request_id_invalid', '点赞操作标识无效，请刷新后重试')
    if not request_credentials.cookie(provider):
        raise CommentError('comments_login_required', '登录当前音乐平台后即可点赞', 401)
    scope = request_credentials.fingerprint(provider)
    operation_key = (provider, scope, request_id)
    operation = (song_id, comment_id, payload['liked'], str(payload.get('mid') or ''), payload.get('nativeMediaType'))
    with _LOCK:
        now = time.monotonic()
        for key in list(_RESULTS):
            if now - _RESULTS[key][0] > 180:
                del _RESULTS[key]
        for key, (created, pending_lock) in list(_WRITE_LOCKS.items()):
            if now - created > 180 and not pending_lock.locked():
                del _WRITE_LOCKS[key]
        if len(_RESULTS) >= 512:
            _RESULTS.pop(next(iter(_RESULTS)))
        if operation_key not in _WRITE_LOCKS:
            _WRITE_LOCKS[operation_key] = (now, threading.Lock())
        lock = _WRITE_LOCKS[operation_key][1]
    if not lock.acquire(timeout=25):
        raise CommentError('comment_like_pending', '此次点赞仍在处理中，请稍候', 409)
    try:
        with _LOCK:
            cached = _RESULTS.get(operation_key)
        if cached:
            if cached[1] != operation:
                raise CommentError('comment_request_conflict', '此操作标识已用于另一条评论', 409)
            if not cached[2].get('ok'):
                raise CommentError(cached[2]['error'], cached[2]['message'], cached[2]['status'])
            return dict(cached[2])
        options = dict(mid=str(payload.get('mid') or ''))
        if provider == 'qishui':
            options['media_type'] = payload.get('nativeMediaType')
        try:
            result = _adapter(provider).like_comment(song_id, comment_id, payload['liked'], **options)
            if not isinstance(result, dict) or result.get('ok') is not True:
                raise CommentError('comment_like_unconfirmed', '平台未确认点赞成功，请刷新后查看', 502)
        except CommentError as error:
            if error.code == 'comment_like_unconfirmed':
                with _LOCK:
                    _RESULTS[operation_key] = (time.monotonic(), operation,
                        dict(ok=False, error=error.code, message=error.message, status=error.status))
            raise
        except Exception:
            error = CommentError('comment_like_unconfirmed', '点赞结果暂未确认，请刷新评论查看实际状态', 502)
            with _LOCK:
                _RESULTS[operation_key] = (time.monotonic(), operation,
                    dict(ok=False, error=error.code, message=error.message, status=error.status))
            raise error from None
        response = dict(ok=True, provider=provider, commentId=comment_id, liked=bool(result.get('liked', payload['liked'])))
        if result.get('likedCount') is not None:
            response['likedCount'] = number(result['likedCount'])
        with _LOCK:
            _RESULTS[operation_key] = (time.monotonic(), operation, response)
        return response
    finally:
        lock.release()
