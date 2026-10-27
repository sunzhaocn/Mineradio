# Mineradio Windows

当前版本：**2.3.11**。[下载安装包](https://github.com/sunzhaocn/Mineradio/releases/latest)。

安装包内置 Electron、Python 后端、Node.js、FFmpeg 和登录浏览器兜底。安装后从桌面或开始菜单启动；关闭窗口默认进入托盘，托盘菜单可退出。账号、歌单和设置保存在 `%APPDATA%/Mineradio`，安装升级沿用原目录和用户数据。

右上角更新按钮支持检查、下载进度、校验完成后自动退出及静默覆盖安装，详见 [自动更新说明](../docs/AUTO_UPDATE.md)。

## 构建

构建机需 Python、Node.js 和 FFmpeg。业务代码复用上层 `music_app/`，界面复用 `web/`；不要删除共享资源。汽水 SDK 位于 `sdk/`，保持清单与文件一致。

```powershell
cd Windows_exe
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build.ps1
```

已有依赖时可加 `-SkipDependencyInstall`。只有后端与共享资源均未改变时才可加 `-SkipBackend`；`-DirectoryOnly` 只生成解包目录。安装包输出到 `dist/Mineradio-版本-Setup-x64.exe`。

`scripts/` 仅保留构建与资源准备工具。`desktop/` 提供窗口、托盘、本机曲库、桌面歌词及更新；`backend_entry.py` 提供内嵌服务资源路径和生命周期。

在 `Windows_exe/` 下执行 `npm test` 可检查更新失败后的重试、重复请求合并、更新调用权限和后端退出时的日志收尾。检查使用模拟更新器和子进程，不会下载或安装更新。
