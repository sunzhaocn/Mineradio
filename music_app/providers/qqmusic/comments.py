"""QQ 评论，协议来自 qqmusic-api-python 0.8.2 及 y.qq.com 当前评论组件。

点赞依据官方 common.chunk.ad5e47b12e2ca2168529.js 的 UpdateHotComment；
PRAISE=3、CANCEL_PRAISE=4。写操作不重试，也不把不完整响应当成功。
"""
import html
import json
import re

from music_app.core import request_credentials
from music_app.core.comments import CommentError, image_url, number, text
from music_app.providers.qqmusic import metadata, transport


def _song_id(song_id, mid=''):
    value = str(song_id or mid or '').strip()
    if re.fullmatch(r'[1-9]\d{0,19}', value):
        return value
    if not re.fullmatch(r'[A-Za-z0-9]{10,14}', value):
        raise CommentError('comments_song_invalid', 'QQ音乐歌曲标识不正确')
    # mid is the song mid, never the media_mid used to request audio files.
    track = metadata.qq_song_detail(mid=value, cookie=request_credentials.cookie('qqmusic'))
    identifier = str(track.get('id') or '') if isinstance(track, dict) else ''
    if not re.fullmatch(r'[1-9]\d{0,19}', identifier):
        raise CommentError('comments_song_not_found', '未能找到这首歌的QQ音乐评论标识', 404)
    return identifier


def _request(module, method, params, *, write=False):
    cookie = request_credentials.cookie('qqmusic')
    auth = transport.qq_cookie_fields(cookie)
    payload = {'comm': {'ct': 24, 'cv': 0, 'uin': auth['uin'] or '0', 'format': 'json'},
               'req': {'module': module, 'method': method, 'param': params}}
    try:
        result = transport.qq_musicu(payload, cookie=cookie, timeout=15, retries=0)
    except Exception:
        raise CommentError('comment_like_unconfirmed' if write else 'comments_upstream_error',
                           '未能确认点赞结果，请刷新评论查看实际状态' if write else 'QQ音乐评论暂时加载失败，请稍后重试', 502) from None
    node = result.get('req') if isinstance(result, dict) else None
    if write and (not isinstance(node, dict) or 'code' not in node or
                  (node.get('code') == 0 and not isinstance(node.get('data'), dict))):
        raise CommentError('comment_like_unconfirmed', '未能确认点赞结果，请刷新评论查看实际状态', 502)
    if not isinstance(node, dict) or node.get('code') != 0 or not isinstance(node.get('data'), dict):
        login = isinstance(node, dict) and node.get('code') in (1000, 1001, 2000)
        raise CommentError('comments_login_required' if login else 'comments_upstream_rejected',
                           'QQ音乐登录已失效，请重新登录' if login else 'QQ音乐未接受此次评论请求', 401 if login else 502)
    return node['data']


def _badge_label(*values):
    """Some IconList.Name values are serialized layout settings, not captions."""
    for value in values:
        if not isinstance(value, str):
            continue
        value = html.unescape(value).strip()
        if (not value or value.startswith(('{', '[')) or
                any(ord(char) < 32 for char in value) or re.search(r'<[^>]+>', value)):
            continue
        return text(value, 80)
    return ''


def _badges(row):
    badges, seen = [], set()
    def add(label, url, kind):
        url = image_url(url)
        if url and url not in seen:
            badges.append(dict(label=_badge_label(label), iconUrl=url, type=kind)); seen.add(url)
    add('VIP', row.get('VipIcon'), 'vip')
    add('平台认证', row.get('IdentityPic'), 'identity')
    add('粉丝标识', row.get('VipFansIcon'), 'fan')
    vip = row.get('VipUI') if isinstance(row.get('VipUI'), dict) else {}
    icons = []
    for group in (vip.get('iconlist'), vip.get('newiconlist'), row.get('IconList')):
        if isinstance(group, list):
            icons.extend(group)
    for badge in icons:
        if isinstance(badge, dict):
            add(_badge_label(badge.get('desc'), badge.get('name'), badge.get('Name')),
                badge.get('srcUrl') or badge.get('IconURL'), 'platform')
    medal = row.get('Medal') if isinstance(row.get('Medal'), dict) else {}
    if medal.get('HasEntry'):
        add(_badge_label(medal.get('Name'), medal.get('Title')), medal.get('IconURL'), 'medal')
    return badges


