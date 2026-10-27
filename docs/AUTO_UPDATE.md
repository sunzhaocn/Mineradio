# Windows 一键更新

原项目：[XxHuberrr/Mineradio-paused](https://github.com/XxHuberrr/Mineradio-paused)。更新源：[sunzhaocn/Mineradio Releases](https://github.com/sunzhaocn/Mineradio/releases)。

Windows 2.3.11 起，启动时自动检查正式发行版，右上角按钮可再次检查。点击“立即更新”后开始下载，显示进度和大小；可以收起面板继续使用。安装包通过 SHA-512 校验后，软件自动退出，完成后端与桌面宿主清理，再静默覆盖安装。保留账号、歌单和设置，安装结束不会自动重新启动。下载或校验失败时保留运行状态，可重试。

更早版本需要先手动安装一次新版。更新无需用户配置 GitHub 凭据，下载源由主进程固定。

## 发布后续版本

1. 更新 `Windows_exe/package.json` 及锁文件中的版本号。
2. 按客户端构建说明生成安装包。后端或共享界面变化时须重建后端资源。
3. 创建对应版本的正式 GitHub Release，上传同一构建生成的安装包、`.exe.blockmap`、`.exe.sha256` 和 `latest.yml`。
4. 同时公开安装包和清单，不要手改清单中的 SHA-512 或文件大小。草稿与预发行版不作为稳定更新推送。

`v2.3.12` 同时发布 Windows `2.3.12` 与 Android `1.1.10`。Windows 的 `latest.yml` 继续只描述同次构建生成的 Windows 安装包；Android 使用独立的 `versionName` / `versionCode`，不写入此清单。先把全部文件上传到草稿并验证文件大小与摘要，再统一公开，避免客户端读到尚未上传完成的更新。Android APK 及其 SHA-256 校验文件与 Windows 安装包放在同一发布页。
