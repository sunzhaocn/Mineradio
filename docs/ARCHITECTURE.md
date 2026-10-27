# 模块对应关系

Windows 的 `Windows_exe/backend_entry.py` 调用 `music_app/launcher.py` 管理客户端内嵌 API 与界面服务；Android 和 iOS 通过各自的客户端入口启动。
启动器先绑定全部端口，再开启服务线程；绑定失败会回收已创建的服务，不自动漂移端口。

## 请求链

1. `api/http.py` 处理 HTTP 报文、来源限制、登录正文及音频传输入口。
2. `api/router.py` 按路径和平台派发，`api/params.py` 解析兼容参数。
3. `providers/<平台>/api.py` 组合该平台的搜索、歌曲、音质及歌词模块。
4. 聚合、榜单、电台分别由 `api/aggregate.py`、`api/charts.py`、`api/radio.py` 负责。

各平台的 `transport` 模块仅负责请求、签名或协议；`search`、`music`、`lyrics` 等模块处理对应业务。
`api/albums.py` 统一校验专辑参数并调用 `providers/<平台>/album.py`；`web/albums.py` 转换专辑曲目、原生歌曲标识及分页字段。
专辑详情复用播放器封面入口，按上游曲序展示并支持继续分页；只读请求沿用请求级凭据隔离。
`api/artists.py` 与 `providers/<平台>/artist.py` 读取歌手资料、热门目录及旧歌曲的歌手引用；`web/artists.py` 提供同源适配。
`core/artists.py` 只提取和校验原生歌手引用，搜索、专辑、榜单聚合与个人歌单保留歌手 ID；前端按当前歌曲平台打开详情并隔离过期响应。
汽水媒体处理位于 `providers/qishui/media/`，播放缓存及 Range 输出位于 `providers/qishui/playback.py`。
`providers/qishui/runtime/signer.cjs` 是必要程序资产，不是缓存目录。

## 登录链

`auth/router.py` 管理隔离会话和统一返回值，按平台调用各自 adapter。
网易云的扫码、手机号、浏览器和请求分开；QQ 的 QQ、微信、App 扫码分开；汽水的安全浏览器与传输分开。
QQ 三种登录入口共用 `auth/qqmusic/credentials.py` 校验账号标识与密钥，再写入 Cookie，避免各入口规则不一致；微信公开 App ID 的用途见根目录 `SECURITY.md`。
`web/authbridge.py` 只转发当前短期登录会话的结果，不读写磁盘账号。浏览器使用 `mineradio-local-accounts-v1` 本地存储保存各平台 Cookie、账号摘要及汽水设备参数，并提供查看与复制。
`core/request_credentials.py` 使用请求上下文隔离客户端 Cookie，网页通过请求头转发到音乐 API；线程池显式传递上下文，账号相关缓存按凭据摘要分开。服务端不回退读取旧共享账号配置。

## 网页链

`web/httpserver.py` 只处理 HTTP，`web/router.py` 负责接口组合；歌曲、音质、榜单、下载、媒体分别独立。
`web/templates.py` 仅按组件清单展开本地 HTML，拒绝越界路径、循环引用和任意请求 include。
`web/player/js/module-manifest.json` 明确声明与初始化顺序；每个脚本独立加载执行。
`web/player/components/manifest.json` 登记 HTML 组件；样式入口只引用对应规则文件。

额外功能脚本和样式分别归入 `js/features/` 和 `css/features/`，32 个散落文件已移动并更新入口、测试和桌面歌词页面的引用。

| 子目录 | 职责 |
| --- | --- |
| `core` | 启动前的显示配置 |
| `shell` | 窗口布局、主题、交互能力、鼠标离开生命周期 |
| `mobile` | 手机导航、歌词、更多控制器、简易模式 |
| `playback` | 媒体状态、切歌动画、旧音频回收 |
| `visual` | MV、幻灯片和对应视觉生命周期 |
| `cache` | 最近 10 首的资料、封面、MV 磁盘存储 |
| `library` | 本机曲库及曲库界面 |
| `radio` | 随心听排序与会话队列 |
| `account` | 账号相关样式 |

`components/00-state` 至 `components/11-main-loop` 保留原有功能模块与明确加载顺序；后端接口继续位于 `music_app/api`，平台协议位于 `music_app/providers`，请求凭据位于 `music_app/core`。未把业务重新集中进入口。

`mineradio-playback-media-v1` 的 `tracks` 对象仓库按歌曲与凭据摘要隔离，每条记录合并基本资料、封面 Blob 和 MV Blob，超过 10 首才按最近访问时间淘汰；关闭页面不清空。凭据本身不写入缓存。MV 同时只准备当前与下一首，单文件超过 256 MiB 时保留在线播放；存储配额不足也不阻断播放。下载曲库与幻灯片使用独立数据库，自动缓存淘汰不会删除用户主动保存的音频、歌词或图片。

