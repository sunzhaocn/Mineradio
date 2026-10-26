# Mineradio iPhone / iPad 私用版

另有 `发布包/iPad服务器版-20261025/Mineradio-0.2.4-iPad服务器版-unsigned.ipa`，它使用 music.hbsuzh.cn 的网页与在线接口。0.2.4 启用固定站点的 WebKit 离线能力与持久站点数据；首次联网自动保存完整播放器、内置视觉预设和资源，完成后显示“离线初始化完成”。歌曲下载会自动保存音频、可获取的歌词与封面，单独下载的歌词也持久保存；离线点击顶部提示即可播放本地曲库。请覆盖安装以保留已有数据。

本轮服务器资源已部署，452 项资源缓存、断网关闭并重启浏览器、实际播放器播放本地音频、歌词和视觉存档恢复、失败更新保留旧缓存，均通过 Windows Chromium 验证。IPA 已核验配置和 ARM64 结构；没有完成本轮 iPad 真机验证。详细记录在同目录发布包的 历史验证记录（已清理）。下面的嵌入式本机服务说明属于另一条开发分支。

当前目录是 **汽水音乐接入开发分支**，基于0.1.0私用测试版。基线曾通过ARM64 IPA结构与iPad Simulator启动检查（334个模块及原生桥接）；这些结果不代表本轮新增的汽水、原生音频和系统媒体功能已通过。最新逐项状态见项目根目录 docs/iOS-APK功能对照-20261025.md 及云端诊断附件。功能联调完成前，不作为可用汽水版本发布。

按 Android APK 的方式：应用内嵌 Python、音乐接口和现有播放器，不需要让 Windows 保持开机，也不需要自建后端。网络音乐仍需联网。一个 Universal App 支持 iPhone 和 iPad，iPhone 使用简易播放器，iPad 沿用平板的 1100px 虚拟视口和动效。新增原生窗口检测与原地分屏布局切换；iPad窄窗口停止主绘制，展开保留播放和队列。真实UIKit分屏仍待验收。

## 只有 Windows 和 iPad 时

1. 解压 `Mineradio-iOS-0.1.0-cloud-source.zip` 到独立文件夹。
2. 准备你自己的 GitHub 账号，安装 [GitHub CLI](https://cli.github.com/) 和 [Git for Windows](https://git-scm.com/download/win)。
3. 双击 `开始云端构建.bat`，按 GitHub 官方页面完成登录。脚本会显示上传范围，输入 `BUILD` 后创建新的**私有仓库**并上传准备好的源码。
4. 在仓库 **Actions → Mineradio iPhone and iPad** 查看结果。macOS 构建使用你账号的 Actions 配额，脚本不购买额度；若配额不足需在 GitHub 处理后再运行。
5. 成功后下载 **Mineradio-iOS-unsigned** 附件并解压，取得 `Mineradio-0.1.0-unsigned.ipa`。同时保存 `build-result.json历史验证记录（已清理）``powershell
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

Briefcase 生成 Xcode 项目，`xcodebuild` 编译真机 ARM64，再由 `ditto` 保留 framework 权限和链接形成 IPA。此流程关闭代码签名，生成物需要在 Windows 侧载工具内签名，不能直接点开安装。Python/Toga 和其标准库二进制由 BeeWare 官方支持包提供；本项目的协议依赖使用纯 Python，图片缓存使用 Pillow 官方 iOS 轮子，避免误用 Windows 的 `.pyd` 或 Android `.so历史验证记录（已清理）LICENSE.txt`。上游声明位于 App 资源 `bundle/third_party/`，vendored Python 依赖各自保留许可证与发行元数据。本交付没有添加或上传任何 Apple 证书或音乐平台私密资料。
