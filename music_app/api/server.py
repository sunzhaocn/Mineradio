"""多线程 HTTP 服务生命周期。"""

from music_app.core.httpserver import ExclusiveThreadingHTTPServer as ThreadingHTTPServer
from music_app.api import http as api_http
from music_app.api import params as api_params
from music_app.api import settings as api_settings
from music_app.providers.kugou import transport as kugou_transport
from music_app.providers.netease import transport as netease_transport
from music_app.providers.qishui import api as qishui_api
from music_app.providers.qqmusic import transport as qqmusic_transport


def create_server(host=api_settings.HOST, port=api_settings.PORT):
    """创建可由主启动器统一管理的服务；指定端口不可用时明确报错。"""
    return ThreadingHTTPServer((host, port), api_http.Handler)


def serve(host=api_settings.HOST, port=api_settings.PORT):
    """启动本地多线程 HTTP 服务；目标端口绑定失败时依次尝试后续 19 个端口。
    打印启动地址与 Cookie 配置状态，Ctrl+C 后关闭监听；成功退出返回 0，无法绑定返回 1。"""
    httpd = None
    for p in range(port, port + 20):
        try:
            httpd = ThreadingHTTPServer((host, p), api_http.Handler)
            port = p
            break
        except OSError:
            continue
    if httpd is None:
        print("端口 %d~%d 全部被占用" % (port, port + 19))
        return 1
    print("统一音乐接口已启动: http://%s:%d" % (host, port))
    print(
        '  搜索: curl "http://%s:%d/?platform=kugou&type=search&search=周杰伦&simple=1"'
        % (host, port)
    )
    print(
        '  歌曲: curl "http://%s:%d/?platform=netease&type=music&id=347230&simple=1"' % (host, port)
    )
    print(
        '  直链: curl -L "http://%s:%d/stream?platform=qqmusic&url=0039MnYb0qxYhV&quality=flac"'
        % (host, port)
    )
    print('  平台: curl "http://%s:%d/platforms"' % (host, port))
    print('  自检: curl "http://%s:%d/health"' % (host, port))
    print("  登录资料仅由各客户端逐次请求提供；服务端不读取或保存 Cookie。")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n已停止")
    finally:
        httpd.server_close()
    return 0
