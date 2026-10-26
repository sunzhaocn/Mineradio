# Windows 一键更新

此分支原项目：[XxHuberrr/Mineradio-paused](https://github.com/XxHuberrr/Mineradio-paused)。公开更新源：[sunzhaocn/Mineradio Releases](https://github.com/sunzhaocn/Mineradio/releases)。

从 Windows 2.3.11 起，右上角更新按钮始终提供检查入口。启动时检查一次正式发行版，打开更新面板时重新检查。只有点击“立即更新”才开始下载；下载期间显示百分比与大小，可以收起面板继续使用。

安装包由 electron-updater 校验 SHA-512。只有校验成功才进入安装状态，约一秒后自动退出；先执行既有的后端和桌面宿主清理，再由退出事件静默运行 NSIS 安装器。沿用注册的安装目录和产品 GUID，保留用户数据；完成后不会自动重新启动。网络或校验失败保留运行状态，支持重试。不读取构建者的 GitHub 凭据，也不接受网页提供的更新源、下载路径或安装命令。

2.3.10 及更早版本尚无本功能，需要手动安装一次 2.3.11。

## 后续发行

1. 修改 `Windows_exe/package.json` 及锁文件中的版本号，使用递增的正式版本。
2. 按 Windows 构建说明生成并验证安装包。网页或 Python 源码改变时同步重建后端及共享资源。
3. 创建与版本对应的正式 GitHub Release（例如 `v2.3.12`），上传同一构建产出的 `Mineradio-版本-Setup-x64.exe`、`.exe.blockmap`、`.exe.sha256` 和 `latest.yml`。
4. 公开发行必须同时带安装包与 `latest.yml`；不要手改清单中的 SHA-512 或文件大小。草稿和预发行版不会作为稳定更新推送。

源码依赖清单和锁文件用于重建；下载安装包已包含运行所需依赖，用户无需准备开发环境。

## 2.3.11 验证范围

- 更新控制器：固定 GitHub 源、可信主窗口 IPC、检查/下载去重、进度通知、校验失败不退出、重试和仅一次退出调度均通过。
- 构建后的真实 Electron 页面：334 个模块全部加载，更新入口、最新版本状态、下载按钮与进度正常，无页面异常。
- 在线流程：仅将测试实例的版本比较值模拟为 2.3.10；真实访问公开 Release，下载完整的 405073244 字节安装包，记录 0–100% 进度，校验后进入安装状态并自动退出。未伪造下载、校验或安装器。
- 实际安装：原已安装版 2.3.8 覆盖升级到 2.3.11，注册目录与 GUID 沿用；安装后的 EXE、app.asar、后端 EXE 与验收包 SHA-256 一致。
- 安装包：全部 1934 个归档条目 CRC 通过，532 个共享网页文件与源代码一致，未发现测试目录或用户账号配置。
- 隐私：公开源码排除本地账号 Cookie、缓存、个人音乐与无关项目；检查了本地配置中的 20 个凭据片段及常见 GitHub/私钥模式，均未命中待公开文件。

验证命令：

```powershell
node tests/frontend/test-app-updater.cjs
cd Windows_exe
node scripts/verify-app-updater.cjs
```

`--install` 为人工验收用的有副作用测试：它只模拟旧的比较版本，实际下载并安装当前公开版本，会更新本机已注册的 Mineradio。默认命令只检查成品启动、界面和退出。
