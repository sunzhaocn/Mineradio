"""QQ 音乐创建/收藏歌单和 dirid=201 我的喜欢的只读适配。"""
import html
import urllib.parse

from music_app.core.labels import song_labels
from music_app.core.artists import web_fields
from music_app.core import request_credentials
from . import config, metadata, search_views, transport


LIKED_ID = 'qq-liked'
_PAGE_SIZE = 200
_MAX_PAGES = 1000


def _cookie():
    cookie = request_credentials.cookie('qqmusic')
    if not cookie:
        raise ValueError('请提供 QQ 音乐登录凭据')
    return cookie


def _number(value, default=0):
    try:
        return max(0, int(value if value is not None else default))
    except (TypeError, ValueError, OverflowError):
        return default


def _uid(account):
    account = account if isinstance(account, dict) else {}
    nested = account.get('account') or {}
    # 音乐账号 id 优先；腾讯登录时的 QQ 号 uin 不一定等于音乐账号 musicid。
    cookie = _cookie()
    fields = dict(part.strip().split('=', 1) for part in cookie.split(';') if '=' in part)
    uid = (account.get('userId') or nested.get('id') or account.get('id') or fields.get('qqmusic_uin') or
           transport.qq_cookie_fields(cookie)['uin'])
    uid = str(uid or '').lstrip('o')
    if not uid.isdigit() or _number(uid) <= 0:
        raise ValueError('QQ 音乐账号信息不可用，请重新登录')
    return uid


def _get(url, params):
    params = dict(format='json', inCharset='utf8', outCharset='utf-8', notice=0,
                  platform='yqq.json', needNewCode=0, **params)
    result = transport.qq_http_json(url + '?' + urllib.parse.urlencode(params),
                                   transport.qq_headers(_cookie(), referer='https://y.qq.com/portal/profile.html'))
    if not isinstance(result, dict) or result.get('code') not in (0, '0'):
        raise ValueError('QQ 音乐库读取失败，请刷新或重新登录')
    return result


def _all_playlists(uid, kind):
    result, seen, offset = [], set(), 0
    for _ in range(_MAX_PAGES):
        if kind == 'created':
            body = _get('https://c.y.qq.com/rsc/fcgi-bin/fcg_user_created_diss',
                        dict(hostUin=0, hostuin=uid, sin=offset, size=_PAGE_SIZE, g_tk=5381, loginUin=uid))
            data = body.get('data') or {}
            rows, total = data.get('disslist'), _number(data.get('totoal', data.get('total')))
            more = data.get('has_more')
        else:
            body = _get('https://c.y.qq.com/fav/fcgi-bin/fcg_get_profile_order_asset.fcg',
                        dict(ct=20, cid=205360956, userid=uid, reqtype=3, sin=offset,
                             ein=offset + _PAGE_SIZE - 1))
            data = body.get('data') or {}
            rows, total = data.get('cdlist'), _number(data.get('totaldiss', data.get('total')))
            more = data.get('has_more')
        if not isinstance(rows, list):
            raise ValueError('QQ 音乐歌单目录响应不完整')
        added = 0
        for row in rows:
            if not isinstance(row, dict):
                raise ValueError('QQ 音乐歌单目录包含无效记录')
            key = str(row.get('dissid') or row.get('tid') or row.get('diss_id') or row.get('id') or row.get('dirid') or '')
            if not key:
                raise ValueError('QQ 音乐歌单目录缺少编号')
            if key not in seen:
                result.append(row)
                seen.add(key)
                added += 1
        offset += len(rows)
        if more in (False, 0, '0') and not (total and offset < total):
            break
        if total and offset >= total:
            break
        if more is None and not total and len(rows) < _PAGE_SIZE:
            break
        if not rows or not added:
            raise ValueError('QQ 音乐歌单目录分页没有推进，请稍后刷新')
    else:
        raise ValueError('QQ 音乐歌单目录过大，未能完成同步')
    return result


