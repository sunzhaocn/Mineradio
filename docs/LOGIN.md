> 项目已模块化：统一启动使用 `python main.py`；本文件记录登录协议，模块路径见 ARCHITECTURE.md。

# 四平台音乐登录 API

登录测试页：<http://127.0.0.1:18000/login/ui>。统一运行 `python main.py`，API 与网页分别使用 18000、18080 端口。

网易云默认使用手机号配合短信验证码或密码登录；QQ 音乐、酷狗音乐、汽水音乐保留扫码流程。请在本机测试页输入账号资料，不要将密码、验证码或 Cookie 发到聊天中。

已接入 Mineradio 网页端原来的右上角账号按钮，地址为 <http://127.0.0.1:18080/>。网页使用同源 `/api/local/auth/*` 登录桥，只把本次扫码或手机号登录返回的 Cookie、账号摘要及汽水设备参数交给当前客户端。Cookie 保存在浏览器本地存储 `mineradio-local-accounts-v1`，服务端不读写账号文件，也不校验或记录长期账号登录状态。

播放器进入 QQ、酷狗或汽水扫码页时自动生成二维码；切换平台、切换 QQ 扫码方式、点击重新登录后也会自动生成。失败或过期后可点击“重新生成二维码”。切换到手动 Cookie 模式或关闭面板会停止当前页面的扫码轮询。

播放器四个平台都提供“手动输入 Cookie”。保存操作只写入当前浏览器；随后通过同源 `GET /api/local/profile?provider=netease|qq|kugou|qishui`，随请求头携带对应平台的 Cookie，读取昵称与头像并存回当前浏览器。旧版手动 Cookie 会自动补齐资料，也可点击“刷新昵称与头像”。资料读取失败不清除 Cookie，不将 Cookie 配置状态当作会员权限。该接口要求本机同源访问，只返回账号编号、昵称和头像，不回传 Cookie 或上游原始响应。

汽水读取昵称和头像只需要有效 Cookie，无需填写设备编号；音乐接口需要时可补充同一会话的 `device_id` 与可选 `install_id`。酷狗昵称兼容 Cookie 中的百分号 Unicode 编码，并优先从平台恢复最新头像资料。支持粘贴 Cookie 请求头内容或以 `Cookie:` 开头的内容。点击已保存账号即可直接查看和复制 Cookie，退出仅删除当前浏览器的对应记录。

每次音乐 API 请求携带当前客户端 Cookie；未携带时按游客请求，不会使用服务端旧账号配置。网页 JSON 请求通过 `X-Music-Credentials` 传递按平台区分的凭据，媒体/下载请求用 `credentials` 参数传递；上下文、解析缓存及音频缓存按凭据隔离。服务端只在处理请求和短期登录会话时临时持有数据，不做长期存储。平台本身要求的扫码确认、安全验证与会员权限继续由平台决定。

## 网易云手机号登录

| 操作 | 方法与路径 | JSON 请求体 |
| --- | --- | --- |
| 创建独立会话 | `POST /login/netease/phone/session` | `{}` |
| 发送短信验证码 | `POST /login/netease/sms/send` | `key`、`phone`、`countrycode` |
| 短信验证码登录 | `POST /login/netease/phone` | `key`、`phone`、`countrycode`、`captcha` |
| 密码登录 | `POST /login/netease/phone` | `key`、`phone`、`countrycode`、`password` |
| 读取本次状态或结果 | `GET /login/netease/check?key=...` | 无 |

所有 POST 请求使用 `Content-Type: application/json`。手机号、密码和验证码只能放在 JSON 请求体中，不能写入 URL 或查询参数。字段含义如下：

| 字段 | 说明 |
| --- | --- |
| `key` | 创建会话返回的随机短期凭据；发送短信、提交登录和读取结果必须使用同一个 key |
| `phone` | 手机号字符串 |
| `countrycode` | 国家/地区码字符串，默认中国大陆为 `"86"` |
| `password` | 该网易云账号的密码；与 `captcha` 二选一 |
| `captcha` | 用户收到的短信验证码字符串，保留可能存在的开头零；与 `password` 二选一 |

