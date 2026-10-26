# Mineradio iPhone / iPad 私用版

另有 `发布包/iPad服务器版-20261025/Mineradio-0.2.4-iPad服务器版-unsigned.ipa`，它使用 music.hbsuzh.cn 的网页与在线接口。0.2.4 启用固定站点的 WebKit 离线能力与持久站点数据；首次联网自动保存完整播放器、内置视觉预设和资源，完成后显示“离线初始化完成”。歌曲下载会自动保存音频、可获取的歌词与封面，单独下载的歌词也持久保存；离线点击顶部提示即可播放本地曲库。请覆盖安装以保留已有数据。

本轮服务器资源已部署，452 项资源缓存、断网关闭并重启浏览器、实际播放器播放本地音频、歌词和视觉存档恢复、失败更新保留旧缓存，均通过 Windows Chromium 验证。IPA 已核验配置和 ARM64 结构；没有完成本轮 iPad 真机验证。详细记录在同目录发布包的 `浏览器离线验收.json`。下面的嵌入式本机服务说明属于另一条开发分支。

当前目录是 **汽水音乐接入开发分支**，基于0.1.0私用测试版。基线曾通过ARM64 IPA结构与iPad Simulator启动检查（334个模块及原生桥接）；这些结果不代表本轮新增的汽水、原生音频和系统媒体功能已通过。最新逐项状态见项目根目录 docs/iOS-APK功能对照-20261025.md 及云端诊断附件。功能联调完成前，不作为可用汽水版本发布。

按 Android APK 的方式：应用内嵌 Python、音乐接口和现有播放器，不需要让 Windows 保持开机，也不需要自建后端。网络音乐仍需联网。一个 Universal App 支持 iPhone 和 iPad，iPhone 使用简易播放器，iPad 沿用平板的 1100px 虚拟视口和动效。新增原生窗口检测与原地分屏布局切换；iPad窄窗口停止主绘制，展开保留播放和队列。真实UIKit分屏仍待验收。

## 只有 Windows 和 iPad 时

