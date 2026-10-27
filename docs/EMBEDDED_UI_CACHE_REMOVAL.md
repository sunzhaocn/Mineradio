# Windows / Android 内置界面缓存清理

适用版本：Windows 2.3.14、Android 1.1.11。两端已内置完整页面，运行时直接从设备自己的回环服务读取，不再保存额外的离线界面副本。

## 清理范围

- 原生启动入口先访问 `/__embedded_bootstrap`。旧 Worker 的资源列表不含此入口，因此可以执行当前安装包提供的清理逻辑，不依赖旧缓存中的页面脚本。
- 只注销当前来源根作用域、脚本为 `/service-worker.js` 的注册；只删除 `mineradio-shell-*` 和 `mineradio-offline-v1`。
- 安装包不再包含 Worker、离线清单和独立的离线初始化脚本。Android 更新展开内置资源时，仅删除这三份已废弃的应用自有静态文件。
- localStorage、IndexedDB、Cookie、账号、歌单、本地音乐及歌词、封面、MV 等媒体存储不参与清理。其他作用域的 Worker 和其他名称的缓存保留。
- 页面不再注册 Worker，也不再显示离线初始化提示。断网可继续加载内置页面并播放已经保存在设备上的音乐。

## 已验证

1. **真实 Chromium 迁移场景，Windows/Android 两种原生接口标记：** 先建立旧 Worker 和页面缓存，确认其遮住新页面；通过各自启动路径迁移后读取新页面，旧 Worker 与页面缓存消失，其他 Worker 和音频缓存保留。
2. **数据完整性：** 合成账号、歌单、HttpOnly Cookie、IndexedDB 中的本地音频 Blob 与歌词保持一致；保存的音频仍能解码播放。再次改变页面内容，无须调整缓存版本或网址参数即可加载新页面。
3. **真实 Windows 成品：** 原安装 2.3.13 与新成品 2.3.14 复用同一个独立测试数据目录和回环来源，复现旧 Worker/缓存后，由新成品自动执行迁移。账号、歌单、本地音频和歌词测试数据、其他媒体缓存保留；Worker 数量和页面缓存均为 0，无离线提示。两版各 334 个模块加载成功，均正常退出。用户当前正在使用的安装和数据没有被此测试替换。
4. **准备与打包：** Windows 与 Android 的生成目录均移除三份废弃资源，不会残留旧生成文件。Android 保留完整 21 个 SDK DEX、原生库、原签名身份，并完成版本、ZIP 对齐及签名检查。

自动边界检查由 GitHub Actions 在 Windows 和 Linux 执行。人工触发的成品和浏览器检查命令：

```powershell
python Windows_exe/checks/check_embedded_cache.py
python Windows_exe/checks/check_frozen_cache_migration.py
```

前者需要 Playwright 和 Edge；后者还需要本机已有的旧版 Windows 安装及刚构建的成品，会使用专用测试目录，不读取用户的真实账号。其余单元检查按项目 README 运行。

本轮没有向安卓手机安装新版；Android 系统 WebView 上的升级迁移尚需真机验收。浏览器迁移验证与 APK 检查分别证明其对应范围。
