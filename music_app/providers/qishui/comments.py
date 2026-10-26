"""汽水原生歌曲评论，协议来自本机 Soda 3.7.0 的官方源码映射。

ListComments: GET /luna/pc/comments；CommentAction: POST comments/action。
客户端没有使用 sort_type，故只提供原生顺序，不臆造“热门/最新”参数。
只使用当前请求绑定的 Cookie/会话，不读取磁盘上的旧登录资料。
"""
import base64
from functools import lru_cache
import json
from pathlib import Path
import re
import struct

from music_app.core import request_credentials
from music_app.core.comments import CommentError, image_url, number, text
from .client import QishuiError, load_session, request_json, sdk_directory, write_comment_like


@lru_cache(maxsize=1)
def _installed_emojis(path, modified):
    """只读已安装客户端的 PNG 资源，不执行 JS，也不复制客户端资产。

    官方 douyinEmojis.ts 通过 emoji.json manifest 和 Vite glob 将方括号
    表情映射到包内 PNG。安装版本变化时重新解析；没有客户端时保留原文。
    """
    filename = Path(path)
    if not 16 <= filename.stat().st_size <= 64 * 1024 * 1024:
        return {}
    blob = filename.read_bytes()
    header_size, json_size = struct.unpack_from('<I', blob, 4)[0], struct.unpack_from('<I', blob, 12)[0]
    if not 0 < json_size < header_size < len(blob):
        return {}
    header = json.loads(blob[16:16 + json_size])
    if not isinstance(header, dict):
        return {}
    assets = header.get('files', {}).get('assets', {}).get('files', {})
    base = header_size + 8
    def read_entry(name):
        entry = assets.get(name) or {}
        if entry.get('unpacked') or not str(entry.get('offset', '')).isdigit():
            return b''
        start, size = base + int(entry['offset']), int(entry.get('size', 0))
        if start < base or size < 0 or start + size > len(blob):
            return b''
        return blob[start:start + size]
    manifest = next((json.loads(read_entry(name)) for name in assets
                     if re.fullmatch(r'emoji-[\w-]+\.json', name)), {})
    script = next((read_entry(name).decode('utf-8') for name in assets
                   if re.fullmatch(r'main-[\w-]+\.js', name)), '')
    if not isinstance(manifest, dict) or not script:
        return {}
    resources = {}
    for resource, variable in re.findall(r'"\./assets/douyin-emojis/([^"/]+)\.png":(__vite_glob_\d+_\d+)', script):
        inline = re.search(re.escape(variable) + r'="(data:image/png;base64,[A-Za-z0-9+/=]+)"', script)
        if inline:
            url = image_url(inline.group(1))
        else:
            packaged = re.search(re.escape(variable) + r'=""\+new URL\("([\w.-]+\.png)"', script)
            data = read_entry(packaged.group(1)) if packaged else b''
            url = image_url('data:image/png;base64,' + base64.b64encode(data).decode()) if data else ''
        if url:
            resources[resource] = url
    return {str(item['name']): resources[item['resource_name']]
            for item in _list(manifest.get('available_emojis'))
            if isinstance(item, dict) and item.get('name') and item.get('resource_name') in resources}


@lru_cache(maxsize=2)
def _bundled_emojis(path, modified):
    """读取网页和安装版共用的独立表情清单，不依赖客户端归档。"""
    manifest = Path(path)
    if not 2 <= manifest.stat().st_size <= 4 * 1024 * 1024:
        return {}
    raw = json.loads(manifest.read_text(encoding='utf-8-sig'))
    if not isinstance(raw, dict):
        return {}
    return {name: safe for name, url in raw.items()
            if isinstance(name, str) and isinstance(url, str) and (safe := image_url(url))}