1. 解压 `Mineradio-iOS-0.1.0-cloud-source.zip` 到独立文件夹。
2. 准备你自己的 GitHub 账号，安装 [GitHub CLI](https://cli.github.com/) 和 [Git for Windows](https://git-scm.com/download/win)。
3. 双击 `开始云端构建.bat`，按 GitHub 官方页面完成登录。脚本会显示上传范围，输入 `BUILD` 后创建新的**私有仓库**并上传准备好的源码。
4. 在仓库 **Actions → Mineradio iPhone and iPad** 查看结果。macOS 构建使用你账号的 Actions 配额，脚本不购买额度；若配额不足需在 GitHub 处理后再运行。
5. 成功后下载 **Mineradio-iOS-unsigned** 附件并解压，取得 `Mineradio-0.1.0-unsigned.ipa`。同时保存 `build-result.json`，可核对 SHA-256。
6. 使用 [Sideloadly 官方 Windows 版](https://sideloadly.io/) 将 IPA 安装到 iPad：按官网要求安装 Apple 的 iTunes/iCloud 驱动，USB 连接设备并在 iPad 上选择信任，将 IPA 拖入 Sideloadly，使用你本人的 Apple 账号签名。账号和密码只在官方工具内操作，不交给本项目或 GitHub Actions。
7. 按设备提示信任开发者；如果系统要求开发者模式，在设置中启用并重启后确认。安装完成再打开 Mineradio。

免费 Apple 账号签名的侧载应用通常 **7 天**到期，需要续签；Sideloadly 提供自动续签功能，但电脑与设备连接、账号及系统状态仍影响续签。朋友安装同一份 IPA 时，各自使用自己的 Apple 账号签名。无需提交 App Store；不要共享账号或购买来源不明的企业证书。

已为你创建独立的 [私有源码仓库](https://github.com/sunzhaocn/mineradio-ios-private)，可直接从其 [Actions 页面](https://github.com/sunzhaocn/mineradio-ios-private/actions) 重新构建，无需再次建仓。原项目的公共仓库未修改。构建失败时请保留 Actions 的首个失败步骤与日志。

## 当前实现和验证边界

| 项目 | 当前状态 |
| --- | --- |
| 嵌入式 Python 与本机服务 | 服务只绑定设备自己的 127.0.0.1:18000/18080；Windows 主机测试和 iPad Simulator 启动通过 |
| 网易云、QQ、酷狗接口与登录 | 网易云保留手机号密码/短信验证码，并新增官方网页窗口；QQ、酷狗在独立的原生 WebKit 官方窗口选择登录方式。只接受本次窗口的真实凭据；QQ、酷狗还须通过同一凭据的音乐账号检查。真实账号登录、搜索、播放待设备验证 |
| 汽水音乐 | 真实扫码、原生AAC/FLAC在iPadOS26.2模拟器验证通过。修复SIGPIPE后，SDK初始化仍有SIGSEGV，签名与业务接口未通过；尚未验证汽水密码/短信主登录。已提供独立的未签名实验测试IPA供用户在真实iPad测试，不能当作已验收稳定版 |
| 本地音乐、歌词、歌单 | 复用 IndexedDB 与 WKWebView 文件选择；本地曲库的 iOS 持久性、实际音频格式待真机验证 |
| 文件导出 | 已接分块写入与原生系统分享/“存储到文件”；分块完整性与路径边界通过主机测试，网页与原生消息往返通过模拟器测试，实际系统分享窗口待真机验证 |
| 后台、锁屏与耳机 | 已配置AVAudioSession、后台音频及原生MPRemoteCommandCenter/Now Playing；仍使用 WebKit 音频，后台切歌和长时间锁屏**不作已通过承诺**；必要时后续迁移 AVPlayer |
| 手机/平板 | 已接iPhone简洁界面与iPad窗口布局controller；主机浏览器状态保持检查通过，iPadOS26的旋转、分屏、软键盘仍待原生与真机验证 |
| 音乐平台凭据 | 沿用 APK 的当前设备 WebKit 站点存储与请求隔离；没有迁入 Keychain，源码包不含电脑上的任何用户配置或 Cookie |
| Windows 桌面功能 | 桌面歌词浮窗、Wallpaper Engine、自启动等仍仅 Windows 版可用 |

卸载应用或清除应用站点数据会清除其本地曲库与会话，重要音频请导出到“文件”。不同设备独立保存数据，不会自动同步。VIP、平台风控及音频格式按平台和系统实际支持情况处理。

## 本地开发和重新打包

在原项目 Windows 工作目录执行：

```powershell
python -X utf8 iOS_ipa/prepare.py
python -B -X utf8 -m unittest discover -s iOS_ipa/tests -p "test_*.py"
python -X utf8 iOS_ipa/export_source.py
```

准备阶段需要 Pillow（仅用于生成图标）及 pip，协议依赖安装到本项目 `src/mineradio/vendor/`，不安装到手机以外的服务器。App 运行依赖均随包携带。源码按明确目录复制，不读取用户 `config/`、账号Cookie、设备登录会话、桌面安装目录或Apple签名资料。准备脚本只从已核验的Android提取记录中读取固定四项公开应用SDK参数；不复制Android二进制。iOS SDK由官方固定URL下载并校验SHA-256，保留许可证。`bundle/source-manifest.json` 与 ZIP 内的 `manifest.sha256` 记录文件摘要。

在有 Xcode 的 Mac 或 macOS CI 上，对准备好的源码执行：

```bash
python3.13 -m pip install briefcase==0.3.26
python3.13 build_unsigned.py
```

Briefcase 生成 Xcode 项目，`xcodebuild` 编译真机 ARM64，再由 `ditto` 保留 framework 权限和链接形成 IPA。此流程关闭代码签名，生成物需要在 Windows 侧载工具内签名，不能直接点开安装。Python/Toga 和其标准库二进制由 BeeWare 官方支持包提供；本项目的协议依赖使用纯 Python，图片缓存使用 Pillow 官方 iOS 轮子，避免误用 Windows 的 `.pyd` 或 Android `.so`。

## 真机验收

首次安装后依次检查：离线启动与本地音频导入；杀进程重开后本地曲库；四平台搜索与各自扫码/Cookie 登录；歌词和自动切歌；下载并保存到“文件”；锁屏、后台 20 分钟、耳机暂停/继续；iPad 横竖屏与分屏。扫码、账号确认和平台二次验证由本人完成。每项须记录实际结果，不能用网页模拟测试代替。

## 依据与许可证

- [Python 官方 iOS 嵌入说明](https://docs.python.org/3.13/using/ios.html)
- [Briefcase iOS 构建与部署说明](https://briefcase.beeware.org/en/v0.3.26/reference/platforms/iOS/xcode.html)
- [Toga WebView 文档](https://toga.beeware.org/en/v0.5.3/reference/api/widgets/webview.html)
- [Sideloadly 官方侧载与有效期说明](https://sideloadly.io/)

沿用原项目的 GPLv3 许可证，完整文本为 `LICENSE.txt`。上游声明位于 App 资源 `bundle/third_party/`，vendored Python 依赖各自保留许可证与发行元数据。本交付没有添加或上传任何 Apple 证书或音乐平台私密资料。
