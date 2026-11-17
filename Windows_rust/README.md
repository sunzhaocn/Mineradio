# Mineradio Rust Windows 版

Rust 负责 Windows 窗口、本机资料和平台请求。界面使用原有的 `web/player`，由 Windows 的 WebView2 显示。

## 构建和启动

Windows 正式版本在此目录构建。准备 Windows Rust MSVC 工具链、NSIS、Python，并把 `node.exe` 和 `ffmpeg.exe` 加入 PATH。从仓库根目录运行以下命令。

```powershell
python -B -X utf8 Windows_exe/scripts/prepare-tools.py
cargo test --locked --manifest-path Windows_rust/Cargo.toml
.\Windows_rust\build-installer.ps1
```

安装包、Rust 更新清单 `mineradio-windows-update.json` 和旧 Windows 版升级使用的 `latest.yml` 生成在 `Windows_rust/dist`。正式安装包沿用原安装位置、`%APPDATA%\Mineradio` 和旧版记录的端口。附加 `-Isolated` 可构建预览包，默认安装在 `%LOCALAPPDATA%\Programs\Mineradio-Rust-Preview`，使用独立的资料目录及端口。调试时可用 `--profile <路径>` 指定资料目录，用 `--headless --port 0` 启动测试用本地服务。

首次打开包含旧版资料的目录时，Rust 版将 Chromium 的 Local Storage 和 IndexedDB 复制到 WebView2 的配置目录。迁移时须先退出正在使用该目录的旧版。旧曲库、歌单和视觉配置继续沿用原有文件格式。

## 已接入的功能

- 原界面、托盘、全屏、全局热键和桌面歌词。
- 本机曲库和歌单、歌词缓存、视觉预设、幻灯片、导出视频与 Wallpaper Engine 项目库。
- 四个平台的搜索、歌词、播放、歌单、评论、榜单、歌手和专辑。汽水加密音频由本机解封装，签名调用原汽水 SDK。打包程序将 SDK、Node 和 FFmpeg 放入 `resources`。
- 网易云手机号、QQ 和微信扫码、QQ 音乐 App 扫码、酷狗扫码、汽水扫码入口与本机 Cookie 登录。
- Wallpaper Engine 控制条使用所选壁纸的实时画面。播放器或控制条收起时暂停取帧。
- Windows 系统内存释放支持手动操作、管理员权限和后台定时。手动操作时播放器会先最小化。
- 服务器账号沿用原地址和设备钥匙，拉取 Cookie 后由本机访问各平台。发布的更新包须包含 SHA-256 摘要，并命名为 `Mineradio-版本-Rust-Setup-x64.exe`。

汽水扫码通过独立的本机 Chrome 或 Edge 会话使用原版安全组件。平台要求额外身份验证时会打开验证窗口。也可以使用本机 Cookie 登录。
