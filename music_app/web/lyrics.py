"""网页歌词专用读取，不获取播放地址或探测音质。"""
import re

from music_app.core import request_credentials
from music_app.providers.qqmusic import lyrics as qq_lyrics
from music_app.providers.kugou import lyrics as kg_lyrics, metadata as kg_metadata
from . import client as _web_client


def kugou_lyric(identifier, duration=0):
    kind, key = kg_metadata.kg_parse_target(str(identifier or ''))
    if not kind:
        raise ValueError('酷狗歌曲标识无效')
    try:
        seconds = max(0, min(86400, int(float(duration or 0))))
    except (ValueError, TypeError, OverflowError):
        seconds = 0
    if kind == 'eid':
        # 旧队列可能只存 encode ID；只补歌词需要的 hash/时长，不探测音质。
        data = kg_metadata.kg_songinfo(key).get('data') or {}
        key = str(data.get('hash') or '')
        seconds = seconds or int(float(data.get('timelength') or 0) / 1000)
    if not re.fullmatch(r'[A-Fa-f0-9]{32}', key):
        raise ValueError('酷狗歌曲标识无效')
    data = kg_lyrics.kg_get_lyric(key, seconds)
    klyric = kg_lyrics.kg_krc_decode(data.get('krc') or b'')
    return dict(ok=True, lyric=data.get('lrc') or '', tlyric=data.get('tlyric') or '',
                romalrc=data.get('roma') or '', klyric=klyric, provider='kugou', source='酷狗音乐',
                nolyric=not bool(data.get('lrc') or klyric), uncollected=False)


def qishui_lyric(identifier):
    key = str(identifier or '')
    if not re.fullmatch(r'[1-9]\d{0,24}', key):
        raise ValueError('汽水歌曲标识无效')
    # 原生 track 一次响应已含歌词；不等待 web 完整详情的 future。
    data = _web_client.upstream('/lyric', platform='qishui', id=key)
    return dict(ok=True, lyric=data.get('lrc') or '', tlyric=data.get('tlyric') or '',
                romalrc=data.get('roma') or '', klyric=data.get('klyric') or '',
                provider='qishui', source='汽水音乐', nolyric=bool(data.get('nolyric')),
                uncollected=bool(data.get('uncollected')))


def qq_lyric(identifier):
    key = str(identifier or '')
    cookie = request_credentials.cookie('qqmusic')
    if re.fullmatch(r'[1-9]\d{0,19}', key):
        # Old queues sometimes retain songID alone. Resolve only native song
        # metadata; full song detail would start unrelated audio probes.
        try:
            result = qq_lyrics.lyric_read_rpc({'songinfo': {
                'module': 'music.pf_song_detail_svr', 'method': 'get_song_detail',
                'param': {'song_id': int(key)}}}, cookie)
            node = result.get('songinfo') if isinstance(result, dict) else None
            data = node.get('data') if isinstance(node, dict) and node.get('code') == 0 else None
            track = data.get('track_info') if isinstance(data, dict) else None
            if not isinstance(track, dict) or str(track.get('id') or '') != key:
                raise ValueError()
            key = str(track.get('mid') or track.get('songmid') or '')
        except (OSError, ValueError, TypeError, AttributeError, TimeoutError):
            raise ValueError('QQ音乐歌曲资料获取失败，请稍后重试') from None
    if not re.fullmatch(r'[A-Za-z0-9]{10,14}', key):
        raise ValueError('QQ音乐歌曲标识无效')
    data = qq_lyrics.qq_get_lyric(key, cookie, strict=True)
    return dict(ok=True, lyric=data.get('lrc') or '', tlyric=data.get('tlyric') or '',
                romalrc=data.get('roma') or '', klyric=data.get('qrc') or '',
                provider='qq', source='QQ 音乐', nolyric=bool(data.get('nolyric')),
                uncollected=bool(data.get('uncollected')))
