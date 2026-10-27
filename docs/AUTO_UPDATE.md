# Windows 与 Android 软件更新

原项目：[XxHuberrr/Mineradio-paused](https://github.com/XxHuberrr/Mineradio-paused)。更新源：[sunzhaocn/Mineradio Releases](https://github.com/sunzhaocn/Mineradio/releases)。

Windows 2.3.11 起，启动时自动检查正式发行版，右上角按钮可再次检查。点击“立即更新”后开始下载，显示进度和大小；可以收起面板继续使用。安装包通过 SHA-512 校验后，软件自动退出，完成后端与桌面宿主清理，再静默覆盖安装。保留账号、歌单和设置，安装结束不会自动重新启动。下载或校验失败时保留运行状态，可重试。

更早版本需要先手动安装一次新版。更新无需用户配置 GitHub 凭据，下载源由主进程固定。

## 发布后续版本

1. 更新 `Windows_exe/package.json` 及锁文件中的版本号。
2. 按客户端构建说明生成安装包。后端或共享界面变化时须重建后端资源。
3. 创建对应版本的正式 GitHub Release，上传同一构建生成的安装包、`.exe.blockmap`、`.exe.sha256` 和 `latest.yml`。
4. 同时公开安装包和清单，不要手改清单中的 SHA-512 或文件大小。草稿与预发行版不作为稳定更新推送。

`v2.3.12` 同时发布 Windows `2.3.12` 与 Android `1.1.10`。Windows 的 `latest.yml` 继续只描述同次构建生成的 Windows 安装包；Android 使用独立的 `versionName` / `versionCode`，不写入此清单。先把全部文件上传到草稿并验证文件大小与摘要，再统一公开，避免客户端读到尚未上传完成的更新。Android APK 及其 SHA-256 校验文件与 Windows 安装包放在同一发布页。

## 2.3.13 缓存修复与实际升级验收

部分旧安装虽然已带上新版文件，Service Worker 仍使用固定版本的旧网页缓存，更新入口因而不能初始化。2.3.13 当时通过内容摘要刷新离线缓存来修复；2.3.14 已改为移除 Windows/Android 的这层页面缓存。

若更新入口已经缺失，先手动下载安装包覆盖一次；旧缓存会在启动时自动升级。后续仍使用软件内更新。已实测 `2.3.11 → 2.3.12` 的完整自动更新，以及保留旧缓存时 `2.3.12 → 2.3.13` 的手动覆盖安装，过程和边界见 [Windows 升级验收](WINDOWS_UPGRADE_VERIFICATION.md)。

## 2.3.14 内置页面直接加载

Windows 2.3.14 / Android 1.1.11 不再打包页面 Worker、离线初始化脚本和清单。客户端先经过独立启动入口，自动注销旧页面 Worker、删除对应的页面缓存，再加载内置页面；账号、歌单、本地音乐等数据保持。既有更新入口仍从同一 GitHub 正式发布源下载和校验安装包，更新机制不变。详细验证见 [内置界面缓存清理](EMBEDDED_UI_CACHE_REMOVAL.md)。

## Android 1.1.12 起的应用内更新

在“音乐库 → 检查更新”手动检查 GitHub 最新正式 Release，按 `Mineradio-<Android版本>-release-arm64.apk` 选择安装包，独立比较 Android 版本，忽略 Windows 的发布标签版本。点击更新后显示下载百分比、已下载与总大小，收起面板后可重新查看进度。

原生更新器只接受本项目的 HTTPS 发布下载地址及 GitHub 的资源重定向。APK 按块写入私有 `cache/updates/update.part`，验证大小与 GitHub 资源 SHA-256 后才转为 `update.apk`；随后检查应用 ID、版本名称、versionCode 及签名与当前安装一致，拒绝其他应用、降级、不同签名和不完整文件。下载/校验失败后可以重试；进程存活期间 Activity 重建会保留进度，进程被系统终止后需重新下载。

下载完成时应用在前台会打开系统安装界面，在后台完成则返回应用后继续。Android 8.0 以上需要声明 `REQUEST_INSTALL_PACKAGES`，并由用户允许此来源安装应用；尚未授权时先打开该应用的来源设置，授权返回后继续安装。用户取消授权或安装后，可再次点击“安装更新”。安装过程由系统确认，沿用原签名覆盖升级并保留应用数据。

提供给安装器的 URI 只读共享一个私有 APK，Provider 不对外导出，不申请外部存储权限。检查更新及下载不需要 GitHub 登录或凭据。发布时须让 APK 的 GitHub 资源包含有效 `sha256:` 摘要，与全部安装包及清单共同验证完毕后再公开 Release。

本版首先手动覆盖到 Android 1.1.12 后，后续版本才能使用这个入口。测试证据及真机范围见 [手机布局及安卓更新验收](MOBILE_LAYOUT_AND_ANDROID_UPDATES.md)。
