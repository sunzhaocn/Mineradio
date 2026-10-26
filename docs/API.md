# 接口入口

启动 `python main.py` 后，API 为 `http://127.0.0.1:18000`。
平台为 `netease`、`qqmusic`、`kugou`、`qishui`，原有别名继续兼容。

| 路径 | 用途 |
| --- | --- |
| `/health` | 服务及依赖状态 |
| `/platforms` | 平台能力和参数 |
| `/search?platform=qishui&search=夜曲&size=20` | 单平台搜索 |
| `/all?type=all&search=夜曲` | 四平台聚合和同曲去重 |
| `/song?platform=qishui&id=6917577283060074497` | 歌曲详情 |
| `/album?platform=netease&id=32311&offset=0&limit=100` | 专辑资料及按专辑顺序排列的曲目 |
| `/artist?platform=netease&id=13536299&offset=0&limit=36` | 歌手资料、头像、简介及热门歌曲 |
| `/qualities?platform=qishui&id=6917577283060074497` | 原生音质档位 |
| `/lyric?platform=qishui&id=6917577283060074497` | 歌词 |
| `/stream?platform=qishui&id=6917577283060074497&quality=highest` | 跳转至可播放音源 |
| `/charts?platform=qishui` | 平台榜单目录 |
| `/chart?platform=qishui&id=目录中的ID` | 榜单全部曲目 |
| `/login` | 登录接口目录 |
| `/login/ui?platform=netease` | 独立登录测试页 |

网易云使用 `id`，QQ 常用 `mid`，酷狗使用搜索返回的 `hash`；以 `/platforms` 返回为准。
网页使用同源 `/api/` 适配接口，账号入口已经接到服务端登录桥。
本机依赖正常不等于账号登录仍有效；实际请求结果决定可用内容和音质。

## 四平台专辑

`GET /album`（兼容 `/album/detail`、`/api/album`）接受 `platform`、`id`、`offset`、`limit`。
网易云、酷狗和汽水使用原生专辑 ID；QQ 可使用数字专辑 ID 或 `mid`。
`offset` 从 0 开始，`limit` 默认 100，允许 1–200。接口只读取专辑资料和曲目，不获取音频地址。

```powershell
curl.exe 'http://127.0.0.1:18000/album?platform=netease&id=32311'
curl.exe 'http://127.0.0.1:18000/album?platform=qqmusic&mid=003bSL0v4bpKAx'
curl.exe 'http://127.0.0.1:18000/album?platform=kugou&id=10729818'
```

返回 `album`（`id`、`mid`、`name`、`artist`、`artists`、`cover`、`description`、`publish_time`、`company`、`type`、`total`）、
`songs`、`total`、`offset`、`limit`、`has_more`。平台没有提供的资料保留空值，不通过歌名猜测。
曲目保留原生 ID、专辑标识、时长、封面及上游提供的曲序/碟号；按 `offset + len(songs)` 继续读取，直到 `has_more=false`。
参数错误返回 400，专辑下架或不存在返回 404，上游故障返回 502；汽水缺少客户端会话时返回明确的 503 提示。
汽水沿用上述 `X-Music-Credentials` / `X-Music-Session` 请求级凭据，不回退读取旧共享配置。

网页端口的对应入口为 `/api/album/detail`、`/api/qq/album/detail`、`/api/kugou/album/detail`、`/api/qishui/album/detail`。
其响应使用 `provider`、`album`、`songs`、`total`、`nextOffset`、`hasMore`；歌曲可直接加入播放器队列。
缺少专辑标识时可传 `songId`，仅按该平台原生歌曲资料恢复。原生资料确认未关联专辑时，返回
`ok=true, albumAvailable=false, reason=song_has_no_album, album=null, songs=[]`，这是正常的无专辑状态；
读取超时或失败仍返回可重试错误，不会搜索并替换成其他同名歌曲的专辑。
在播放器中点击歌曲封面打开专辑详情，超过一页时使用“加载更多曲目”。读取失败会显示原因，已经加载的曲目继续保留。
此功能只提供专辑读取，当前网页版不显示未实现的专辑收藏按钮。

## 四平台歌手详情

