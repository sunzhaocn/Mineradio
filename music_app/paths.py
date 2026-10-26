"""整个应用的路径约定；所有模块从这里定位配置、资源和运行目录。"""
from pathlib import Path
import os

ROOT = Path(os.environ.get('MINERADIO_ROOT') or Path(__file__).resolve().parent.parent)
CONFIG_DIR = ROOT / "config"
RUNTIME_DIR = ROOT / "runtime"
CACHE_DIR = RUNTIME_DIR / "cache"
LOG_DIR = RUNTIME_DIR / "logs"
RESOURCE_ROOT = Path(os.environ.get('MINERADIO_RESOURCE_ROOT') or ROOT)
WEB_ROOT = RESOURCE_ROOT / "web"
EXPORT_DIR = ROOT / "汽水音乐解密结果"


def resolve_project_path(value):
    """配置里的相对路径始终相对于项目根目录，不随启动位置变化。"""
    path = Path(value).expanduser()
    return path if path.is_absolute() else ROOT / path


def ensure_directories():
    """只在启动时建立可写目录，导入模块本身不产生缓存。"""
    for directory in (CONFIG_DIR, CACHE_DIR, LOG_DIR):
        directory.mkdir(parents=True, exist_ok=True)
