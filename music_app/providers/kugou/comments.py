"""酷狗歌曲评论，使用官方 mcomment 评论池，不混用歌曲弹幕。

协议参考 MakcRe/KuGouMusicApi 的 comment_music.js 和官方响应的 tag：
/mcomment/v1/cmtlist、/mcomment/r/v1/rank/topliked、/mcomment/r/v1/rank/newest。
点赞参考官方 pc.service.kugou.com/yueku/2024/find/
p__song_comment__index.ada9dffe.async.js 的 CommentItem.like 与 islike 回调。
"""
import datetime
import gzip
import hashlib
import html
import json
import re
import time
import urllib.parse
import urllib.request
from collections import OrderedDict
from threading import Lock

from music_app.core import request_credentials
from music_app.core import request_lifecycle
from music_app.core.comments import CommentError, image_url, number, text
from music_app.providers.kugou import album, artist, metadata, transport

_CODE = 'fc4be23b4e972707f36b8a828a93ba8a'
_ROUTES = {'hot': '/mcomment/r/v1/rank/topliked', 'new': '/mcomment/r/v1/rank/newest'}
_TARGETS = OrderedDict()
_TARGET_LOCK = Lock()
_TARGET_TTL = 120
_TARGET_MAX = 512
_EMOJI = {'[玫瑰]': '🌹', '[爱心]': '❤️', '[心]': '❤️', '[流泪]': '😢', '[微笑]': '🙂',
          '[大哭]': '😭', '[呲牙]': '😁', '[可爱]': '😊', '[强]': '👍', '[太阳]': '☀️',
          '[月亮]': '🌙', '[拥抱]': '🤗', '[鼓掌]': '👏', '[蛋糕]': '🎂', '[凋谢]': '🥀'}


def _song_id(song_id, native_id=''):
    if native_id not in ('', None):
        if isinstance(native_id, bool) or not re.fullmatch(r'[1-9]\d{0,24}', str(native_id)):
            raise CommentError('comments_song_invalid', '酷狗歌曲评论标识不正确')
        return str(native_id)
    try:
        return artist._song_entity(song_id)
    except ValueError:
        raise CommentError('comments_song_invalid', '酷狗歌曲标识不正确') from None
    except Exception as original:
        # 移动元数据并非总有 album[]；可播的 hash 仍可能有官方 Web 曲目标识。
        # 只接受相同 hash 的原生 album_audio_id，绝不按标题搜索相似歌曲代替。
        if re.fullmatch(r'[A-Fa-f0-9]{32}', str(song_id)):
            try:
                data = metadata.kg_songinfo(str(song_id), key='hash').get('data') or {}
                resolved = str(data.get('album_audio_id') or '')
                if (str(data.get('hash') or '').lower() == str(song_id).lower() and
                        re.fullmatch(r'[1-9]\d{0,24}', resolved)):
                    return resolved
            except Exception:
                pass
        if isinstance(original, FileNotFoundError):
            raise CommentError('comments_song_not_found', '未找到这首歌的酷狗评论标识', 404) from None
        raise CommentError('comments_upstream_error', '酷狗歌曲资料暂时加载失败，请稍后重试', 502) from None