调用顺序：

1. 创建会话，读取 `key`、`check_url` 和有效期；未完成的登录会话最长保留 600 秒。
2. 短信登录时，由用户点击“发送验证码”，再调用短信接口。服务不会自动发送短信，也不会在失败后自动重试发送。
3. 提交手机号与密码，或手机号与收到的验证码。一次请求只能选择一种登录方式。
4. 检查本次登录响应，或通过 `check_url` 读取状态。只有 `status=authorized` 且 `authorized=true` 时才使用返回的 Cookie 与账号信息。

表单内容和登录 Cookie 仅在当前进程的会话中处理，不将手机号、密码、验证码写入日志或文件；接口也不会自动修改现有 `config/cookies.txt`。登录结果可以在测试页复制。测试不要使用真实号码自动发送短信，真实发送与登录由用户操作。

手机号登录直接请求网易云服务，不依赖 Chrome、Edge 或桌面窗口，因此本流程可在无桌面的 Linux 上运行。网易云仍可能返回 `8821` 等安全验证、限流或账号错误；这类结果不能当作成功，也不能通过不断重试保证解决。本次调整没有取消官方验证要求，当前本机访问限制也保持不变。

## 扫码接口

网易云旧扫码接口继续兼容，测试页默认入口已改为手机号表单。

| 平台 | 生成二维码 GET | 查询扫码状态 GET | 使用什么扫码 |
| --- | --- | --- | --- |
| 网易云音乐 | `/login/netease/qr` | `/login/netease/check?key=...` | 网易云音乐 App |
| QQ 音乐 | `/login/qqmusic/qr` | `/login/qqmusic/check?key=...` | 手机 QQ |
| 酷狗音乐 | `/login/kugou/qr` | `/login/kugou/check?key=...` | 酷狗音乐 App |
| 汽水音乐 | `/login/qishui/qr` | `/login/qishui/check?key=...` | 汽水音乐 App 搜索框右侧扫一扫 |

也支持统一入口 `/login/qr?platform=netease`、`/login/qr/check?platform=netease&key=...`，以及上述路径的 `/api/login/...` 别名。平台别名与现有音乐接口一致。这些接口无需 `type` 参数。

QQ 音乐支持三种独立扫码方式：`/login/qqmusic/qr?method=qq` 使用手机 QQ；`method=wechat` 使用微信；`method=mobile` 使用 QQ 音乐 App。默认 `qq`。这三种码不能混用扫码工具；`mobile` 是 QQ 音乐 App 专用码，会在服务端建立 MQTT 推送订阅后返回二维码。查询仍使用对应会话的 `check_url`，不需要再次传 method。

兼容的网易云扫码接口生成二维码时会打开本次专属的 Chrome/Edge 官网窗口，直接读取官网原生二维码。扫码、额外验证和最终 Cookie 采集始终使用此窗口的同一隔离会话。在另外打开的官网页面登录无法把 Cookie 传回这次 API 会话。`GET /login/netease/open?key=...` 可唤回扫码会话的原窗口，不适用于手机号会话。

### 扫码调用顺序

1. GET 生成二维码接口，得到随机会话 `key`、`qr_url`、PNG Data URI `qr_image`、`expires_in`、`expires_at` 和 `check_url`。
2. 将 `qr_image` 放到 `<img src="...">`，由用户扫码确认。`qr_url` 是二维码内容，QQ 在缺少可选解码库时可为空，图片仍可用。
3. 每 3 秒 GET 查询接口，必须使用生成时的同平台 `key`。`key` 是短期会话凭据，应按 Cookie 的敏感程度处理。
4. `status=authorized` 且 `authorized=true` 时读取结果。过期或取消后，重新生成二维码。