`GET /artist`（兼容 `/artist/detail`、`/api/artist`）接受 `platform`、歌手 `id` / `mid`、`offset`、`limit`。
QQ 可使用数字歌手 ID 或原生歌手 mid；其他平台使用数字歌手 ID。`offset` 从 0 开始，`limit` 默认 50，允许 1–100。
旧队列或收藏缺少歌手标识时，可传 `song_id` 和 `name`：只通过同平台歌曲元数据恢复歌手，不请求音频、不自动跳到其他平台。
恢复时精确核对名称与原生引用，无法确认或存在同名歧义会明确报错。

```powershell
curl.exe 'http://127.0.0.1:18000/artist?platform=netease&id=13536299&limit=3'
curl.exe 'http://127.0.0.1:18000/artist?platform=netease&song_id=1357887427&name=JAWNY&limit=3'
curl.exe 'http://127.0.0.1:18000/artist?platform=qqmusic&mid=0025NhlN2yWrP4&offset=1&limit=3'
curl.exe 'http://127.0.0.1:18000/artist?platform=kugou&id=3520&offset=49&limit=3'
```

返回 `artist`（`id`、`mid`、`name`、`avatar`、`description`、`alias`、`song_count`）、
`songs`、`total`、`offset`、`limit`、`has_more`、`scope`。
`song_count` 是平台声明的作品数；`total` 是本次热门目录的曲目数，两者不能混用。
网易云接口提供固定热门目录（通常最多 50 首）；QQ、酷狗和汽水可继续读取平台热门排序目录。
汽水的声明总数可能低报，未读到末页时 `total_is_estimate=true`，读到末页后按实际可见曲目纠正；其余平台使用明确目录总数。
汽水保留客户端 SDK 签名和请求级设备会话要求，未提供时返回明确 503；不读取旧共享凭据。

网页入口为 `/api/artist/detail`、`/api/qq/artist/detail`、`/api/kugou/artist/detail`、`/api/qishui/artist/detail`。
返回 `ok`、`provider`、`artist`、`songs`、`total`、`nextOffset`、`hasMore`、`totalEstimated`、`scope`。
点击搜索结果、队列或歌单中的歌手入口即可打开。简介可折叠，热门歌曲支持继续加载、加入队列和下一首播放。
读取失败保留已加载内容并提供重试；分页间精确目录总数变化或重复曲目会要求重新加载，关闭弹窗会忽略迟到响应。

## 歌曲评论与歌词详情

网页端口 `18080` 的评论入口为 `/api/song/comments`、`/api/qq/song/comments`、
`/api/kugou/song/comments`、`/api/qishui/song/comments`。评论使用当前实际音源的原生歌曲标识；
参数为 `id`（QQ 也传 `mid`，酷狗可传 `hash`）、`limit`（1–50）、`cursor`、`sort`（`hot` / `new`）。
汽水保留平台原生排序，响应 `capabilities.sorts=["default"]`，后续分页可传 `sort=default`。

响应包含 `ok`、`provider`、`comments`、`total`、`nextCursor`、`hasMore`、`capabilities`。
评论保留文字、平台提供的表情/图片、头像、VIP/认证标识、赞数、引用回复和地区标签；
平台未提供的标识不会补造。加载或登录失败返回明确错误，不能视作“暂无评论”。

点赞使用相同入口加 `/like`，仅接受同源 `POST` JSON：
`{"songId":"歌曲ID","commentId":"评论ID","liked":true,"requestId":"本次操作的唯一标识"}`。
`liked=false` 表示取消点赞；QQ 可另传 `mid`，汽水可传 `nativeMediaType`。
请求使用当前浏览器该平台的登录资料，支持情况以响应 `capabilities.like` 和每条 `canLike` 为准。
同一 `requestId` 的重复请求不会重复写入；未确认的写入会提示刷新检查状态。
评论发表尚未实现，因此页面不提供发送按钮。

网页歌词入口沿用各平台 `/api/.../lyric`。网易云和 QQ 歌词读取独立于音频音质探测，返回实际歌词及
`provider`、`source`、`nolyric`、`uncollected`。歌曲详情可展开歌词，纯音乐、歌词未收录和请求失败分别显示。
详情预览不会改写当前播放的歌词；自定义歌词仍按原来的歌曲设置使用。

## 每次请求的 Cookie

