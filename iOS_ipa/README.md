# Mineradio iPhone / iPad 本地预览版 0.1.1

本地版把播放器、音乐接口和资源放在 App 内。安装后无需让 Windows 开机，不依赖 music.hbsuzh.cn 或自建服务器。在线音乐与平台官方登录仍需要网络。最低系统版本 16.4，目标验证系统为 iPadOS 26。

这是开发预览版，汽水接入尚未完成，不能作为“四平台全部可用”的成品发布。

| 功能 | 当前实现与验证边界 |
| --- | --- |
| 本地运行 | 内嵌 Python 线程服务与本地 WebKit 界面；本机 HTTP 启动检查已通过 |
| 界面、歌单、歌词、MV、导入与下载 | 复用原有播放器；设备文件选择、后台与锁屏播放仍需真机检查 |
| 网易云、QQ、酷狗登录 | iOS 默认使用隔离的官方登录窗口，在平台页面选择密码或验证码；尚未完成真实账号验收 |
| 汽水登录与播放 | 缺少已验证的 iOS SDK 配置，密码／验证码登录未实现；显示明确提示，不回退为扫码，不影响其余播放器启动 |
| Apple 签名 | 构建生成未签名 IPA，需要用自己的 Apple 账号签名安装 |

## 从公开源码构建

Windows 可以准备源代码；最终 IPA 必须由 macOS / Xcode 编译。仓库的 `.github/workflows/ipad-local.yml` 可在 GitHub Actions 上执行，不需要自己的 Mac。构建服务只参与制作安装包，App 日常运行不依赖它。

```powershell
python -m pip install Pillow==13.0.0
python -X utf8 iOS_ipa/prepare.py
python -X utf8 -m unittest discover -s iOS_ipa/checks -p "test_*.py" -v
python -X utf8 iOS_ipa/export_source.py
```

`prepare.py` 不再读取开发机 runtime/ 中的 Android 提取记录。默认将汽水标记为未配置，不虚构许可证，也不携带任何 Cookie、设备 ID、签名证书或已接受的隐私选择。

如确有经过验证、可用于本 App 的汽水 iOS SDK 参数，可显式使用 `--qishui-config 路径` 提供 JSON，字段为 appId、license，可选 clientType、channel。准备器仅复制这些 SDK 字段并重置同意状态。提供 SDK 参数不代表汽水密码／验证码登录已完成。

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
