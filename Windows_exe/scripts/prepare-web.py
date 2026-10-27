"""Stage the embedded Windows UI without obsolete offline shell assets."""
from pathlib import Path
import shutil
import tempfile

PROJECT = Path(__file__).resolve().parents[1]
BUILD = PROJECT / 'build'


def prepare(source):
    source = Path(source).resolve(strict=True)
    BUILD.mkdir(parents=True, exist_ok=True)
    target = BUILD / 'web-release'
    marker = BUILD / '.web-release-managed'
    if target.is_symlink() or not target.resolve().is_relative_to(BUILD.resolve()):
        raise ValueError('Web staging escaped its generated build directory')
    if target.exists() and not marker.is_file():
        raise ValueError('Refusing to replace an unmanaged web staging directory')
    if source == target.resolve() or source.is_relative_to(target.resolve()):
        raise ValueError('Web source cannot be inside its generated destination')
    with tempfile.TemporaryDirectory(prefix='web-release-', dir=BUILD) as directory:
        staged = Path(directory) / 'web'
        shutil.copytree(source, staged, ignore=shutil.ignore_patterns('__pycache__', '*.pyc'))
        for name in ('service-worker.js', 'offline-assets.js', 'js/features/shell/offline-shell.js'):
            (staged / 'player' / name).unlink(missing_ok=True)
        if target.exists():
            shutil.rmtree(target)
        staged.replace(target)
    marker.write_text('Mineradio generated web release\n', encoding='utf-8')
    return target
