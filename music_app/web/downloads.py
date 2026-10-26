"""Download native qualities and account-authorized local playback files."""
import json
from pathlib import Path
import re
import urllib.parse

from music_app.paths import ROOT, CONFIG_DIR, CACHE_DIR
from . import constants as _web_constants
from . import songs as _web_songs
from . import client as _web_client
from . import qualities as _web_qualities


def download_filename(data, provider, selected):
    """只用歌曲资料生成附件名，不把签名 URL、路径或控制字符写进响应头。"""
    platform = {'netease': '网易云音乐', 'qq': 'QQ音乐', 'kugou': '酷狗音乐', 'qishui': '汽水音乐'}[provider]
    quality_name = selected.get('quality') or selected['key']
    if quality_name != selected['key']:
        quality_name = str(quality_name) + '(' + selected['key'] + ')'
    pieces = [data.get('title') or '未命名歌曲', data.get('author') or data.get('artist') or '',
              platform, quality_name]
    name = ' - '.join(str(piece) for piece in pieces if piece)
    name = re.sub(r'[\x00-\x1f\x7f-\x9f<>:"/\\|?*]', '_', name)
    name = re.sub(r'\s+', ' ', name).strip(' .')[:180].rstrip(' .') or 'music'
    encode = str(selected.get('encode') or '').lower().lstrip('.')
    if selected.get('path'):
        # 现成文件的容器后缀优先于编码：AAC 成品可能装在 M4A 中，不能改成 .aac。
        encode = Path(selected['path']).suffix.lower().lstrip('.')
    encode = {'mpeg': 'mp3', 'mp4a': 'm4a', 'mp4': 'm4a', 'wave': 'wav'}.get(encode, encode)
    if encode not in ('mp3', 'flac', 'm4a', 'aac', 'ogg', 'wav', 'opus'):
        suffix = Path(urllib.parse.urlsplit(selected.get('url') or '').path).suffix.lower().lstrip('.')
        encode = suffix if suffix in ('mp3', 'flac', 'm4a', 'aac', 'ogg', 'wav', 'opus') else 'audio'
    return name + '.' + encode

def existing_download_files(key):
    """只读明确登记的现成音频；不导入、调用或启动平台媒体处理代码。

    清单只允许项目目录内两个固定成品目录中的 FLAC/M4A。resolve 同时检查
    ``..``、绝对路径和符号链接逃逸；缺文件直接跳过，不尝试补齐或重新生成。
    """
    project = ROOT.resolve()
    allowed_roots = [(project / '汽水音乐解密结果').resolve(),
                     (CACHE_DIR / 'qishui' / 'audio').resolve()]
    allowed_roots = [root for root in allowed_roots if root.is_relative_to(project)]
    try:
        manifest = json.loads((CONFIG_DIR / 'local-downloads.json').read_text(encoding='utf-8-sig'))
    except (OSError, ValueError):
        return []
    entries = manifest.get('files') if isinstance(manifest, dict) else []
    if not isinstance(entries, list):
        return []
    rows = []
    seen = set()
    for entry in entries:
        if not isinstance(entry, dict) or entry.get('provider') != 'qishui' or str(entry.get('id')) != key:
            continue
        quality = entry.get('quality')
        if quality not in ('medium', 'higher', 'highest', 'lossless', 'spatial', 'hi_res') or quality in seen:
            continue
        try:
            relative = Path(entry.get('path') or '')
            if relative.is_absolute() or '..' in relative.parts:
                continue
            path = (project / relative).resolve(strict=True)
            if (path.suffix.lower() not in ('.flac', '.m4a') or not path.is_file()
                    or not any(path.is_relative_to(root) for root in allowed_roots)):
                continue
            size = path.stat().st_size
            if size <= 0:
                continue
        except (OSError, ValueError, TypeError):
            continue
        seen.add(quality)
        rows.append(dict(key=quality, quality=entry.get('quality_name') or quality,
                         title=entry.get('title') or '未命名歌曲', author=entry.get('author') or '',
                         available=True, downloadable=True, download_reason='', source_available=True,
                         encrypted=False, existingFile=True, encode=entry.get('encode') or path.suffix[1:],
                         bitrate=entry.get('bitrate') or 0, filesize=size,
                         sample_rate=entry.get('sample_rate') or '', duration=entry.get('duration') or 0,
                         kind='已生成文件', vip_required=False, path=path))
    order = {'hi_res': 0, 'lossless': 1, 'spatial': 2, 'highest': 3, 'higher': 4, 'medium': 5}
    return sorted(rows, key=lambda row: order[row['key']])

def download_qualities(query):
    """Prefer existing exports, otherwise expose the current account's playable files."""
    provider = query.get('provider', '')
    key = query.get('id', '')
    if provider not in _web_constants.PROVIDERS or not re.fullmatch(r'[A-Za-z0-9_-]{1,128}', key):
        return dict(provider=provider, title='', author='', qualities=[], message='请指定有效的平台和歌曲')
    if provider == 'qishui' and existing_download_files(key):
        options = existing_download_files(key)
        # 内部文件路径不能出现在浏览器可见的 JSON 中。
        return dict(provider=provider, title=options[0]['title'] if options else '', author=options[0]['author'] if options else '',
                    qualities=[{k: v for k, v in row.items() if k != 'path'} for row in options],
                    message='' if options else '这首歌还没有已生成的下载文件')
    data = _web_songs.detail(provider, key)
    return dict(provider=provider, title=data.get('title') or '', author=data.get('author') or '',
                qualities=[{k: v for k, v in row.items() if k != 'url'} for row in _web_qualities.quality_rows(data, provider, key)], message='')

def download_selection(query):
    """下载只接受平台、歌曲和原生音质，不接受客户端提供的媒体 URL。"""
    provider = query.get('provider', '')
    key = query.get('id', '')
    quality = query.get('quality') or 'auto'
    if (provider not in _web_constants.PROVIDERS or not re.fullmatch(r'[A-Za-z0-9_-]{1,128}', key)
            or len(quality) > 128 or 'url' in query):
        return None, dict(error='invalid_download_request', message='请指定有效的平台、歌曲和音质'), 400
    if provider == 'qishui' and existing_download_files(key):
        options = existing_download_files(key)
        selected = (options[0] if options else None) if quality in ('auto', 'best') else next(
            (item for item in options if item['key'] == quality), None)
        if not selected:
            return None, dict(error='existing_file_unavailable', message='所选音质还没有已生成的下载文件'), 409
        return dict(path=selected['path'], filename=download_filename(selected, provider, selected)), None, 200
    data = _web_songs.detail(provider, key)
    options = _web_qualities.quality_rows(data, provider, key)
    # 播放接口保留旧名称兼容；下载必须忠实于用户在该平台菜单中选择的原生档位。
    selected = (_web_qualities.select_quality(provider, 'auto', options) if quality in ('auto', 'best') else
                next((item for item in options if item['key'] == quality), None))
    if selected and selected['encrypted'] and not (provider == 'qishui' and selected['decryption_supported'] and _web_client.local_qishui_audio_url(selected['url'])):
        return None, dict(error='protected_media', message='当前音源受保护，暂不提供文件下载'), 409
    if not selected or not selected['downloadable']:
        return None, dict(error='quality_unavailable', message='当前平台没有所选音质或该音质暂不可下载'), 409
    if provider == 'qishui' and selected['encode'] in ('aac', 'mp4a'):
        selected = dict(selected, encode='m4a')
    return dict(url=selected['url'], filename=download_filename(data, provider, selected)), None, 200