def _comment(row, *, depth=0):
    content = html.unescape(text(row.get('Content')))
    pictures = []
    pic = image_url(row.get('Pic'))
    if pic:
        pictures.append(dict(url=pic, thumbnailUrl=pic, alt='评论图片'))
    segments = [dict(type='text', text=content)] if content else []
    emote = image_url(row.get('EmoPic'))
    if emote:
        segments.append(dict(type='emoji', url=emote, alt='表情包'))
    replies = []
    if depth == 0:
        for reply in (row.get('SubComments') or []) + (row.get('RepliedComments') or []):
            if isinstance(reply, dict) and reply.get('CmId'):
                replies.append(_comment(reply, depth=1))
    return dict(id=text(row.get('CmId'), 256), content=content, segments=segments, pictures=pictures,
                user=dict(id=text(row.get('EncryptUin'), 256), nickname=html.unescape(text(row.get('Nick'), 200)),
                          avatarUrl=image_url(row.get('Avatar')), badges=_badges(row)),
                time=number(row.get('PubTime')) * 1000, likedCount=number(row.get('PraiseNum')),
                liked=bool(number(row.get('IsPraised'))), replyCount=number(row.get('ReplyCnt') or row.get('RplCnt')),
                replies=replies[:10], location=text(row.get('Location'), 120), canLike=True)


def read_comments(song_id, *, limit=20, cursor='', sort='hot', mid=''):
    if type(limit) is not int or not 1 <= limit <= 50 or sort not in ('hot', 'new'):
        raise CommentError('comments_page_invalid', 'QQ音乐评论分页参数不正确')
    page, seq = 0, ''
    if cursor:
        try:
            page, seq = json.loads(cursor)
            if type(page) is not int or not 1 <= page <= 10000 or not isinstance(seq, str) or len(seq) > 256:
                raise ValueError()
        except (ValueError, TypeError):
            raise CommentError('comments_cursor_invalid', 'QQ音乐评论分页已失效，请刷新') from None
    params = dict(BizType=1, BizId=_song_id(song_id, mid), LastCommentSeqNo=seq,
                  PageSize=min(limit, 25), PageNum=page, PicEnable=1)
    if sort == 'hot':
        params.update(HotType=1, WithAirborne=0)
    data = _request('music.globalComment.CommentRead', 'GetHotCommentList' if sort == 'hot' else 'GetNewCommentList', params)
    if data.get('SubCode', 0) != 0:
        raise CommentError('comments_upstream_rejected', 'QQ音乐未接受此次评论请求', 502)
    listing = data.get('CommentList')
    if not isinstance(listing, dict) or not isinstance(listing.get('Comments'), list):
        raise CommentError('comments_response_invalid', 'QQ音乐评论响应不完整，请稍后重试', 502)
    rows = [r for r in listing['Comments'] if isinstance(r, dict) and r.get('CmId')]
    # Upstream may insert a pinned comment in addition to PageSize; retain it.
    has_more = bool(number(listing.get('HasMore')) and rows)
    next_cursor = json.dumps([page + 1, str(rows[-1].get('SeqNo') or '')], separators=(',', ':')) if has_more else ''
    return dict(ok=True, provider='qqmusic', comments=[_comment(row) for row in rows],
                total=number(data.get('TotalCmNum') or listing.get('Total')), hasMore=has_more,
                nextCursor=next_cursor, sort=sort, capabilities=dict(read=True, like=True, write=False), message='')


def like_comment(song_id, comment_id, liked, *, mid=''):
    if type(liked) is not bool or not isinstance(comment_id, str) or not 1 <= len(comment_id) <= 256 or any(ord(c) < 32 for c in comment_id):
        raise CommentError('comment_like_invalid', 'QQ音乐评论点赞参数不正确')
    auth = transport.qq_cookie_fields(request_credentials.cookie('qqmusic'))
    if not auth['uin'] or not auth['key']:
        raise CommentError('comments_login_required', '登录QQ音乐后即可为评论点赞', 401)
    data = _request('GlobalComment.GlobalCommentWriteServer', 'UpdateHotComment',
                    dict(comment_id=comment_id, type=3 if liked else 4, uin=auth['uin']), write=True)
    if 'code' not in data or 'subcode' not in data:
        raise CommentError('comment_like_unconfirmed', '未能确认点赞结果，请刷新评论查看实际状态', 502)
    if data.get('code') != 0 or data.get('subcode') != 0:
        raise CommentError('comment_like_rejected', 'QQ音乐未接受此次点赞，请刷新评论后重试', 409)
    return dict(ok=True, liked=liked)
