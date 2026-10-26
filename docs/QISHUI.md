# 汽水模块

接口仍使用 `platform=qishui`，兼容 `soda`、`汽水`、`汽水音乐`。
音质保留 `medium`、`higher`、`highest`、`lossless`、`spatial`、`hi_res` 和 `auto`。
名称与实际编码分别返回，Hi-Res 不一定是 FLAC。

| 模块 | 职责 |
| --- | --- |
| `providers/qishui/client.py` | 配置、请求签名及读取接口 |
| `providers/qishui/api.py` | 搜索、歌曲、歌词、音质及路由组合 |
| `providers/qishui/playback.py` | 本地音频、处理合并、缓存、Range/HEAD |
| `providers/qishui/media/` | 授权资料解析、MP4 结构与 CENC 音轨处理 |
| `providers/qishui/runtime/signer.cjs` | 调用本机已安装客户端 SDK 的必需脚本 |
| `providers/qishui/export.py` | 独立文件导出命令 |
| `auth/qishui/` | 扫码和独立安全浏览器会话 |

媒体缓存位于根 `runtime/cache/qishui/audio/`，最多约 512 MB；导出成品保存在 `汽水音乐解密结果/`。
首次冷播放需要等待音频下载及处理，后续可复用缓存。每次复用前仍读取当前会话可取得的音源资料。
公开播放 URL 指向 `/qishui/audio`，不包含原始媒体密钥；网页通过同源媒体代理播放。

```powershell
python -B -m music_app.providers.qishui.export --id 6917577283060074497 --quality lossless
```

`QISHUI_SDK_DIR` 可指定已安装 SDK 的目录；默认自动查找本机汽水客户端。
Node.js、PyCryptodome、FFmpeg 和本机登录配置决定本地处理能力；具体歌曲是否可用取决于实际返回的音源。
原算法参考与 MIT 许可保留在媒体模块内，网页上游 GPL 许可保留在 `third_party/mineradio/`。
