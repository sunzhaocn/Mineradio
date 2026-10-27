# Mineradio Android

当前版本：**1.1.11**（versionCode `10111`）。[下载安装包](https://github.com/sunzhaocn/Mineradio/releases/tag/v2.3.14) · [更新说明](../docs/releases/v2.3.14.md)。

同一个 APK 支持 Android 8.0 及以上的 ARM64 手机和平板，需要可用的 Android System WebView。小于 600dp 使用手机播放器，600dp 及以上使用桌面布局与视觉效果。APK 内置 Python 3.12、本地服务、播放器和汽水签名桥；使用时不需要 Windows 电脑或云端后端。

支持网易云、QQ、酷狗、汽水以及本地音频/歌词、播放队列、下载和系统媒体控制；平台结果受账号状态、会员权益和上游接口影响。手机使用轻量封面/歌词界面，平板保留 MV 与视觉效果。账号及主动下载的本地曲库保存在设备内，清除应用数据会删除它们。

## 完整汽水构建材料

构建必须提供完整 SDK 材料包，缺少材料时会明确失败。当前适配器只验证过汽水 `com.luna.music` **21.3.0 / 100213030** 的指定原始 APK。导入器检查整个 APK 的 SHA-256、ARM64 原生库、21 个 DEX 及反射调用所需类定义；不支持随意换用新版 APK。

从已授权 USB 调试的自有手机复制安装包（只读取程序包，不读取账号数据）：

```powershell
adb devices
adb shell pm path com.luna.music
# 将上一条输出中 package: 后的 base.apk 路径填入下面命令。
New-Item -ItemType Directory -Force runtime/android-sdk-extraction
adb pull "<手机上的 base.apk 路径>" runtime/android-sdk-extraction/base.apk
```

准备已有的 SDK 专用 JSON 配置，只允许 `appId`、`license`、`clientType`、`collectMode`、`channel` 五个字段；不得使用账号 Cookie、用户令牌或整份账号配置。配置和 APK 均由构建者自行提供。本次本机恢复使用手机原包和已存在的匹配 SDK 配置，未提取手机账号数据。

```powershell
python Android_apk/extract_sdk.py `
  --apk runtime/android-sdk-extraction/base.apk `
  --config Android_apk/.local/sdk-config.json `
  --output runtime/android-sdk-extraction/sdk-bundle-21.3.0
```

输出目录必须尚不存在。材料包包含 `sdk-manifest.json`、`provenance.json`、原生库与有序 DEX；保留原始文件内容和摘要。21 个 DEX 用于维持现有依赖完整性，尚未证明能够安全裁剪为更小集合。静态校验通过不等同真机登录、签名和播放验收通过。

`runtime/` 和 `.local/` 已排除版本控制。第三方 APK、DEX、原生库、许可配置和签名私钥不随公开源码提交；公开仓库提供提取、校验和构建脚本。

## 构建

需要 JDK 17、Android SDK Platform 36 / Build Tools 35.0.0、Python 3.12。仓库内的 Gradle Wrapper 固定为 8.14.3 并校验下载摘要，无需指定开发者的 Gradle 缓存目录。首次构建需要联网下载 Gradle、Android/Python 依赖及汽水登录页所需资源。

```powershell
./Android_apk/build.ps1 -Variant release `
  -SdkBundle ./runtime/android-sdk-extraction/sdk-bundle-21.3.0
```

工具不在默认位置时，可传入 `-JavaHome`、`-Python312`、`-AndroidSdk`、`-Workspace`；也可使用 `JAVA_HOME`、`MINERADIO_BUILD_PYTHON`、`ANDROID_HOME`、`MINERADIO_ANDROID_WORKSPACE`。`MINERADIO_ANDROID_SDK_BUNDLE` 可替代 `-SdkBundle`。构建在 `%LOCALAPPDATA%/MineradioAndroidBuild/source-project` 的独立 ASCII 目录进行，不覆盖旧的 `project` 目录。脚本拒绝清理未标记为本项目生成目录的路径。

每次准备会替换生成的 Java、Python、网页和 SDK 资源，清除旧构建残留，并剔除离线页面初始化脚本、Worker 和资源清单。SDK 配置同时放在 Java 与 Python 各自需要的位置，打包前再次核验 SDK 摘要。完成后追加原始 DEX，执行 16KiB ZIP 对齐和签名检查。产物在 `Android_apk/dist/`，文件名包含源码中的版本号和构建类型。

正式覆盖升级必须保留 `.local/mineradio.keystore` 和 `.local/signing-password.txt`。新项目首次签名会生成本机密钥；已有安装必须使用原密钥，不能用新密钥替代。可用 `-Unsigned` 只验证未签名构建。不要公开这些签名资料。

汽水签名在应用的 `:sdk` 私有进程中运行；请求有超时，原生异常与播放器主进程隔离。release 禁用 WebView 调试、调试媒体接口及测试布局参数。本地服务只绑定设备自己的回环地址。

## 后台播放与性能

页面直接读取 APK 内置资源，无须另存一份离线界面。启动时先通过固定本地入口注销旧页面 Worker，只清理 `mineradio-shell-*`、`mineradio-offline-v1`，保留账号、歌单、Cookie、IndexedDB 本地曲库及其他缓存。升级时同时删除应用私有网页目录中已移除的三份页面缓存脚本。断网仍可打开界面并播放已有的本地音乐；不再显示“正在保存离线界面”。详见 [迁移验证](../docs/EMBEDDED_UI_CACHE_REMOVAL.md)。

- 播放时使用媒体前台服务和有超时、按需续期的唤醒锁。耳机拔出、暂停或停止时立即释放唤醒锁。
- 暂停一分钟后退出前台服务，保留可继续播放的通知入口，避免闲置占用。WebView 仍由应用持有，Activity 销毁不直接丢失音频。
- 合并服务启动请求并限制失败重试频率。服务重建时重新读取完整状态；主进程被系统回收后显示返回播放器提示，交由现有队列恢复流程处理。
- 封面只在变化或服务请求完整快照时跨桥传递；相同的暂停状态不重复发送。元数据和通知只在需要时更新，封面解码最多保留一个等待任务。
- 更新后的资源仅在安装版本变化或资源缺失时展开，减少普通启动时的目录遍历。移除了访问不存在接口的听歌上报；本地最近播放、歌曲/歌手统计和每日统计继续保留。

系统“强行停止”、整进程回收和部分厂商电池策略仍可能中断播放。本实现没有将 WebView 音频迁移到独立原生播放器，因此不能承诺进程被杀后无缝继续播放；必要时由用户重新打开应用。

## 检查

以下检查使用合成 SDK/本机运行时，不需要真实账号或第三方安装包：

```powershell
python -X utf8 -m unittest discover -s Android_apk/checks -p "test_*.py" -v
node --test Android_apk/checks/bridge-regressions.test.cjs checks/listen-stats.test.cjs
```

JDK 可用时同时编译并执行服务启动策略的十种生命周期检查。GitHub Actions 在 Windows 和 Linux 上执行这些检查；完整 APK 构建仍需构建者本地的 SDK 材料和签名资料。

真机验收应覆盖汽水签名初始化、真实账号授权与播放、锁屏连续播放、暂停后通知继续、耳机拔出、Activity 重建和进程回收。本次已验证完整 release 构建、SDK 文件摘要及 APK 签名；按用户选择暂不安装手机，真实账号和后台行为尚未进行本轮真机验收。
