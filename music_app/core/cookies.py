"""登录配置读取和平台 Cookie 文本解析。"""

import os
from music_app.paths import CONFIG_DIR, resolve_project_path

UNIFIED_COOKIE_FILES = ("cookies.txt", "cookie.txt")


_PLATFORM_ALIASES = {
    "网易云音乐": "netease",
    "网易云": "netease",
    "netease": "netease",
    "163": "netease",
    "qq音乐": "qq",
    "qq": "qq",
    "qqmusic": "qq",
    "酷狗音乐": "kugou",
    "酷狗": "kugou",
    "kugou": "kugou",
    "酷狗概念版": "kugou",
    "spotify": "spotify",
    "openai(chatgpt)": "openai",
    "openai": "openai",
    "chatgpt": "openai",
}


def _norm_platform(name):
    """规范化 cookies.txt 中的平台标题；例如 QQ音乐/qqmusic 转为内部键 qq。
    注意：Cookie 模块使用 qq，HTTP 路由使用 qqmusic；两者不可直接混用。"""
    n = (name or "").strip().strip("#[]【】<> \t").lower()
    if n in _PLATFORM_ALIASES:
        return _PLATFORM_ALIASES[n]
    return _PLATFORM_ALIASES.get(n.replace("音乐", "").replace(" ", ""), n)


def _is_platform_line(s):
    """判断一行是否像平台标题：长度不超过 32，且不含 Cookie 常见的 =、;、{。
    这里只是格式识别，不是允许访问的平台列表。"""
    return bool(s) and len(s) <= 32 and ("=" not in s) and (";" not in s) and ("{" not in s)


def parse_unified_cookies(text):
    """解析“平台标题 + 下一条非空 Cookie 行”，返回按平台索引的字典。

        例如“QQ音乐
    uin=...; qqmusic_key=...”对应键 qq。
        platform 保留原始标题；cookie 是整行 Cookie；line 是从 1 开始的 Cookie 行号。
        空行和 # 注释行会跳过；重复平台保留第一条；不依赖固定行号。
        这里只解析文本，不判断登录态是否有效，也不向平台发送请求。
    """
    records = {}
    pending_platform = None
    for line_number, raw_line in enumerate((text or "").splitlines(), 1):
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if _is_platform_line(line):
            pending_platform = (_norm_platform(line), line)
        elif pending_platform:
            platform_id, platform_label = pending_platform
            records.setdefault(
                platform_id, {"platform": platform_label, "cookie": line, "line": line_number}
            )
            pending_platform = None
    return records


def unified_cookie_paths():
    """按优先级列出统一 Cookie 文件候选路径，并去掉重复路径。
    顺序：MUSIC_COOKIES 指定路径 → config 目录 → 兼容当前目录和桌面。
    此函数只列路径，不读取内容。"""
    here = str(CONFIG_DIR)
    cands = []
    env = os.environ.get("MUSIC_COOKIES", "").strip()
    if env:
        cands.append(str(resolve_project_path(env)))
    cands.extend(str(CONFIG_DIR / name) for name in UNIFIED_COOKIE_FILES)
    for n in UNIFIED_COOKIE_FILES:
        cands += [
            os.path.join(os.getcwd(), n),
            os.path.join(here, n),
            os.path.expanduser(os.path.join("~", "Desktop", n)),
        ]
    seen, out = (set(), [])
    for p in cands:
        if p not in seen:
            seen.add(p)
            out.append(p)
    return out


def unified_cookie(platform=None, path=""):
    """兼容旧调用，仅返回当前请求的平台 Cookie；path 不再触发文件读取。"""
    from music_app.core.request_credentials import cookie
    return cookie(_norm_platform(platform or ""))