```python
import time
import requests

base = 'http://127.0.0.1:18002'
qr = requests.get(base + '/login/qqmusic/qr?method=qq', timeout=90).json()
# 将 qr['qr_image'] 展示给用户；扫码界面本身不需要调用者安装 requests。
while True:
    response = requests.get(base + qr['check_url'], timeout=90)
    response.raise_for_status()
    result = response.json()
    if result['authorized']:
        cookie = result['cookie']
        account = result.get('account', {})
        credentials = result.get('credentials', {})
        break
    if result['status'] in ('expired', 'cancelled'):
        break
    time.sleep(max(3, result.get('retry_after', 3)))
```

## 返回字段

| 字段 | 说明 |
| --- | --- |
| `status` | `waiting` 等待用户操作；`scanned` 已扫码待确认/验证；`authorized` 已取得音乐平台登录凭据；`expired` 过期；`cancelled` 取消；额外验证和限流以实际响应为准 |
| `authorized` | 是否取得本次新授权的完整音乐平台登录凭据 |
| `message` | 可直接展示的中文状态说明 |
| `cookie` | 仅成功时返回，使用 `Cookie` 请求头格式，不包含 `Path`、`Expires` 等 Set-Cookie 属性 |
| `account` | 仅成功时返回，包含上游确实提供的账号 `id`、`name`、`avatar` 等；缺失资料不编造 |
| `credentials` | 仅成功时返回，各平台必要 token、用户 ID、刷新字段或设备标识 |
| `session_config` | 汽水成功时额外返回 `{query, headers}`，可供现有 `qishui_api.py` 的配置格式使用 |
| `upstream_code` | 部分平台的原生状态码 |
| `verification_required` | 官方要求额外身份验证，此时尚未登录完成 |
| `interactive_window` | 扫码会话保留专属官网登录窗口；不表示手机号登录需要浏览器 |
| `open_url` | 显示本次已有官网登录窗口的本机接口 |
| `verification_url` | 部分流程提供的额外验证地址；网易云原生浏览器流程在本次专属窗口完成验证 |
| `verification_type` | 额外验证类型，例如网易云 `risk_control` |
| `retry_after` | 部分平台要求延迟重试的秒数，调用者应尊重此值 |
| `result_expires_in` | 已授权结果还能从服务端读取多少秒 |

网易云手机号登录只在本次独立 CookieJar 真正收到 `MUSIC_U` 后返回成功，并返回 `__csrf` 等实际存在的必要字段；兼容扫码流程同样只采集本次隔离浏览器的 Cookie。账号资料查询失败不会丢弃已经取得的 Cookie。QQ 先完成 QQ 授权，再兑换 QQ 音乐 `musicid` / `musickey` 并兼容现有 `uin`、`qqmusic_key` Cookie 字段。酷狗最终换票包含官网要求的 `srcappid`，返回与官网歌曲接口匹配的登录字段。

汽水使用全新隔离浏览器上下文加载安全组件，以同一上下文生成 `a_bogus` / `msToken` 并管理本次 Cookie，展示上游原样二维码。确认后合并 JSON `session_cookie` 与 HTTP Set-Cookie，返回新设备参数；调用歌曲接口仍使用现有客户端签名 SDK。若平台要求额外验证，将打开本次会话的验证窗口，由用户完成。签名已观测、等待扫码、最终授权是三个不同验证阶段。

## 会话与运行

酷狗手动 Cookie 应用只保存原值。昵称、头像仅从该 Cookie 的字段读取；不调用自动登录接口补齐资料，不自动换令牌或注册新设备。同一 Cookie 重复应用时保留已有扫码资料；不同 Cookie 不继承旧账号资料。缺少昵称或头像不清除 Cookie，已失效的凭据也不会自动重新登录。只有用户明确发起扫码并授权时，才执行扫码换票。

