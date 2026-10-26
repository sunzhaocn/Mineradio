# 本机配置

- `cookies.txt`：网易云、QQ 音乐、酷狗的原有分平台 Cookie 配置。
- `qishui_session.json`：汽水请求所需的 `query` 与 `headers`，从原位置原样迁入。
- `local-accounts.json`：旧版账号摘要，当前客户端 Cookie 模式不再读取或写入。
- `local-downloads.json`：允许下载的现成音频清单，路径以项目根目录为基准。

当前 Cookie 由各客户端本地保存，并随每次请求发送。服务端不再读取这些旧账号文件作为共享凭据；保留文件仅便于原用户自行取回资料。
