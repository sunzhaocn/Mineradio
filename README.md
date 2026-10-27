# Mineradio 音乐播放器

基于 [XxHuberrr/Mineradio-paused](https://github.com/XxHuberrr/Mineradio-paused) 继续开发，保留原作者及社区贡献者署名。项目采用 GPL-3.0-only，详见 [LICENSE](LICENSE) 和 [NOTICE.md](NOTICE.md)。第三方运行库保留各自权利和许可。

[下载安装包](https://github.com/sunzhaocn/Mineradio/releases/latest) · [公开源代码](https://github.com/sunzhaocn/Mineradio)

Windows 最新版为 **2.3.11**。支持网易云、QQ、酷狗、汽水音乐、本地曲库、歌词、歌单、MV 和桌面视觉效果；平台可用性与会员权益以对应平台实际返回为准。

## 使用与更新

Windows 下载 Release 中的 Setup 安装包安装，随后从桌面或开始菜单打开。运行环境已内置，无需启动独立网页服务。右上角更新入口可检查新版本；点击“立即更新”后下载并校验，完成后自动退出并覆盖安装，保留账号、歌单和设置。安装完成后可重新打开。2.3.10 及更早版本需先手动安装一次新版。

Android 构建与安装见 [Android_apk/README.md](Android_apk/README.md)。iPhone/iPad 工程与个人签名说明见 [iOS_ipa/README.md](iOS_ipa/README.md)；iOS 仍有平台功能和真机验证限制。

## 源码结构

| 目录 | 用途 |
| --- | --- |
| `Windows_exe/` | Windows Electron 客户端、打包入口与汽水签名 SDK |
| `Android_apk/` | Android 客户端与构建脚本 |
| `iOS_ipa/` | iPhone/iPad 客户端与云构建脚本 |
| `music_app/` | 各客户端共用的平台接口、认证、媒体和内嵌服务 |
| `web/player/` | 各客户端共用的播放器界面资源 |
| `third_party/` | 上游版权与第三方声明 |
| `docs/` | 接口、架构、登录和更新说明 |

`web/` 与 `music_app/web/` 是客户端运行所需的共享资源。独立 Web 启动入口、登录测试页和历史验收产物已清理。源码依赖清单与锁文件用于重新构建；构建说明见各客户端目录。

## 回归检查

共享认证与媒体检查位于 `checks/`，使用本机测试服务与合成凭据，不登录真实账号。安装源码依赖后运行：

```powershell
python -X utf8 -m unittest discover -s checks -p "test_*.py" -v
npm --prefix Windows_exe test
```

GitHub Actions 在 Windows 和 Linux 上自动执行这两组检查。iOS 的准备、检查与真机验证范围见 [iOS_ipa/README.md](iOS_ipa/README.md)。

账号凭据保存在当前客户端本地；公开源码不包含开发机器上的 Cookie、账号配置、个人音乐或运行缓存。Windows 用户数据位于 `%APPDATA%/Mineradio`。