def _request(route, params):
    request_lifecycle.check()
    if route not in (*_ROUTES.values(), '/mcomment/v1/cmtlist'):
        raise ValueError('不支持的酷狗评论接口')
    auth = transport.kg_cookie_fields(request_credentials.cookie('kugou'))
    now = int(time.time())
    query = dict(dfid=auth['dfid'] or '-', mid=auth['mid'] or album._GUEST_MID, uuid='-',
                 appid=1005, clientver=20489, clienttime=now, **params)
    if auth['token']:
        query['token'] = auth['token']
    if re.fullmatch(r'[1-9]\d{0,24}', auth['uid']):
        query['userid'] = auth['uid']
    signed = ''.join('%s=%s' % (key, query[key]) for key in sorted(query))
    query['signature'] = hashlib.md5((album._SALT + signed + album._SALT).encode()).hexdigest()
    headers = {'User-Agent': 'Android15-1070-11083-46-0-DiscoveryDRADProtocol-wifi',
               'Referer': 'https://www.kugou.com/', 'mid': query['mid'], 'dfid': query['dfid'],
               'clienttime': str(now), 'Accept-Encoding': 'gzip'}
    if auth['raw']:
        headers['Cookie'] = auth['raw']
    request = urllib.request.Request('https://gateway.kugou.com' + route + '?' + urllib.parse.urlencode(query),
                                     data=b'', headers=headers)
    try:
        with urllib.request.build_opener(album._NoRedirect()).open(request, timeout=15) as response:
            raw = response.read(4 * 1024 * 1024 + 1)
        if len(raw) > 4 * 1024 * 1024:
            raise ValueError()
        if raw.startswith(b'\x1f\x8b'):
            raw = gzip.decompress(raw)
        result = json.loads(raw)
    except Exception:
        raise CommentError('comments_upstream_error', '酷狗评论暂时加载失败，请稍后重试', 502) from None
    request_lifecycle.check()
    if not isinstance(result, dict) or result.get('status') not in (1, '1') or result.get('err_code', 0) not in (0, '0'):
        raise CommentError('comments_upstream_rejected', '酷狗未接受此次评论请求，请稍后重试', 502)
    return result


def _target_key(song_id, comment_id):
    # Comment IDs identify the same upstream toggle even if two tabs use hash
    # and mixsongid aliases. One shared pending flag must cover both aliases.
    return (request_credentials.fingerprint('kugou'), str(comment_id))


def _remember_targets(song_id, native_id, rows):
    """短期保存同一账号刚读到的真实评论池标识，绝不把歌曲 ID 当 childrenid。"""
    now = time.monotonic()
    with _TARGET_LOCK:
        for key in list(_TARGETS):
            if _TARGETS[key]['expires'] <= now and not _TARGETS[key]['pending']:
                del _TARGETS[key]
        for row in rows:
            child = str(row.get('special_child_id') or '')
            identifier = str(row.get('id') or '')
            if not re.fullmatch(r'[1-9]\d{0,24}', child) or not re.fullmatch(r'[1-9]\d{0,24}', identifier):
                continue
            likes = row.get('like') if isinstance(row.get('like'), dict) else {}
            if type(likes.get('haslike')) not in (bool, int):
                continue
            key = _target_key(song_id, identifier)
            if _TARGETS.get(key, {}).get('pending'):
                continue
            _TARGETS[key] = dict(childrenId=child, liked=bool(likes['haslike']),
                count=number(likes.get('likenum') if 'likenum' in likes else likes.get('count')),
                expires=now + _TARGET_TTL, pending=False, needsRefresh=False,
                songs={str(song_id).strip().upper(), native_id})
            _TARGETS.move_to_end(key)
        while len(_TARGETS) > _TARGET_MAX:
            # Never evict an active toggle: another list read could otherwise
            # recreate it as idle and submit the same upstream action twice.
            removable = next((key for key, value in _TARGETS.items() if not value['pending']), None)
            if removable is None:
                break
            del _TARGETS[removable]


def _like_request(target, comment_id, auth):
    """官方 handlelike 是一次切换；TLS 网关路由已只读 HEAD 核实，禁止重试。"""
    timestamp = int(time.time() * 1000)
    device_mid = auth['mid'] or album._GUEST_MID
    params = dict(modulecode=_CODE, clienttime=timestamp // 1000, timestamp=timestamp,
                  mid=device_mid, ver='2.02',
                  assign=hashlib.md5((_CODE + str(timestamp) + '949ad1dac503e48ad6e86bb841383485' + device_mid).encode()).hexdigest(),
                  tid=0, childrenid=target['childrenId'], object=comment_id,
                  kugouid=auth['uid'], clienttoken=auth['token'], appid='1001', **{'from': 'pc'}, uuid='-')
    headers = {'x-router': 'like.service.kugou.com', 'Referer': 'https://pc.service.kugou.com/',
               'User-Agent': 'Mozilla/5.0', 'Content-Type': 'application/json', 'Accept-Encoding': 'gzip'}
    request = urllib.request.Request('https://gateway.kugou.com/like/handlelike?' + urllib.parse.urlencode(params),
                                     data=b'{}', headers=headers)
    try:
        with urllib.request.build_opener(album._NoRedirect()).open(request, timeout=15) as response:
            raw = response.read(1024 * 1024 + 1)
        if len(raw) > 1024 * 1024:
            raise ValueError()
        if raw.startswith(b'\x1f\x8b'):
            raw = gzip.decompress(raw)
        return json.loads(raw)
    except Exception:
        raise CommentError('comment_like_unconfirmed', '未能确认点赞结果，请刷新评论查看实际状态', 502) from None


