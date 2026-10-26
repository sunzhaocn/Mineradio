"""仅按本地清单展开播放器 HTML 组件，不从请求参数选择文件。"""
import json
from pathlib import Path
import re

TOKEN = re.compile(r"<!-- component:([a-z0-9_/\-]+) -->")


def render_page(player_root):
    root = Path(player_root).resolve()
    components_root = (root / "components").resolve()
    manifest = json.loads((components_root / "manifest.json").read_text(encoding="utf-8"))
    components = manifest["components"]
    if manifest.get("entry") != "index.html" or not isinstance(components, dict):
        raise ValueError("页面组件清单格式不正确")

    def include(name, stack):
        if name not in components or name in stack or len(stack) >= 8:
            raise ValueError("页面组件不存在、循环引用或层级过深")
        relative = Path(components[name])
        if relative.is_absolute() or ".." in relative.parts:
            raise ValueError("页面组件路径无效")
        path = (root / relative).resolve()
        if not path.is_relative_to(components_root) or not path.is_file():
            raise ValueError("页面组件路径无效")
        text = path.read_text(encoding="utf-8")
        return expand(text, (*stack, name))

    def expand(text, stack):
        return TOKEN.sub(lambda match: include(match[1], stack), text)

    return expand((root / "index.html").read_text(encoding="utf-8"), ()).encode("utf-8")