浏览器本地曲库只在播放或准备下一首时创建 Blob URL，最多保留 8 个最近使用的句柄；目录和重启恢复使用稳定文件 ID。旧音频在退出播放且未被预载/混音持有时卸载源并移出文档。切歌动画只有一个独立入口，手机状态模块不再保留永远不会执行的装饰动画代码。

网页和 Electron 打包相同的 `web/` 目录。`js/features/library/browser-local-music.js` 在模块加载前注册浏览器存储接口，IndexedDB 仅保存用户主动导入的音频和歌词；Electron 优先继续调用 `desktopWindow`。本机播放、最近播放与启动恢复按稳定文件 ID 重新取得音源地址，不信任历史记录中的文件路径或旧 Blob URL。`js/features/shell/browser-capabilities.js` 按实际接口标记原生功能，避免浏览器暴露无效操作。

汽水 `client.sdk_directory()` 优先使用显式配置，其次项目内 `Windows_exe/sdk/`，最后寻找已安装客户端；评论模块直接读取同目录表情清单，两端不再使用不同的启动时补丁。启动网页时默认启用低优先级平台图片检查，可设置 `MINERADIO_CLIENT_ASSET_INIT=0` 关闭；API 单独启动不执行此任务。

`web/library.py` 负责四平台个人音乐库桥接，使用 `providers/<平台>/library.py` 读取喜欢、自建和收藏歌单。
个人音乐库沿用登录接口的本机同源检查；只返回网页所需字段，不返回上游原始响应或鉴权信息。
目录读取并行进行，单个平台失败不会清空其他平台；线程池继承请求凭据上下文，缓存按凭据摘要隔离，避免不同客户端串用账号。
`web/library_actions.py` 处理显式选择后的云歌单成员查询和加入/移除，按账号串行写入并使用操作标识去重。
平台适配器校验原生 ID、可编辑歌单归属与上游返回值，写后回读确认；前端长按与本机单击红心互相独立。
网易喜欢通过真实喜欢歌单的增删接口同步；QQ 写入使用 `qqmusic-api-python` 的客户端协议，匿名设备会话按请求凭据摘要隔离，关闭写入自动重试。
汽水保留普通歌曲与 `ugc_clip` 原声的原生类型，按真实类型同步，并为平台回读预留一致性等待。
`local-library` 负责目录、合并喜欢、隐藏恢复和完整分页导入；`local-cloud-heart` 负责长按、平台同步与已确认的平台标识。
导入已确认 `isLiked/kind=liked` 的平台歌单时，`local-adapter` 用既有同曲规则合并浏览器 `favorites`；普通歌单写入 `playlists`。旧版独立喜欢歌单按已确认目录补迁移，`favoriteImports` 一次性版本标记与合并结果一起保存，旧歌单继续保留。取消本机喜欢时同时保存 `favoriteRemovals` 同曲记录，后续其他平台首次迁移也不会自动加回；主动重新喜欢或再次导入可恢复，记录不发送云端。音乐库请求接收响应前重新核对当前账号，避免尚未送达的跨标签账号事件使旧目录触发迁移。
云端喜欢读取失败时保留已成功平台结果与明确错误，但不标记完整缓存，下次打开可继续重试。

## 路径与测试

Android 的 `MineradioApp` 持有音频 WebView 和最新播放快照，`PlayerService` 管理前台优先级、系统媒体控制、按播放状态持有的唤醒锁与暂停后的服务退出。WebView 桥仅在变化时传递封面，Application 合并待处理快照，服务恢复时请求完整状态；原生元数据/通知避免按秒重复重建。Activity 回调使用静态类和弱引用，减少长时间后台播放时对已销毁界面的持有。进程回收后展示中断提示，不宣称恢复已销毁的音频实例。

`Android_apk/extract_sdk.py` 将明确指定的兼容 APK 导入本地材料包，记录来源、原文件摘要和必需类位置；`prepare.py` 只接受显式材料包，在标记过的构建目录更新生成资源，并在打包前复核摘要。Android 复用 `iOS_ipa/web_release.py` 的内容摘要逻辑，为自己的桥脚本生成离线缓存版本；iOS 默认资源集合保持原有行为。

听歌结束仅保存本地最近播放、歌曲/歌手统计及日汇总，不请求不存在的 `/api/listen/report`。组件源文件与兼容 bundle 同步更新。

所有路径定义在 `music_app/paths.py`；启动目录变化不会改变配置读取位置。
本机配置放 `config/`，缓存和日志放根 `runtime/`，导出成品单独保存。
测试直接引用各模块及真实依赖位置，不使用兼容巨文件或动态拼接执行。