def _segments(content):
    if '[' not in content:
        return [{'type': 'text', 'text': content}] if content else []
    try:
        sdk = sdk_directory()
        manifest = sdk / 'qishui-emojis.json'
        if manifest.is_file():
            emojis = _bundled_emojis(str(manifest), manifest.stat().st_mtime_ns)
        else:
            path = sdk.parent / 'main.asar'
            emojis = _installed_emojis(str(path), path.stat().st_mtime_ns)
    except (QishuiError, OSError, ValueError, TypeError, KeyError, AttributeError, struct.error, UnicodeError):
        emojis = {}
    result, offset = [], 0
    for match in re.finditer(r'\[([^\[\]\r\n]{1,40})\]', content):
        url = emojis.get(match.group(1))
        if not url:
            continue
        if match.start() > offset:
            result.append({'type': 'text', 'text': content[offset:match.start()]})
        result.append({'type': 'emoji', 'url': url, 'alt': match.group(0)})
        offset = match.end()
    if offset < len(content):
        result.append({'type': 'text', 'text': content[offset:]})
    return result


def _identifier(value, label):
    value = str(value)
    if not re.fullmatch(r'[1-9]\d{0,24}', value):
        raise CommentError('invalid_comment_id', label + '格式不正确')
    return value


def _list(value):
    return value if isinstance(value, list) else []


def _upstream_error(error):
    missing = error.code == 'qishui_session_missing'
    raise CommentError('login_required' if missing else error.code,
                       '请先登录汽水音乐后查看或点赞评论' if missing else str(error),
                       401 if missing else error.status) from None


def _url(info, *, avatar=False):
    """评论图片直接使用 urls[0]；头像按官方 getImageUrl 组合 URLInfo。"""
    if not isinstance(info, dict):
        return image_url(info) if isinstance(info, str) else ''
    urls = info.get('urls') or []
    if not isinstance(urls, list) or not urls:
        return ''
    value = str(urls[0])
    if avatar and info.get('uri'):
        prefix = info.get('template_prefix')
        suffix = str(prefix) + '-crop-center:80:80.jpg' if prefix else 'c5_80x80.jpg'
        value += str(info['uri']) + '~' + suffix
    return image_url(value)


def _user(comment):
    user = comment.get('user') if isinstance(comment.get('user'), dict) else {}
    artist_info = comment.get('user_artist_info') or {}
    artist = artist_info.get('artist_brief') or {} if isinstance(artist_info, dict) else {}
    if not isinstance(artist, dict):
        artist = {}
    badges = []
    stage = user.get('vip_stage')
    if stage in ('svip', 'vip', 'free_vip'):
        badges.append({'label': 'SVIP' if stage == 'svip' else 'VIP', 'iconUrl': '', 'type': 'vip'})
    # Only display labels explicitly supplied by the platform.
    if comment.get('comment_label'):
        badges.append({'label': text(comment['comment_label'], 80), 'iconUrl': '', 'type': 'identity'})
    if comment.get('featured') is True:
        badges.append({'label': '精选', 'iconUrl': '', 'type': 'featured'})
    return {'id': text(artist.get('id') or user.get('id'), 256),
            'nickname': text(artist.get('name') or user.get('nickname') or '汽水用户', 200),
            'avatarUrl': _url(artist.get('url_avatar') or user.get('thumb_avatar_url') or
                              user.get('medium_avatar_url'), avatar=True), 'badges': badges}


def _comment(raw, *, depth=0, can_like=False):
    if not isinstance(raw, dict) or not re.fullmatch(r'[1-9]\d{0,24}', str(raw.get('id') or '')):
        return None
    content = text(raw.get('content'))
    pictures = []
    for image in _list(raw.get('image_list'))[:12]:
        if not isinstance(image, dict):
            continue
        original = _url(image.get('origin_url')) or _url(image.get('download_url'))
        thumbnail = _url(image.get('medium_url'))
        if original or thumbnail:
            pictures.append({'url': original or thumbnail, 'thumbnailUrl': thumbnail or original,
                             'alt': '汽水评论图片'})
    replies = []
    if depth == 0:
        replies = [item for reply in _list(raw.get('reply_comments'))[:10]
                   if (item := _comment(reply, depth=1, can_like=False))]
    return {'id': str(raw['id']), 'content': content,
            'segments': _segments(content),
            'pictures': pictures, 'user': _user(raw), 'time': number(raw.get('time_created')) * 1000,
            'likedCount': number(raw.get('count_digged')), 'liked': raw.get('user_digged') is True,
            'replyCount': number(raw.get('count_reply')), 'replies': replies,
            'location': text(raw.get('ip_label'), 120), 'canLike': bool(can_like and depth == 0)}