def _badges(row):
    badges, seen = [], set()
    level = number(row.get('svip_level'))
    if level:
        badges.append(dict(label='SVIP ' + str(level), iconUrl='', type='vip'))
    elif number(row.get('vip_type')):
        badges.append(dict(label='VIP', iconUrl='', type='vip'))
    identity = row.get('vinfo9') if isinstance(row.get('vinfo9'), dict) else {}
    def add(label, url, kind):
        url = image_url(url)
        if url and url not in seen:
            badges.append(dict(label=text(label, 80), iconUrl=url, type=kind)); seen.add(url)
    add(identity.get('auth_info') or identity.get('user_label') or '平台标识', identity.get('pic'), 'identity')
    medals = row.get('udetails') or [row.get('udetail')]
    for medal in medals:
        if isinstance(medal, dict):
            add(medal.get('word_v3') or medal.get('medal_roll_word') or '',
                medal.get('small_pic_v3') or medal.get('medal_def_small_pic'), 'medal')
    return badges


def _timestamp(value):
    try:
        date = datetime.datetime.strptime(str(value), '%Y-%m-%d %H:%M:%S')
        return int(date.replace(tzinfo=datetime.timezone(datetime.timedelta(hours=8))).timestamp() * 1000)
    except (ValueError, TypeError, OverflowError):
        return 0


def _comment(row, *, depth=0):
    content = html.unescape(text(row.get('content')))
    for token, emoji in _EMOJI.items():
        content = content.replace(token, emoji)
    pictures = []
    for picture in row.get('images') or []:
        if isinstance(picture, dict):
            url = image_url(picture.get('url'))
            if url:
                pictures.append(dict(url=url, thumbnailUrl=url, alt=text(picture.get('label') or '评论图片', 100)))
    likes = row.get('like') if isinstance(row.get('like'), dict) else {}
    replies = []
    if depth == 0:
        for reply in row.get('reply_list') or row.get('replies') or []:
            if isinstance(reply, dict) and reply.get('id'):
                replies.append(_comment(reply, depth=1))
    return dict(id=text(row.get('id'), 256), content=content,
                segments=[dict(type='text', text=content)] if content else [], pictures=pictures,
                user=dict(id=text(row.get('user_id'), 256), nickname=html.unescape(text(row.get('user_name'), 200)),
                          avatarUrl=image_url(row.get('user_pic')), badges=_badges(row)),
                time=_timestamp(row.get('addtime')), timeText=text(row.get('addtime'), 80),
                likedCount=number(likes.get('likenum') if 'likenum' in likes else likes.get('count')),
                liked=bool(likes.get('haslike')), replyCount=number(row.get('reply_num')),
                replies=replies[:10], location=text(row.get('location'), 120),
                canLike=depth == 0 and bool(re.fullmatch(r'[1-9]\d{0,24}', str(row.get('special_child_id') or ''))))


