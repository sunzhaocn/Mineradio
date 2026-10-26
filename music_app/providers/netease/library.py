"""网易云个人歌单目录和歌曲的只读适配；凭据仅由现有 transport 使用。"""
import json

from music_app.core.labels import song_labels
from music_app.core.artists import web_fields
from music_app.core import request_credentials
from . import transport


_PAGE_SIZE = 1000
_MAX_PAGES = 1000


def _number(value, default=0):
    try:
        return max(0, int(value if value is not None else default))
    except (TypeError, ValueError, OverflowError):
        return default


def _request(path, payload):
    cookie = request_credentials.cookie('netease')
    if not cookie:
        raise ValueError('请提供网易云音乐登录凭据')
    payload = dict(payload, csrf_token=transport.ne_cookie_fields(cookie)['csrf'])
    result = transport.ne_weapi_post(path, payload, cookie=cookie)
    from .session_status import classify, tracker
    state = classify(result) if path == '/weapi/w/nuser/account/get' else ('expired' if isinstance(result, dict) and result.get('code') in (301, '301') else 'unknown')
    tracker.observe(state)
    if state == 'expired':
        from music_app.core.session_health import LoginExpired
        raise LoginExpired('netease')
    if not isinstance(result, dict) or result.get('code') != 200:
        raise ValueError('网易云音乐库读取失败，请刷新或重新登录')
    return result


def _uid(account):
    account = account if isinstance(account, dict) else {}
    nested = account.get('account') or {}
    uid = account.get('userId') or nested.get('id') or account.get('id')
    if not uid:
        info = _request('/weapi/w/nuser/account/get', {})
        uid = (info.get('profile') or {}).get('userId') or (info.get('account') or {}).get('id')
    if not str(uid or '').isdigit() or _number(uid) <= 0:
        raise ValueError('网易云账号信息不可用，请重新登录')
    return str(uid)


def _playlist(raw, kind):
    return dict(id=str(raw['id']), name=raw.get('name') or '',
                cover=(raw.get('coverImgUrl') or raw.get('cover') or '').replace('http://', 'https://'),
                trackCount=_number(raw.get('trackCount', raw.get('track_count'))),
                provider='netease', source='netease', kind=kind, isLiked=kind == 'liked',
                subscribed=kind == 'collected', specialType=_number(raw.get('specialType')),
                editable=kind != 'collected', canAdd=kind != 'collected', canRemove=kind != 'collected')


def catalog(account=None):
    """完整读取用户创建及收藏的歌单；遇到重复页/分页上限显式失败。"""
    uid = _uid(account)
    raw_playlists, seen, offset = [], set(), 0
    for _ in range(_MAX_PAGES):
        result = _request('/weapi/user/playlist', dict(uid=uid, limit=_PAGE_SIZE, offset=offset, includeVideo=True))
        rows = result.get('playlist')
        if not isinstance(rows, list):
            raise ValueError('网易云歌单目录响应不完整')
        added = 0
        for row in rows:
            if not isinstance(row, dict) or not row.get('id'):
                raise ValueError('网易云歌单目录包含无效记录')
            key = str(row['id'])
            if key not in seen:
                raw_playlists.append(row)
                seen.add(key)
                added += 1
        offset += len(rows)
        total = _number(result.get('total', result.get('count')))
        more = result.get('more')
        if more in (False, 0) and total and offset < total:
            raise ValueError('网易云歌单目录提前结束，请稍后刷新')
        if more is False or more == 0 or (more is None and (total and offset >= total or len(rows) < _PAGE_SIZE)):
            break
        if not rows or not added:
            raise ValueError('网易云歌单目录分页没有推进，请稍后刷新')
    else:
        raise ValueError('网易云歌单目录过大，未能完成同步')
    liked_ids = {str(row['id']) for row in raw_playlists if _number(row.get('specialType')) == 5
                 and not row.get('subscribed')}
    # 网易的默认喜欢歌单固定排在用户自建歌单的首位；旧响应可能不带 specialType。
    if not liked_ids:
        first = next((row for row in raw_playlists if not row.get('subscribed')
                      and str((row.get('creator') or {}).get('userId', uid)) == uid), None)
        if first:
            liked_ids.add(str(first['id']))
    if not liked_ids:
        raise ValueError('网易云未返回我的喜欢歌单，请刷新或重新登录')
    playlists = []
    for row in raw_playlists:
        kind = ('liked' if str(row['id']) in liked_ids else
                'collected' if row.get('subscribed') or
                str((row.get('creator') or {}).get('userId', uid)) != uid else 'created')
        playlists.append(_playlist(row, kind))
    playlists.sort(key=lambda row: row['kind'] != 'liked')
    return dict(playlists=playlists, total=len(playlists), hasMore=False, nextOffset=len(playlists))