def read_comments(song_id, *, limit=20, cursor='', sort='hot', mid='', media_type=None):
    song_id = _identifier(song_id, '汽水歌曲 ID')
    if (type(limit) is not int or not 1 <= limit <= 50 or not isinstance(cursor, str) or
            len(cursor) > 2048 or any(ord(c) < 32 for c in cursor)):
        raise CommentError('invalid_comment_page', '汽水评论分页参数不正确')
    if sort not in ('hot', 'default'):
        raise CommentError('comment_sort_unsupported', '汽水仅支持平台原生评论顺序')
    native_type = media_type or ('ugc_clip' if mid == 'ugc_clip' else 'track')
    if native_type not in ('track', 'ugc_clip'):
        raise CommentError('comment_media_type_unsupported', '当前汽水音源类型暂不支持评论')
    try:
        result = request_json('comments', {'group_id': song_id, 'group_type': 3 if native_type == 'ugc_clip' else 0,
                                          'cursor': cursor, 'count': limit, 'image_strategy': 3})
    except QishuiError as error:
        _upstream_error(error)
    if not isinstance(result, dict) or not isinstance(result.get('comments', []), list):
        raise CommentError('qishui_comments_invalid', '汽水评论返回格式异常', 502)
    can_like = bool(request_credentials.cookie('qishui') and request_credentials.session_config())
    comments = [item for row in result.get('comments', [])[:limit]
                if (item := _comment(row, can_like=can_like))]
    return {'ok': True, 'provider': 'qishui', 'comments': comments,
            'total': number(result.get('count')), 'hasMore': bool(result.get('has_more')),
            'nextCursor': text(result.get('cursor'), 2048), 'sort': 'default',
            'capabilities': {'read': True, 'like': True, 'write': False, 'sorts': ['default']},
            'message': '按汽水原生评论顺序显示'}


def like_comment(song_id, comment_id, liked, *, mid='', media_type=None):
    song_id = _identifier(song_id, '汽水歌曲 ID')
    comment_id = _identifier(comment_id, '汽水评论 ID')
    if type(liked) is not bool:
        raise CommentError('invalid_comment_like', '点赞状态必须为布尔值')
    if media_type not in (None, 'track', 'ugc_clip'):
        raise CommentError('comment_media_type_unsupported', '当前汽水音源类型暂不支持评论')
    try:
        # Fail before a write when the current request lacks its own full session.
        load_session()
    except QishuiError as error:
        _upstream_error(error)
    try:
        result = write_comment_like(song_id, comment_id, liked)
    except QishuiError as error:
        # A POST may have reached the server even when its response was lost or
        # malformed. Cache that uncertainty at the bridge instead of sending a
        # duplicate write when the same requestId is retried.
        if error.status == 502 and error.code in ('qishui_upstream_error', 'qishui_invalid_response'):
            raise CommentError('comment_like_unconfirmed', '未能确认汽水点赞结果，请刷新评论查看实际状态', 502) from None
        _upstream_error(error)
    if not isinstance(result, dict):
        raise CommentError('comment_like_unconfirmed', '未能确认汽水点赞结果，请刷新评论查看实际状态', 502)
    # CommentAction returns no authoritative count. Do not invent one locally.
    return {'ok': True, 'liked': liked}
