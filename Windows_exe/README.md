# Mineradio Windows Electron 历史源码

此目录保留 Electron 2.3.18 及 Rust 包装所用的图标、工具准备脚本和汽水 SDK。Windows 正式构建说明见 [Windows Rust](../Windows_rust/README.md)。

歌曲下载菜单新增“导出视频 · 当前预设”，使用所选歌曲生成 MP4，支持 720p/1080p、30/60 帧，以及进度、收起和取消。本机音乐库可分别导出原音频、LRC 和带背景/字体/幻灯片素材的预设配置，或保存、加载、导入此曲预设。详见 [导出说明与验证范围](../docs/VISUAL_EXPORTS.md)。

安装包内置 Electron、Python 后端、Node.js、FFmpeg 和登录浏览器兜底。安装后从桌面或开始菜单启动；关闭窗口默认进入托盘，托盘菜单可退出。账号、歌单和设置保存在 `%APPDATA%/Mineradio`，安装升级沿用原目录和用户数据。

客户端自动检查更新，发现新版本时在右上角显示更新按钮。下载校验后自动退出并覆盖安装。[自动更新说明](../docs/AUTO_UPDATE.md)

账号面板默认使用服务器下发的 Cookie，各平台请求由本机客户端发出。[账号登录与服务器设置](../docs/LOGIN.md)

旧版更新入口缺失时，直接覆盖安装本版，不必卸载或清空数据。页面直接从内置服务加载，启动时自动注销旧页面 Worker，并清理它的资源副本；不再显示离线初始化提示。账号、歌单、本地曲库及媒体缓存保留。验证范围见 [内置界面缓存清理](../docs/EMBEDDED_UI_CACHE_REMOVAL.md)，此前覆盖安装与自动更新记录见 [升级验收](../docs/WINDOWS_UPGRADE_VERIFICATION.md)。

## 构建

构建机需 Python、Node.js 和 FFmpeg。业务代码复用上层 `music_app/`，界面复用 `web/`；不要删除共享资源。汽水 SDK 位于 `sdk/`，保持清单与文件一致。

```powershell
cd Windows_exe
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build.ps1
```

已有依赖时可加 `-SkipDependencyInstall`。只有后端与共享资源均未改变时才可加 `-SkipBackend`；`-DirectoryOnly` 只生成解包目录。安装包输出到 `dist/Mineradio-版本-Setup-x64.exe`。

`scripts/` 仅保留构建与资源准备工具。`desktop/` 提供窗口、托盘、本机曲库、桌面歌词及更新；`backend_entry.py` 提供内嵌服务资源路径和生命周期。
