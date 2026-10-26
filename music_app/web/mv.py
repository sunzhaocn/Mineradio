"""Resolve official MV links; cache by request credentials and never guess a URL."""
import re
import threading
import time
import urllib.parse
import uuid
from music_app.core import request_credentials
from .media import allowed_media

_CACHE, _LOCK = {}, threading.Lock()


def _url(value):
    if not isinstance(value, str) or not allowed_media(value): return ''
    return 'https://' + value[7:] if value.startswith('http://') else value


def _netease(key, resolution=720):
    from music_app.providers.netease import metadata, transport
    songs = metadata.ne_song_detail(key).get('songs') or []
    vid = songs[0].get('mv') if songs else None
    if not vid: return ''
    result = transport.ne_weapi_post('/weapi/song/enhance/play/mv/url', {'id':str(vid), 'r':resolution})
    return _url((result.get('data') or {}).get('url'))


def _qq(key, resolution=720):
    from music_app.providers.qqmusic import metadata, transport
    info = metadata.qq_song_detail(song_id=key) if key.isdigit() else metadata.qq_song_detail(mid=key)
    vid = (info.get('mv') or {}).get('vid')
    if not vid: return ''
    data = transport.qq_musicu({'comm':{'ct':24,'cv':4747474}, 'mv':{'module':'music.stream.MvUrlProxy',
        'method':'GetMvUrls','param':{'vids':[vid], 'request_type':10003, 'guid':uuid.uuid4().hex,
        'videoformat':1,'format':264,'dolby':0,'use_new_domain':1,'use_ipv6':0}}})
    native = ((data.get('mv') or {}).get('data') or {}).get(vid) or {}
    # QQ filetype 30 is the 720p tier. Do not automatically choose a 1080p/4K
    # stream for a background MV, especially on tablet WebViews.
    preferred = {30: 0, 20: 1, 10: 2} if resolution >= 720 else {20: 0, 10: 1, 30: 2}
    rows = sorted(native.get('mp4') or [], key=lambda row: preferred.get(row.get('filetype'), 3))
    for row in rows:
        for url in (row.get('freeflow_url') or []) + (row.get('url') or []):
            if _url(url): return _url(url)
    return ''


def _kugou(key, resolution=720):
    from music_app.providers.kugou import transport, metadata
    if re.fullmatch(r'[a-fA-F0-9]{32}',key):
        data = transport.kg_http_json('https://mobiles.kugou.com/api/v3/song/info?' + urllib.parse.urlencode({'hash':key})).get('data') or {}
    else:
        data = metadata.kg_songinfo(key).get('data') or {}
    vid = data.get('mvhash') or data.get('mv_hash') or ''
    if not re.fullmatch(r'[a-fA-F0-9]{32}',str(vid)): return ''
    result = transport.kg_http_json('https://m.kugou.com/app/i/mv.php?' + urllib.parse.urlencode(
        {'cmd':100,'hash':vid,'ismp3':0,'ext':'mp4'}))
    native = result.get('mvdata') or (result.get('data') or {}).get('mvdata') or {}
    for quality in (('hd','hq','le','sq','rq') if resolution >= 720 else ('hq','le','hd','sq','rq')):
        row = native.get(quality) or {}
        if _url(row.get('downurl')): return _url(row['downurl'])
    return ''


def _normalized(value):
    return re.sub(r'[^\w\u4e00-\u9fff]', '', str(value).lower())


def resolve(query):
    provider, key = query.get('provider'), str(query.get('id') or '')
    if provider not in ('netease','qq','kugou','qishui') or not re.fullmatch(r'[A-Za-z0-9_-]{1,128}',key):
        raise ValueError('无效的 MV 歌曲参数')
    title, artist = str(query.get('title') or '')[:200], str(query.get('artist') or '')[:200]
    resolution = 480 if str(query.get('resolution')) == '480' else 720
    scope = request_credentials.fingerprint()
    cache_key = (provider,key,title,artist,scope,resolution)
    with _LOCK:
        cached = _CACHE.get(cache_key)
        if cached and cached[0] > time.monotonic(): return dict(cached[1])
    readers = {'netease':_netease,'qq':_qq,'kugou':_kugou}
    url, actual = '', provider
    if provider in readers:
        try: url = readers[provider](key, resolution)
        except (OSError,ValueError,RuntimeError,KeyError,TypeError): pass
    # Some catalogs (including Soda's audio-only catalog) do not link an MV.
    # Only exact title AND artist matches may supply the corresponding MV.
    if not url and title and artist:
        from .client import upstream
        for candidate_provider in ('netease','qq'):
            if candidate_provider == provider: continue
            try:
                data = upstream('/search',platform='qqmusic' if candidate_provider=='qq' else candidate_provider,
                    keyword=title+' '+artist,size=3,page=1,simple=1,request_timeout=25)
                for song in data.get('songs') or []:
                    name, author = song.get('title') or song.get('name'), song.get('author') or song.get('artist') or song.get('singer')
                    if _normalized(name)!=_normalized(title) or _normalized(author)!=_normalized(artist): continue
                    candidate_id = str(song.get('mid') or song.get('id') or song.get('hash') or '')
                    if not candidate_id: continue
                    url = readers[candidate_provider](candidate_id, resolution)
                    if url: actual=candidate_provider;break
            except (OSError,ValueError,RuntimeError,KeyError,TypeError): pass
            if url: break
    url = _url(url)
    result={'available':bool(url),'url':url,'provider':actual,'songProvider':provider,'fallbackPreset':'emily'}
    with _LOCK:
        if len(_CACHE)>256: _CACHE.clear()
        _CACHE[cache_key]=(time.monotonic()+(300 if url else 60),result)
    return result