- 四个平台各自使用独立会话，创建手机号会话或生成二维码不依赖原有登录资料。
- 扫码查询每会话最多每 3 秒访问一次上游；手机号登录仅在用户提交时操作，不自动重试发送或登录。成功结果短期保留 10 分钟，重复查询复用结果，避免重复兑换一次性票据。服务重启后登录会话失效。
- 登录结果只通过专用登录接口返回；当前接口不会自动将结果写入 `config/cookies.txt` 或 `config/qishui_session.json`。测试页可复制 Cookie 和完整 JSON。
- 登录接口供本机客户端/本机网页调用，响应禁止缓存，访问日志不输出会话 key 或账号凭据。普通音乐接口的原有 CORS 行为保持兼容。
- 本地二维码渲染使用 `qrcode[pil]`；QQ 直接返回官方二维码。QQ 的扫码 URL 解码可选使用 OpenCV / numpy。
- 新环境安装扫码依赖：`python -m pip install -r requirements.txt`。QQ 音乐 App 扫码依赖 `paho-mqtt` 的 MQTT5 over TLS/WebSocket 支持，监听会在二维码过期或登录完成后关闭。
- 汽水扫码额外需要本机 Chrome 或 Edge，可通过 `QISHUI_BROWSER_PATH` 指定浏览器。每次使用全新上下文与内存资产，不读取个人浏览器资料；保留浏览器默认 Web 安全与存储隔离。扫码结束或过期后回收浏览器。
- 网易云兼容扫码流程需要本机 Chrome 或 Edge；专属窗口使用临时隔离上下文，不读取个人浏览器登录资料。用户亲自完成官网要求的协议确认与安全验证。成功或过期后回收窗口，成功结果仍可在保留期内复制。网易云手机号登录不使用此浏览器流程。
- 测试页保留各平台已完成的测试结果于本页内存，刷新页面后需要重新登录。
- `/login/diagnostics` 返回本轮扫码阶段、上游状态码、响应字段名及 Cookie 名称，不含扫码会话 key、账号值、Cookie 或 token 值。扫码失败时 `/check` 的错误 JSON 及测试页也可查看同类诊断。
- 开发复测服务设置 `MUSIC_AUTH_RELOAD=1` 后，新生成的二维码使用磁盘中的最新平台适配器；已经创建的扫码会话继续使用原版本。正常服务默认关闭此功能。

## 验证

运行回归：`python -B -X utf8 -m unittest discover -s tests -p "test_*.py"`。

创建二维码和未扫码轮询已对四个平台进行真实请求验证；授权后的真实账号凭据由用户在测试页逐个平台确认后验证，不能用模拟测试代替。

用户已在本轮实测通过 QQ、微信及酷狗的最终凭据返回，脱敏摘要保存在 `历史脱敏验证记录（已清理）`。网易云手机号密码/短信登录尚待用户真实登录验证；模拟测试与会话创建成功不能证明官方接受真实账号登录。兼容的网易云专属浏览器流程仍需用户扫码确认最终凭据返回，汽水新安全会话及 QQ 音乐 App 修正后的桌面目标仍需用户重新扫码确认。QQ 音乐 App 的旧目标参数原生返回 `104610` 且授权配置为空，改成桌面目标 `ct=19, cv=2201` 后，官方 H5 查询返回 `0` 且授权标题与按钮完整；这还不能替代手机真实页面验证。

协议核对来源：[网易云官网扫码登录脚本](https://s3.music.126.net/web/s/pt_frame_index_2b8192306764f32086606cd3d6d62d64.js)、[网易云官网 WEAPI 脚本](https://s3.music.126.net/web/s/core_c7686f506f6f2607bb7f6cea1951f039.js)、[QQ 音乐登录实现](https://github.com/l-1124/qqmusicapi/blob/main/qqmusic_api/modules/login.py)、[酷狗官网登录脚本](https://staticssl.kugou.com/common/js/min/login/kguser.v2.min.js)。汽水扫码参数另核对本机官方客户端 3.7.0 的 `getQrcodeRequest`、`checkQrconnectRequest`、`getHandleScanCodeH5Img` 实现。