API 不保存客户端 Cookie，不读取服务端旧 Cookie 文件。调用方每次请求都传入自己的 Cookie；未传入时使用游客模式，无服务端账号预验证。

单平台请求可传 `cookie` 参数，或使用 `X-Music-Cookie` / `Cookie` 请求头。推荐请求头，避免 Cookie 出现在 URL 中：

```powershell
curl.exe 'http://127.0.0.1:18000/song?platform=netease&id=347230&simple=1' -H 'X-Music-Cookie: MUSIC_U=你的本地Cookie'
```

汽水同时需要相应设备会话参数时，使用 `X-Music-Session` 头传入 `{ "query": { "device_id": "..." }, "headers": {} }`。跨平台请求可使用 `X-Music-Credentials` 头，其 JSON 按平台分别提供 `{ "netease": { "cookie": "..." }, "qqmusic": { "cookie": "..." }, "qishui": { "cookie": "...", "session_config": { "query": {}, "headers": {} } } }`，未列出的平台保持游客。

浏览器播放器自动携带本地凭据；音频元素和下载使用 `credentials` 参数传递相同 JSON。服务端访问日志只记录路径，不记录凭据参数。每个请求结束后清理凭据上下文，缓存按凭据隔离。

## 网页个人音乐库

这些接口位于网页端口 `18080`，仅允许本机同源请求，使用客户端随请求传入的登录资料。
平台参数为 `netease`、`qq`（也接受 `qqmusic`）、`kugou`、`qishui`。

| 路径 | 用途 |
| --- | --- |
| `/api/library/catalog` | 四平台个人歌单目录，区分 `liked` 喜欢、`created` 自建、`collected` 收藏 |
| `/api/library/catalog?provider=qq&force=1` | 刷新单个平台目录 |
| `/api/library/tracks?provider=qq&id=歌单ID&offset=0&limit=100` | 分页读取歌单歌曲 |
| `/api/library/likes?provider=qishui&offset=0&limit=100` | 分页读取指定平台喜欢的歌曲 |

目录响应的 `providers` 包含各平台的 `configured`、`loggedIn`、`ok`、`message`。
`configured` 表示本次请求是否携带平台凭据；`ok` 才表示本次个人音乐库请求成功。
平台失败时返回明确状态，其他平台仍保留；`partial` 表示已配置平台存在读取失败。
歌曲响应使用 `tracks`、`total`、`hasMore`、`nextOffset`，失败时 `ok=false`，不能当作空歌单。
默认每页 100 首，最多 200 首；客户端应持续读取 `hasMore`，不能只取第一页。
缓存按平台和请求凭据指纹隔离，默认 90 秒；线程池继承独立的请求上下文，不回退服务器旧账号。
`force=1` 可强制刷新。

原 `/api/user/playlists`、`/api/qq/user/playlists`、`/api/kugou/user/playlists`、
`/api/qishui/user/playlists` 及对应 `/playlist/tracks` 继续兼容并读取同一音乐库。
合并喜欢和歌单隐藏由网页处理，隐藏设置保存在当前浏览器。

`POST /api/library/membership` 接受 `{song, sources: [], force: true}`，查询各平台可编辑歌单中是否存在对应原始歌曲。
`song` 和 `sources` 使用网页标准歌曲行，跨平台音源须先核对歌名、完整歌手与版本。
汽水歌曲保留 `nativeMediaType`（`track` 或 `ugc_clip`），抖音原声不能当作普通 `track` 收藏；旧本机记录缺少类型时，先通过平台只读详情识别。
响应包含 `providers` 各平台查询状态、确认含曲的 `playlists`、`partial`；歌单中的 `matchedSong` 为移除操作所需的真实平台歌曲。
没有查询成功的状态不能显示为已收藏。

`POST /api/library/mutate` 接受 `{provider, id, operation, song, requestId}`，`operation` 为 `add` 或 `remove`。
仅用户长按红心并选择目标后调用，本机单击喜欢不调用此接口。
`requestId` 为每次操作的唯一标识，重试同一次请求需复用；同标识不同操作会拒绝，避免重发造成重复写入。
服务端重新检查目标歌单归属、`editable/canAdd/canRemove` 和歌曲原生平台 ID，写入后读取确认才返回 `ok:true`。
云写入使该账号的目录、歌曲和收藏状态缓存失效，旧请求不能覆盖新结果。
