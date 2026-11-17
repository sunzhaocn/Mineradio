# Windows 与 Android 软件更新

原项目：[XxHuberrr/Mineradio-paused](https://github.com/XxHuberrr/Mineradio-paused)。更新源：[sunzhaocn/Mineradio Releases](https://github.com/sunzhaocn/Mineradio/releases)。

Windows Rust 版启动时检查 GitHub 正式版本，有新版时才显示右上角更新按钮。点击“立即更新”开始下载，可收起面板继续使用。安装包通过 GitHub 提供的 SHA-256 校验后，应用退出，安装程序沿用原安装目录，保留账号、歌单和设置。从 2.3.25 的安装包开始，应用内更新会自动覆盖并重新打开 Mineradio。较早的安装包会打开安装向导，确认原路径即可覆盖。

Electron 2.3.11 至 2.3.18 使用 `latest.yml` 中的 SHA-512 校验，可沿同一入口迁移至 Rust。右上角没有更新入口的旧安装可以从 Release 手动下载安装包覆盖。客户端检查和下载均使用公开发布地址。

## 发布后续版本

1. 更新 `Windows_rust/Cargo.toml` 及 `Windows_rust/Cargo.lock` 中的版本号。
2. 按 [Windows Rust 构建说明](../Windows_rust/README.md) 生成 `Mineradio-版本-Rust-Setup-x64.exe` 和 `latest.yml`。
3. 创建指向该源码提交的 `v版本` GitHub Release 草稿，将安装包和同次构建生成的清单上传。会作为最新发行版发布时，同时放入当前正式 Android APK 及其校验文件，供已安装的 Android 客户端继续检查。
4. 校验 GitHub 资源的大小和 SHA-256，确认 `latest.yml` 与同一个 Windows 文件匹配，再将草稿公开为正式版。

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
