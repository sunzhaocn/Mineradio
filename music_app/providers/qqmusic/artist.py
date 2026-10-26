"""QQ 音乐歌手资料和按热度排序的原生歌曲分页，只用本次请求凭据。"""
import html
import re
import urllib.error
import xml.etree.ElementTree as ET

from music_app.core import request_credentials
from music_app.core.artists import select_reference
from . import search_views, transport


_PAGE_SIZE = 100


def _identifier(value):
    if isinstance(value, bool) or not isinstance(value, (str, int)):
        raise ValueError('QQ 音乐歌手或歌曲编号无效')
    value = str(value).strip()
    if re.fullmatch(r'[0-9]{1,20}', value) and int(value) > 0:
        return str(int(value)), True
    if re.fullmatch(r'[A-Za-z0-9]{14}', value) and not value.isdigit():
        return value, False
    raise ValueError('QQ 音乐歌手或歌曲编号无效')


def _rpc(module, method, param):
    try:
        result = transport.qq_musicu({'comm': {'ct': 24, 'cv': 0}, 'req': {
            'module': module, 'method': method, 'param': param}}, cookie=request_credentials.cookie('qqmusic'))
    except urllib.error.HTTPError as error:
        error.close()
        raise RuntimeError('QQ 音乐歌手资料请求失败，请稍后重试') from None
    except Exception:
        raise RuntimeError('QQ 音乐歌手资料请求失败，请稍后重试') from None
    block = result.get('req') if isinstance(result, dict) else None
    if (not isinstance(block, dict) or result.get('code') not in (0, '0') or
            block.get('code') not in (0, '0') or not isinstance(block.get('data'), dict)):
        raise RuntimeError('QQ 音乐歌手资料响应异常，请稍后重试')
    return block['data']


def resolve_artist(song_id, name=''):
    """只读 get_song_detail 元数据，恢复旧队列/收藏中的歌手编号。"""
    song_id, numeric = _identifier(song_id)
    detail = _rpc('music.pf_song_detail_svr', 'get_song_detail' if numeric else 'get_song_detail_yqq',
                  {'song_id': int(song_id)} if numeric else {'song_type': 0, 'song_mid': song_id})
    track = detail.get('track_info')
    if track in (None, {}):
        raise FileNotFoundError('QQ 音乐歌曲不存在或已下架')
    if not isinstance(track, dict) or not isinstance(track.get('singer'), list):
        raise RuntimeError('QQ 音乐歌曲歌手资料格式异常')
    if str(track.get('id') if numeric else track.get('mid')) != song_id:
        raise RuntimeError('QQ 音乐返回的歌曲编号不匹配')
    return select_reference(track['singer'], name)


def _song_page(identifier, numeric, begin, num):
    data = _rpc('musichall.song_list_server', 'GetSingerSongList', dict(
        {'singerId': int(identifier)} if numeric else {'singerMid': identifier}, begin=begin, num=num, order=1))
    rows = data.get('songList')
    try:
        total = data['totalNum']
        if isinstance(total, bool) or not isinstance(total, (int, str)) or not re.fullmatch(r'[0-9]+', str(total)):
            raise ValueError
        total = int(total)
        if not isinstance(rows, list) or any(not isinstance(row, dict) for row in rows):
            raise ValueError
        if len(rows) != min(num, max(0, total - begin)):
            raise ValueError
    except (KeyError, TypeError, ValueError):
        raise RuntimeError('QQ 音乐歌手歌曲分页不完整，请稍后重试') from None
    mid = str(data.get('singerMid') or '')
    if not mid:
        if total == 0:
            raise FileNotFoundError('QQ 音乐歌手不存在')
        raise RuntimeError('QQ 音乐歌手歌曲缺少歌手标识')
    if not re.fullmatch(r'[A-Za-z0-9]{14}', mid) or (not numeric and mid != identifier):
        raise RuntimeError('QQ 音乐返回的歌手编号不匹配')
    return rows, total, mid


def _profile(mid):
    data = _rpc('music.musichallSinger.SingerInfoInter', 'GetSingerDetail', {
        'singer_mids': [mid], 'wiki_singer': 1, 'ex_singer': 1, 'group_singer': 0})
    rows = data.get('singer_list')
    if not isinstance(rows, list):
        raise RuntimeError('QQ 音乐歌手资料响应不完整')
    if not rows:
        raise FileNotFoundError('QQ 音乐歌手不存在')
    row = next((row for row in rows if isinstance(row, dict) and isinstance(row.get('basic_info'), dict)
                and row['basic_info'].get('singer_mid') == mid), None)
    if row is None:
        raise RuntimeError('QQ 音乐返回的歌手编号不匹配')
    basic = row['basic_info']
    if not basic.get('name') or not basic.get('singer_id'):
        raise RuntimeError('QQ 音乐歌手资料缺少名称或编号')
    extra = row.get('ex_info') if isinstance(row.get('ex_info'), dict) else {}
    description = extra.get('desc') or ''
    aliases = [extra['foreign_name']] if extra.get('foreign_name') else []
    wiki = row.get('wiki')
    if isinstance(wiki, str) and wiki:
        try:
            root = ET.fromstring(wiki)
            description = root.findtext('desc') or description
            for item in root.findall('./basic/item'):
                if item.findtext('key') in ('别名', '外文名', '英文名'):
                    aliases.extend(value.strip() for value in re.split(r'[、；;]', item.findtext('value') or '') if value.strip())
        except ET.ParseError:
            pass
    aliases = list(dict.fromkeys(value for value in aliases if isinstance(value, str) and value != basic['name']))
    return dict(id=str(basic['singer_id']), mid=mid, name=html.unescape(basic['name']),
                avatar=search_views.qqs_avatar_of(mid), description=description,
                alias=aliases, song_count=None)


def fetch_artist(artist_id, offset=0, limit=50):
    """按热度读取原生歌曲目录；数字歌手 ID 先由原生歌曲索引解析 mid。"""
    artist_id, numeric = _identifier(artist_id)
    if type(offset) is not int or type(limit) is not int or offset < 0 or not 1 <= limit <= 200:
        raise ValueError('歌手分页参数无效')
    if numeric:
        _, _, mid = _song_page(artist_id, True, 0, 1)
    else:
        mid = artist_id
    artist = _profile(mid)
    if numeric and artist['id'] != artist_id:
        raise FileNotFoundError('QQ 音乐歌手不存在')
    songs, total = [], None
    while len(songs) < limit:
        rows, page_total, _ = _song_page(mid, False, offset + len(songs), min(_PAGE_SIZE, limit - len(songs)))
        if total is not None and total != page_total:
            raise RuntimeError('QQ 音乐歌手歌曲目录已变化，请重新载入')
        total = page_total
        try:
            for raw in rows:
                track = raw.get('songInfo') if isinstance(raw.get('songInfo'), dict) else raw
                if not track.get('mid'):
                    raise ValueError
                row = search_views.qqs_song_row(track)
                row['album_id'] = str((track.get('album') or {}).get('id') or '')
                songs.append(row)
        except (TypeError, ValueError, AttributeError):
            raise RuntimeError('QQ 音乐歌手歌曲包含无效记录') from None
        if offset + len(songs) >= total:
            break
    artist['song_count'] = total
    return dict(code=200, artist=artist, songs=songs, total=total, offset=offset, limit=limit,
                has_more=offset + len(songs) < total, scope='hot')
