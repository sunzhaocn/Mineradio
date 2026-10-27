"""保留原生音质标识，明确可用性与下载权限。"""
from pathlib import Path
import urllib.parse
from music_app.core import request_credentials

from . import client as _web_client
from . import state as _web_state
from . import songs as _web_songs


QUALITY_ORDER = {
    'netease': ('jymaster', 'hires', 'lossless', 'exhigh', 'higher', 'standard'),
    'qq': ('jymaster', 'hires', 'flac', '320', '128', 'aac'),
    'kugou': ('jymaster', 'hires', 'sq', '320', 'high', '128'),
    'qishui': ('hi_res', 'lossless', 'spatial', 'highest', 'higher', 'medium'),
}


def normalize_quality(provider, value):
    value = str(value or 'auto').lower()
    aliases = {
        'netease': {'128': 'standard', '192': 'higher', '320': 'exhigh', 'flac': 'lossless', 'sq': 'lossless'},
        'qq': {'standard': '128', 'exhigh': '320', 'lossless': 'flac', 'sq': 'flac'},
        'kugou': {'standard': '128', 'exhigh': '320', 'lossless': 'sq', 'flac': 'sq'},
        'qishui': {'standard': 'medium', '128': 'higher', '320': 'highest', 'flac': 'lossless', 'sq': 'lossless'},
    }
    return aliases.get(provider, {}).get(value, value)


def quality_rows(data, provider, key):
    """保留上游所有档位（包括不可用的档位），只返回网页需要的字段。

    编码优先用接口字段，其次读取媒体 URL 后缀；不按音质名称假定 FLAC。
    URL 仍只用于已登记的同源音频转发，Cookie 和媒体加密参数不会进入页面。
    """
    with _web_state.LOCK:
        scope = request_credentials.fingerprint(provider)
        label_key = (provider, key, scope) if scope else (provider, key)
        labels = _web_state.SONG_LABELS.get(label_key, {})
    rows = []
    for item in data.get('qualities') or []:
        url = item.get('url') or ''
        encrypted = bool(item.get('encrypted'))
        decryption_supported = bool(item.get('decryption_supported'))
        local_audio = _web_client.local_qishui_audio_url(url) if provider == 'qishui' and url.startswith('/qishui/audio?') else ''
        if local_audio:
            url = local_audio
        if encrypted and not (decryption_supported and local_audio):
            url = ''
        encode = item.get('encode') or ''
        if not encode and url:
            suffix = Path(urllib.parse.urlsplit(url).path).suffix.lower().lstrip('.')
            encode = suffix if suffix in ('mp3', 'flac', 'm4a', 'aac', 'ogg', 'wav') else ''
        bitrate = item.get('bitrate')
        duration = _web_songs.qishui_playback_duration(data, item) if provider == 'qishui' else data.get('duration_s')
        if not bitrate and item.get('filesize') and duration:
            bitrate = round(item['filesize'] * 8 / float(duration) / 1000)
        quality_key = str(item.get('key') or '')
        vip_required = bool(item.get('vip_required') or labels.get('vipRequired') or quality_key in labels.get('qualityVipKeys', []))
        if (provider == 'qishui' and item.get('publicPlayback', data.get('publicPlayback')) and
                item.get('sourceScope', data.get('sourceScope')) == 'public_catalog' and
                item.get('access') in ('preview', 'full_public')):
            # Original-song rights do not turn an official public excerpt into a VIP stream.
            vip_required = bool(item.get('vip_required'))
        row = dict(key=quality_key, quality=item.get('quality') or quality_key,
                         available=bool(item.get('available') and url),
                         downloadable=bool(item.get('available') and url and (not encrypted or decryption_supported and local_audio)),
                         download_reason='protected_media' if encrypted and not local_audio else '' if item.get('available') and url else 'quality_unavailable',
                         source_available=item.get('source_available', bool(url)),
                         encrypted=encrypted, decryption_supported=decryption_supported, encode=encode, bitrate=bitrate,
                         filesize=item.get('filesize') or 0, sample_rate=item.get('sample_rate') or '',
                         vip_required=vip_required,
                         kind=item.get('kind') or '', url=url)
        if provider == 'qishui':
            row.update(_web_songs.qishui_playback_fields(data, item))
        rows.append(row)
    return rows

def select_quality(provider, value, options, *, allow_fallback=False):
    """精确选择保持原语义；播放偏好可显式允许向下寻找当前歌曲的可用档位。"""
    value = normalize_quality(provider, value)
    if value in ('auto', 'best', ''):
        if provider == 'qishui':
            for key in ('lossless', 'hi_res', 'spatial', 'highest', 'higher', 'medium'):
                selected = next((q for q in options if q['key'] == key and q['available']), None)
                if selected:
                    return selected
        return next((q for q in options if q['available']), None)
    exact = next((q for q in options if q['key'] == value), None)
    if not allow_fallback or exact and exact['available']:
        return exact
    ladder = QUALITY_ORDER.get(provider, ())
    if value not in ladder:
        return exact
    # options 可能缺失整档或顺序不同；从请求档位以下逐档选，不能因低档缺失升级。
    for key in ladder[ladder.index(value) + 1:]:
        selected = next((q for q in options if q['key'] == key and q['available']), None)
        if selected:
            return selected
    return exact