def read_comments(song_id, *, limit=20, cursor='', sort='hot', mid='', native_id=''):
    if type(limit) is not int or not 1 <= limit <= 50 or sort not in _ROUTES:
        raise CommentError('comments_page_invalid', '酷狗评论分页参数不正确')
    if cursor and not re.fullmatch(r'[1-9]\d{0,4}', str(cursor)):
        raise CommentError('comments_cursor_invalid', '酷狗评论分页已失效，请刷新')
    page = int(cursor or 1)
    native_id = _song_id(song_id, native_id)
    result = _request(_ROUTES[sort], dict(ver=6, mixsongid=native_id, need_show_image=1,
                      p=page, pagesize=limit, extdata='0', code=_CODE))
    if not isinstance(result.get('list'), list) or 'count' not in result:
        raise CommentError('comments_response_invalid', '酷狗评论响应不完整，请稍后重试', 502)
    rows = [r for r in result['list'] if isinstance(r, dict) and r.get('id')]
    request_lifecycle.check()
    _remember_targets(song_id, native_id, rows)
    total = number(result.get('count'))
    has_more = bool(rows and page * limit < total)
    return dict(ok=True, provider='kugou', comments=[_comment(row) for row in rows], total=total,
                hasMore=has_more, nextCursor=str(page + 1) if has_more else '', sort=sort,
                capabilities=dict(read=True, like=True, write=False), message='')


def like_comment(song_id, comment_id, liked, *, mid=''):
    if type(liked) is not bool or not re.fullmatch(r'[1-9]\d{0,24}', str(comment_id)):
        raise CommentError('comment_like_invalid', '酷狗评论点赞参数不正确')
    auth = transport.kg_cookie_fields(request_credentials.cookie('kugou'))
    if not auth['token'] or not re.fullmatch(r'[1-9]\d{0,24}', auth['uid']):
        raise CommentError('comments_login_required', '登录酷狗音乐后即可为评论点赞', 401)
    key = _target_key(song_id, comment_id)
    with _TARGET_LOCK:
        target = _TARGETS.get(key)
        if not target or target['expires'] <= time.monotonic() or str(song_id).strip().upper() not in target['songs']:
            raise CommentError('comment_like_refresh_required', '请先刷新评论，再为这条评论点赞', 409)
        if target['pending']:
            raise CommentError('comment_like_pending', '这条评论的点赞正在处理，请稍候', 409)
        if target.get('needsRefresh'):
            raise CommentError('comment_like_refresh_required', '评论点赞状态已变化，请刷新评论后重试', 409)
        if target['liked'] == liked:
            raise CommentError('comment_like_refresh_required', '评论点赞状态已变化，请刷新评论后重试', 409)
        target = dict(target)
        _TARGETS[key]['pending'] = True
    try:
        result = _like_request(target, str(comment_id), auth)
        if not isinstance(result, dict) or 'status' not in result:
            raise CommentError('comment_like_unconfirmed', '未能确认点赞结果，请刷新评论查看实际状态', 502)
        if result['status'] not in (1, '1'):
            raise CommentError('comment_like_rejected', '酷狗未接受此次点赞，请刷新评论后重试', 409)
        actual = result.get('islike')
        if type(actual) not in (bool, int) or actual not in (0, 1):
            raise CommentError('comment_like_unconfirmed', '未能确认点赞结果，请刷新评论查看实际状态', 502)
        actual = bool(actual)
        count = max(0, target['count'] + int(actual) - int(target['liked']))
        with _TARGET_LOCK:
            if key in _TARGETS:
                _TARGETS[key].update(liked=actual, count=count, pending=False)
        if actual != liked:
            raise CommentError('comment_like_state_changed', '平台返回的点赞状态已变化，请刷新评论查看实际状态', 409)
        return dict(ok=True, liked=actual, likedCount=count)
    except Exception as error:
        with _TARGET_LOCK:
            if isinstance(error, CommentError) and error.code == 'comment_like_state_changed' and key in _TARGETS:
                # Retain the confirmed state, but require a fresh list read
                # before another toggle can be sent under any new request ID.
                _TARGETS[key].update(pending=False, needsRefresh=True)
            else:
                _TARGETS.pop(key, None)
        if isinstance(error, CommentError):
            raise
        raise CommentError('comment_like_unconfirmed', '未能确认点赞结果，请刷新评论查看实际状态', 502) from None