def _song(raw):
    track = raw if any(raw.get(key) for key in ('songid', 'songmid', 'mid', 'name')) else (
        raw.get('track_info') or raw.get('songInfo') or raw.get('songinfo') or raw.get('song') or {})
    album = track.get('album') or {}
    album_mid = album.get('mid') or track.get('albummid') or ''
    mid = str(track.get('mid') or track.get('songmid') or '')
    if not mid:
        return None
    singers = track.get('singer') or track.get('singers') or []
    name = track.get('name') or track.get('songname') or ''
    return dict(id=mid, mid=mid, mediaMid=(track.get('file') or {}).get('media_mid') or
                track.get('strMediaMid') or track.get('media_mid') or mid,
                name=html.unescape(name), artist=' / '.join(x.get('name', '') for x in singers
                if isinstance(x, dict) and x.get('name')) or track.get('singername') or '',
                album=album.get('name') or album.get('title') or track.get('albumname') or '',
                albumId=str(album.get('id') or track.get('albumid') or ''), albumMid=album_mid,
                cover=search_views.qqs_cover_of(album_mid), duration=_number(track.get('interval')),
                provider='qq', source='qq', type='song', qqId=str(track.get('id') or track.get('songid') or ''),
                songType=_number(track.get('type', track.get('songtype'))), **web_fields(singers), **song_labels('qqmusic', track))


def _diss_page(disstid, dirid, offset, limit):
    body = transport.qq_musicu({'comm': {'ct': 24, 'cv': 0}, 'req_0': {
        'module': 'music.srfDissInfo.DissInfo', 'method': 'CgiGetDiss', 'param': {
            'disstid': int(disstid), 'dirid': int(dirid), 'tag': 1, 'song_begin': offset, 'song_num': limit,
            'userinfo': 1, 'orderlist': 1}}}, cookie=_cookie())
    block = body.get('req_0') if isinstance(body, dict) else None
    if disstid == 0 and dirid == 201:
        from .session_status import classify, tracker
        state = classify(body)
        tracker.observe(state)
        if state == 'expired':
            from music_app.core.session_health import LoginExpired
            raise LoginExpired('qq')
    data = block.get('data') if isinstance(block, dict) else None
    if (not isinstance(data, dict) or any(value not in (None, 0, '0') for value in (
            body.get('code'), block.get('code'), data.get('code'), data.get('subcode')))):
        raise ValueError('QQ 音乐歌单读取失败，请重新完成 QQ 音乐登录授权')
    rows = data.get('songlist')
    if not isinstance(rows, list):
        raise ValueError('QQ 音乐歌单响应不完整')
    span = max(_number(data.get('songlist_size')), len(rows))
    total = _number(data['total_song_num']) if data.get('total_song_num') is not None else offset + span
    next_offset = min(total, offset + span)
    more = data.get('hasmore') in (True, 1, '1') or next_offset < total
    if more and (not span or next_offset <= offset):
        raise ValueError('QQ 音乐歌单分页没有推进，请稍后刷新')
    songs = [song for raw in rows if isinstance(raw, dict) and (song := _song(raw))]
    return dict(tracks=songs, total=total, hasMore=more, nextOffset=next_offset)


def _liked_page(offset, limit):
    return _diss_page(0, 201, offset, limit)


def catalog(account=None):
    uid = _uid(account)
    liked = _liked_page(0, 1)
    playlists = [dict(id=LIKED_ID, name='我的喜欢', cover=(liked['tracks'][0]['cover'] if liked['tracks'] else
                      'https://y.gtimg.cn/mediastyle/global/img/cover_like.png'), trackCount=liked['total'],
                      provider='qq', source='qq', kind='liked', isLiked=True, virtual=True, dirid='201',
                      editable=True, canAdd=True, canRemove=True)]
    seen = {LIKED_ID}
    for kind in ('created', 'collected'):
        for raw in _all_playlists(uid, kind):
            if str(raw.get('dirid') or raw.get('dir_id') or '') == '201':
                continue
            # 205/206 是后台特殊目录；tid=0 时没有可读取的真实歌单，不能当成 disstid。
            if (_number(raw.get('dirid', raw.get('dir_id'))) in (205, 206) and
                    not any(_number(raw.get(key)) for key in ('dissid', 'tid', 'diss_id', 'id'))):
                continue
            key = str(raw.get('dissid') or raw.get('tid') or raw.get('diss_id') or raw.get('id') or raw.get('dirid') or '')
            if key in seen:
                continue
            seen.add(key)
            playlists.append(dict(id=key, name=html.unescape(raw.get('diss_name') or raw.get('dissname') or
                                  raw.get('name') or raw.get('title') or ''),
                                  cover=(raw.get('diss_cover') or raw.get('logo') or raw.get('picurl') or
                                         raw.get('cover') or '').replace('http://', 'https://'),
                                  trackCount=_number(raw.get('song_cnt', raw.get('songnum', raw.get('total_song_num',
                                                      raw.get('song_count'))))), provider='qq', source='qq', kind=kind,
                                  isLiked=False, subscribed=kind == 'collected',
                                  dirid=str(raw.get('dirid') or raw.get('dir_id') or ''), virtual=False,
                                  editable=kind == 'created', canAdd=kind == 'created', canRemove=kind == 'created'))
    return dict(playlists=playlists, total=len(playlists), hasMore=False, nextOffset=len(playlists))


