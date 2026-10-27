# Mineradio iPhone / iPad 本地预览版 0.1.3

本地版把播放器、音乐接口和资源放在 App 内。安装后无需让 Windows 开机，不依赖 music.hbsuzh.cn 或自建服务器。在线音乐与平台官方登录仍需要网络。最低系统版本 16.4，目标验证系统为 iPadOS 26。

这是开发预览版。汽水目前提供官方公开目录筛选、官方歌曲链接 / ID 导入、可验证的公开音源和试听；全站搜索及会员整曲仍待平台正式接入授权。

| 功能 | 当前实现与验证边界 |
| --- | --- |
| 本地运行 | 内嵌 Python 线程服务与本地 WebKit 界面；本机 HTTP 启动检查已通过 |
| 界面、歌单、歌词、MV、导入与下载 | 复用原有播放器；窗口内全屏、无顶部 App 标题和启动 Logo；设备文件选择、后台与锁屏播放仍需真机检查 |
| 网易云、QQ、酷狗登录 | iOS 默认使用隔离的官方登录窗口，在平台页面选择密码或验证码；尚未完成真实账号验收 |
| 汽水登录 | 依据官方 PC 3.7.0 的手机号验证码流程，在 iPad 内隔离 WebKit 会话执行；官方验证码组件处理额外验证；真实发码与账号授权尚待用户验收。官方当前面板没有密码登录选项 |
| 汽水歌曲接口 | 无 SDK 配置时使用官方公开歌曲页：本地筛选有限目录或导入官方链接 / ID，仅播放实测明文 AAC；试听明确标注，完整曲库搜索和会员整曲需平台正式授权 |
| Apple 签名 | 构建生成未签名 IPA，需要用自己的 Apple 账号签名安装 |

## 从公开源码构建

Windows 可以准备源代码；最终 IPA 必须由 macOS / Xcode 编译。仓库的 `.github/workflows/ipad-local.yml` 可在 GitHub Actions 上执行，不需要自己的 Mac。构建服务只参与制作安装包，App 日常运行不依赖它。

```powershell
python -m pip install Pillow==13.0.0
python -X utf8 iOS_ipa/prepare.py
python -X utf8 -m unittest discover -s iOS_ipa/checks -p "test_*.py" -v
python -X utf8 iOS_ipa/export_source.py
```

`prepare.py` 不再读取开发机 runtime/ 中的 Android 提取记录。默认使用汽水官方公开目录，原生签名标记为未配置，不虚构许可证，也不携带任何 Cookie、设备 ID、签名证书或已接受的隐私选择。

如确有经过验证、可用于本 App 的汽水 iOS SDK 参数，可显式使用 `--qishui-config 路径` 提供 JSON，字段为 appId、license，可选 clientType、channel。准备器仅复制这些 SDK 字段并重置同意状态。手机号登录不依赖这份音乐接口配置；提供 SDK 参数也不代表真实账号与播放已经验收。

汽水只有点击“获取验证码”才发一次短信请求；轮询和安全验证结束都不会自动重发。验证码仅随本次本机请求送至官方接口，不写入会话或诊断。登录成功必须同时拿到当前流程的 Cookie 与官方 Passport 返回的有效账号 ID。额外验证由用户在同一台 iPad 的官方组件中完成，然后手动重试。

首次显式发码或登录提交会先取得平台下发的会话保护 Cookie，复用官方面板的匿名初始化请求；不展示、保存或轮询二维码。App 的设备内检查也会运行这一步，不带手机号、不发短信、不完成账号登录。每次准备资源时会生成新的界面缓存版本，覆盖安装时更新界面并保留用户的 localStorage 和 IndexedDB。

iPadOS 26 使用系统窗口模式时，请用系统窗口菜单最大化；播放器填满当前窗口，并保持调整尺寸时的音乐和播放队列。构建使用纯黑、无图片文字的原生启动画面，iOS 网页也直接进入播放器。

在 macOS 上执行：

```bash
python3.13 -m pip install briefcase==0.3.26 Pillow==13.0.0
python3.13 iOS_ipa/prepare.py
python3.13 iOS_ipa/build_unsigned.py
python3.13 iOS_ipa/build_simulator_smoke.py
```

GitHub 构建附件包含真实 ARM64 IPA、构建结果、iPad 模拟器结果与截图。只有结果中的 simulatorValidated 为 true 才表示模拟器启动和原生桥接检查通过；deviceValidated 为 false 时不代表 iPad 真机已验收。

## Windows 安装与验证

使用自己的 Apple 账号在 Windows 侧载工具中签名安装，不要把密码、验证码或 Cookie 发给其他人。免费个人签名通常需要每 7 天续签。首次开发安装可能需要在 iPad 的“隐私与安全性”中开启开发者模式。

更新时保持同一个 Apple 账号与 Bundle ID，优先覆盖安装并事先备份。原服务器版与本地版使用不同网页来源，因此旧服务器版的登录、网页缓存和下载内容不会自动迁移到本地版；不要先删除旧 App。

真机验收包括：完全退出后重开、断网导入和播放本地音频、在线搜索与播放、各平台真实登录与重开后保留、后台及锁屏续播、耳机与控制中心控制、分屏和横竖屏。这里的模拟器检查不能替代这些验收。

项目保留 GPL-3.0-only 与第三方声明；平台会员权益和可播放资源以对应平台实际返回为准。

0.1.3 修复了 QQ / 酷狗官方子窗口回传和关闭重开、网易云同次官方会话检测、汽水 Passport 账号检测；为内嵌 Python 单独提供可验证的 CA 证书包。构建验收需验证三平台原生空白弹窗及重开、四平台 HTTPS、通过本机音频代理推进的公开音频播放。个人账号实际授权结果由用户在 iPad 验收。

正式汽水接入需平台为本 App 批准的 iOS 音乐服务权限，以及 appId、license、channel、合法 BDDeviceID 设备注册说明；通用安全 SDK 许可证本身不等于音乐接口授权。当前不生成设备 ID 代替注册，不借用其他客户端许可证。详细证据见 docs/QISHUI_PLAYBACK_ACCESS_AUDIT.md（仓库内）。
