"""网易歌曲热评/最新评论和用户明确触发的赞/取消赞。"""
import json
import re
import urllib.parse
from html import unescape
from html.parser import HTMLParser

from music_app.core import request_credentials
from music_app.core.comments import CommentError, image_url, number, text
from . import transport


def _identifier(value, name='歌曲'):
    value = str(value or '')
    if not re.fullmatch(r'[1-9]\d{0,24}', value):
        raise CommentError('comment_id_invalid', name + '标识无效')
    return value


class _RichText(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == 'img':
            url = image_url(attrs.get('src'))
            if url:
                self.parts.append(dict(type='emoji' if attrs.get('alt') else 'image', url=url,
                                       alt=text(attrs.get('alt') or '评论图片', 200)))
        elif tag in ('br', 'p'):
            self.parts.append(dict(type='text', text='\n'))

    def handle_data(self, data):
        self.parts.append(dict(type='text', text=data))


def _segments(value):
    value = text(value)
    if re.search(r'<(?:img|br|p|span)\b', value, re.I):
        parser = _RichText()
        parser.feed(value)
        return parser.parts
    return [dict(type='text', text=unescape(value))] if value else []


def _pictures(raw):
    values = []
    if raw.get('expressionUrl'):
        values.append(raw['expressionUrl'])
    sticker = raw.get('contentStickerExt')
    if isinstance(sticker, str):
        try:
            sticker = json.loads(sticker)
        except ValueError:
            sticker = {}
    if isinstance(sticker, dict):
        values.extend(sticker.get(key) for key in ('url', 'imageUrl', 'originUrl', 'stickerUrl') if sticker.get(key))
    for field in ('pictures', 'images'):
        for value in raw.get(field) or []:
            values.append(value.get('url') or value.get('originUrl') if isinstance(value, dict) else value)
    result, seen = [], set()
    for value in values:
        url = image_url(value)
        if url and url not in seen:
            result.append(dict(url=url, thumbnailUrl=url, alt='评论表情或图片'))
            seen.add(url)
    return result


def _user(raw):
    badges = []
    rights = raw.get('vipRights') or {}
    for key, label in (('redplus', '黑胶 SVIP'), ('associator', '黑胶 VIP'), ('musicPackage', '音乐包')):
        value = rights.get(key)
        if isinstance(value, dict) and value.get('rights'):
            badges.append(dict(type='vip', label=label, iconUrl=image_url(value.get('iconUrl'))))
    if not badges and number(raw.get('vipType')):
        badges.append(dict(type='vip', label='VIP', iconUrl=''))
    detail = raw.get('avatarDetail') or {}
    if detail.get('identityIconUrl'):
        badges.append(dict(type='identity', label='平台身份标识', iconUrl=image_url(detail['identityIconUrl'])))
    elif number(raw.get('authStatus')):
        badges.append(dict(type='verified', label='认证用户', iconUrl=''))
    return dict(id=str(raw.get('userId') or ''), nickname=raw.get('nickname') or '网易云用户',
                avatarUrl=raw.get('avatarUrl') or '', badges=badges)


def _comment(raw, depth=0):
    content = raw.get('content') or raw.get('richContent') or ''
    result = dict(id=str(raw.get('commentId') or raw.get('beRepliedCommentId') or ''), content=content,
                  segments=_segments(raw.get('richContent') or content), pictures=_pictures(raw),
                  user=_user(raw.get('user') or {}), time=number(raw.get('time')),
                  timeText=raw.get('timeStr') or '', likedCount=number(raw.get('likedCount')),
                  liked=bool(raw.get('liked')), replyCount=number((raw.get('showFloorComment') or {}).get('replyCount')),
                  replies=[], location=(raw.get('ipLocation') or {}).get('location') or '', canLike=True)
    if depth == 0:
        result['replies'] = [_comment(reply, 1) for reply in (raw.get('beReplied') or [])[:10] if isinstance(reply, dict)]
    return result


def read_comments(song_id, *, limit=20, cursor='', sort='hot', mid=''):
    song_id = _identifier(song_id)
    if sort not in ('hot', 'new') or not re.fullmatch(r'\d{1,8}', str(cursor or '0')):
        raise CommentError('comment_params_invalid', '评论排序或分页参数无效')
    offset = int(cursor or 0)
    endpoint = 'hotcomments' if sort == 'hot' else 'comments'
    query = urllib.parse.urlencode(dict(limit=limit, offset=offset, beforeTime=0))
    try:
        result = transport.ne_http_json('https://music.163.com/api/v1/resource/' + endpoint + '/R_SO_4_' + song_id + '?' + query)
    except Exception:
        raise CommentError('comments_upstream_failed', '网易云评论读取失败，请稍后重试', 502) from None
    if not isinstance(result, dict) or result.get('code') != 200:
        login = isinstance(result, dict) and result.get('code') in (301, 302, 401)
        raise CommentError('comments_login_required' if login else 'comments_upstream_failed',
                           '请登录网易云后查看评论' if login else '网易云暂时无法返回评论，请稍后重试', 401 if login else 502)
    rows = result.get('hotComments' if sort == 'hot' else 'comments')
    if not isinstance(rows, list):
        raise CommentError('comments_response_invalid', '网易云评论响应不完整，请重试', 502)
    has_more = bool(result.get('hasMore') if sort == 'hot' else result.get('more'))
    return dict(ok=True, provider='netease', comments=[_comment(row) for row in rows if isinstance(row, dict)],
                total=number(result.get('total')), hasMore=bool(has_more and rows),
                nextCursor=str(offset + len(rows)) if has_more and rows else '', sort=sort,
                capabilities=dict(read=True, like=True, write=False), message='')


def like_comment(song_id, comment_id, liked, *, mid=''):
    song_id, comment_id = _identifier(song_id), _identifier(comment_id, '评论')
    if type(liked) is not bool:
        raise CommentError('comment_like_invalid', '请选择点赞或取消点赞')
    cookie = request_credentials.cookie('netease')
    if not cookie:
        raise CommentError('comments_login_required', '登录网易云后即可为评论点赞', 401)
    payload = dict(threadId='R_SO_4_' + song_id, commentId=comment_id,
                   csrf_token=transport.ne_cookie_fields(cookie)['csrf'])
    # 显式 desired state，无自动重试；超时后由页面刷新读取实际状态。
    try:
        result = transport.ne_weapi_post('/weapi/v1/comment/' + ('like' if liked else 'unlike'), payload, cookie=cookie)
    except Exception:
        raise CommentError('comment_like_unconfirmed', '未能确认点赞结果，请刷新评论查看实际状态', 502) from None
    if not isinstance(result, dict) or 'code' not in result:
        raise CommentError('comment_like_unconfirmed', '未能确认点赞结果，请刷新评论查看实际状态', 502)
    if not isinstance(result, dict) or result.get('code') != 200:
        login = isinstance(result, dict) and result.get('code') in (301, 302, 401)
        raise CommentError('comments_login_required' if login else 'comment_like_rejected',
                           '网易云登录已失效，请重新登录后点赞' if login else '平台未接受此次点赞，请稍后重试', 401 if login else 409)
    return dict(ok=True, liked=liked)