def tracks(playlist_id, offset=0, limit=100, account=None):
    _uid(account)
    offset, limit = _number(offset), max(1, min(100, _number(limit, 100)))
    pid = str(playlist_id or '')
    if pid in (LIKED_ID, 'qq-likes', '201'):
        return _liked_page(offset, limit)
    if not pid.isdigit() or _number(pid) <= 0:
        raise ValueError('QQ 音乐歌单编号无效')
    return _diss_page(pid, 0, offset, limit)


def _song_mid(song):
    if not isinstance(song, dict) or song.get('provider', song.get('source')) not in ('qq', 'qqmusic'):
        raise ValueError('请选择 QQ 音乐的原生歌曲')
    mid = str(song.get('mid') or song.get('id') or '')
    if not mid or not mid.isascii() or not mid.isalnum() or len(mid) > 64:
        raise ValueError('QQ 音乐歌曲 MID 无效')
    return mid


def _contains(playlist_id, mid, account=None):
    offset = 0
    for _ in range(10000):
        page = tracks(playlist_id, offset, 100, account)
        if any(row['id'] == mid for row in page['tracks']):
            return True
        if not page['hasMore']:
            return False
        if page['nextOffset'] <= offset:
            raise ValueError('QQ 音乐歌单分页没有推进，无法核对所在歌单')
        offset = page['nextOffset']
    raise ValueError('QQ 音乐歌单过大，未完成歌曲归属核对')


def memberships(song, account=None):
    mid = _song_mid(song)
    playlists = [row for row in catalog(account)['playlists']
                 if row.get('editable') and _contains(row['id'], mid, account)]
    return dict(playlists=playlists, total=len(playlists))


def _write(method, param, uid):
    """只发一次已验证的客户端写请求，不尝试失败的无签名 Web 协议。"""
    from .cloud_write import write
    return write(method, param, uid)


def mutate(playlist_id, song, operation, account=None):
    mid = _song_mid(song)
    if operation not in ('add', 'remove'):
        raise ValueError('歌单操作无效')
    pid = str(playlist_id or '')
    uid = _uid(account)
    target = next((row for row in catalog(account)['playlists'] if row['id'] == pid), None)
    if not target or not target.get('editable') or not _number(target.get('dirid')):
        raise ValueError('只能修改当前 QQ 音乐账号自己的歌单')
    wanted = operation == 'add'
    if _contains(pid, mid, account) != wanted:
        native = metadata.qq_song_detail(mid=mid, cookie=_cookie())
        if not isinstance(native, dict) or str(native.get('mid') or native.get('songmid') or '') != mid:
            raise ValueError('QQ 音乐未确认歌曲原生编号，无法同步')
        song_id = _number(native.get('id', native.get('songid')))
        if not song_id:
            raise ValueError('QQ 音乐未返回歌曲数字编号，无法同步')
        param = dict(dirId=int(target['dirid']), tid=0 if target['isLiked'] else int(pid), bFmtUtf8=True,
                     v_songInfo=[dict(songId=song_id, songType=_number(native.get('type', native.get('songtype'))))])
        write_error = None
        try:
            _write('AddSonglist' if wanted else 'DelSonglist', param, uid)
        except Exception as error:
            # A server can commit before a response is lost or ambiguous. Read
            # state once rather than repeating a write or reporting false failure.
            write_error = error
        if _contains(pid, mid, account) != wanted:
            if write_error is not None: raise write_error
            raise ValueError('QQ 音乐尚未确认歌单修改，请刷新后核对')
    return dict(ok=True, provider='qq', playlistId=pid, operation=operation, verified=True)