def _song(raw, privilege=None):
    album = raw.get('al') or raw.get('album') or {}
    artists = raw.get('ar') or raw.get('artists') or []
    labels = song_labels('netease', dict(raw, privilege=privilege or raw.get('privilege') or {}))
    return dict(id=str(raw['id']), name=raw.get('name') or '',
                artist=' / '.join(x.get('name', '') for x in artists if isinstance(x, dict) and x.get('name')),
                album=album.get('name') or '', albumId=str(album.get('id') or ''), albumMid='',
                cover=(album.get('picUrl') or '').replace('http://', 'https://'),
                duration=_number(raw.get('dt', raw.get('duration'))) / 1000,
                provider='netease', source='netease', type='song', **web_fields(artists), **labels)


def tracks(playlist_id, offset=0, limit=100, account=None):
    """按完整 trackIds 切页后批量取详情，避免 playlist.tracks 的首千首限制。"""
    pid = str(playlist_id or '')
    if not pid.isdigit() or _number(pid) <= 0:
        raise ValueError('网易云歌单编号无效')
    offset, limit = _number(offset), max(1, min(500, _number(limit, 100)))
    result = _request('/weapi/v6/playlist/detail', dict(id=pid, n=100000, s=0))
    playlist = result.get('playlist')
    if not isinstance(playlist, dict):
        raise ValueError('网易云歌单详情响应不完整')
    raw_tracks = playlist.get('tracks') or []
    index = playlist.get('trackIds')
    if not isinstance(index, list):
        index = raw_tracks
    ids = [str(row['id']) for row in index if isinstance(row, dict) and row.get('id')]
    total = max(_number(playlist.get('trackCount')), len(ids))
    if len(ids) < total:
        raise ValueError('网易云未返回完整歌曲索引，请刷新或重新登录')
    selected = ids[offset:offset + limit]
    rows, privileges = {}, {}
    if selected:
        detail = _request('/weapi/v3/song/detail', dict(c=json.dumps([{'id': int(sid)} for sid in selected]),
                                                      ids=json.dumps([int(sid) for sid in selected])))
        if not isinstance(detail.get('songs'), list):
            raise ValueError('网易云歌曲详情响应不完整')
        rows = {str(row['id']): row for row in detail['songs'] if isinstance(row, dict) and row.get('id')}
        privileges = {str(row['id']): row for row in detail.get('privileges') or []
                      if isinstance(row, dict) and row.get('id')}
    # 删除/无版权歌曲可能没有详情，分页位置仍按服务端索引推进。
    songs = [_song(rows[sid], privileges.get(sid)) for sid in selected if sid in rows]
    next_offset = min(total, offset + len(selected))
    return dict(tracks=songs, total=total, hasMore=next_offset < total, nextOffset=next_offset)


def _song_id(song):
    if not isinstance(song, dict) or song.get('provider', song.get('source')) != 'netease':
        raise ValueError('请选择网易云音乐的原生歌曲')
    sid = str(song.get('id') or '')
    if not sid.isdigit() or _number(sid) <= 0:
        raise ValueError('网易云歌曲编号无效')
    return sid


def _contains(playlist_id, song_id):
    result = _request('/weapi/v6/playlist/detail', dict(id=str(playlist_id), n=100000, s=0))
    playlist = result.get('playlist')
    if not isinstance(playlist, dict):
        raise ValueError('网易云歌单详情响应不完整')
    index = playlist.get('trackIds')
    if not isinstance(index, list):
        index = playlist.get('tracks')
    if not isinstance(index, list) or len(index) < _number(playlist.get('trackCount')):
        raise ValueError('网易云未返回完整歌曲索引，无法核对所在歌单')
    return any(str(row.get('id')) == song_id for row in index if isinstance(row, dict))


def memberships(song, account=None):
    """只列出当前账号能编辑、并确实包含该原生 ID 的歌单。"""
    sid = _song_id(song)
    playlists = [row for row in catalog(account)['playlists']
                 if row.get('editable') and _contains(row['id'], sid)]
    return dict(playlists=playlists, total=len(playlists))


def mutate(playlist_id, song, operation, account=None):
    """仅在用户确认目标后调用；不改别人的收藏歌单，写后读取真实成员状态。"""
    sid = _song_id(song)
    if operation not in ('add', 'remove'):
        raise ValueError('歌单操作无效')
    pid = str(playlist_id or '')
    target = next((row for row in catalog(account)['playlists'] if row['id'] == pid), None)
    if not target or not target.get('editable'):
        raise ValueError('只能修改当前网易云账号自己的歌单')
    wanted = operation == 'add'
    if _contains(pid, sid) != wanted:
        # 喜欢也是当前账号的真实默认歌单；旧 FM /radio/like 通道会拒绝当前 Web 会话。
        result = _request('/weapi/playlist/manipulate/tracks', dict(
            pid=pid, op='add' if wanted else 'del', trackIds=json.dumps([int(sid)]), imme='true'))
        if result.get('error'):
            raise ValueError('网易云拒绝修改歌单，请稍后刷新或重新登录')
        if _contains(pid, sid) != wanted:
            raise ValueError('网易云尚未确认歌单修改，请刷新后核对')
    return dict(ok=True, provider='netease', playlistId=pid, operation=operation, verified=True)
