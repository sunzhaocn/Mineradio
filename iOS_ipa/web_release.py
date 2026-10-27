"""Give each embedded web release its own shell cache, preserving user stores."""
import hashlib
import json
from pathlib import Path

PREFIX = 'self.MINERADIO_OFFLINE = '
IOS_PATHS = ('/ios-layout.js', '/ios-bridge.js', '/ios.css')


def revision(player):
    player = Path(player)
    digest = hashlib.sha256()
    for path in sorted(player.rglob('*'), key=lambda p: p.relative_to(player).as_posix()):
        if path.is_file() and path.name != 'offline-assets.js':
            digest.update(path.relative_to(player).as_posix().encode('utf-8') + b'\0')
            digest.update(hashlib.sha256(path.read_bytes()).digest())
    return digest.hexdigest()[:20]


def refresh(player, paths=IOS_PATHS):
    player = Path(player)
    path = player / 'offline-assets.js'
    source = path.read_text(encoding='utf-8').strip()
    if not source.startswith(PREFIX) or not source.endswith(';'):
        raise ValueError('Unexpected offline manifest structure')
    data = json.loads(source[len(PREFIX):-1])
    if not isinstance(data.get('paths'), list):
        raise ValueError('Missing public offline paths')
    data['paths'] = list(dict.fromkeys(data['paths'] + list(paths)))
    data['revision'] = revision(player)
    path.write_text(PREFIX + json.dumps(data, ensure_ascii=False) + ';\n', encoding='utf-8', newline='\n')
    return data['revision']


def verify(player, paths=IOS_PATHS):
    player = Path(player)
    source = (player / 'offline-assets.js').read_text(encoding='utf-8').strip()
    data = json.loads(source[len(PREFIX):-1])
    if data.get('revision') != revision(player) or not set(paths).issubset(data['paths']):
        raise ValueError('The embedded offline cache does not match this release')
    return data['revision']
