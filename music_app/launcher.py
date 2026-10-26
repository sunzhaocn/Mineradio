"""命令行参数及服务生命周期；业务逻辑位于各自模块。"""
import argparse
import os
import signal
import threading
import webbrowser

from .paths import ensure_directories


def parse_arguments(argv=None):
    parser = argparse.ArgumentParser(description="Mineradio 四平台音乐服务")
    parser.add_argument("--mode", choices=("all", "api", "web"), default="all",
                        help="all 同时启动 API 和网页；api/web 仅启动对应服务")
    parser.add_argument("--host", default="127.0.0.1", help="监听地址，默认仅本机")
    parser.add_argument("--api-port", type=int, default=18000)
    parser.add_argument("--web-port", type=int, default=18080)
    parser.add_argument("--open", action="store_true", help="启动后打开网页")
    return parser.parse_args(argv)


def run_services(args):
    """先成功绑定全部端口，再启动线程；任一失败都会关闭已创建的服务。"""
    ensure_directories()
    os.environ["MUSIC_API_BASE"] = f"http://127.0.0.1:{args.api_port}"
    servers = []
    workers = []
    initialize_assets = args.mode in ('all', 'web') and os.environ.get('MINERADIO_CLIENT_ASSET_INIT', '1') == '1'
    stopping = threading.Event()
    previous_handlers = {}
    try:
        if args.mode in ("all", "api"):
            from .api.server import create_server
            servers.append(("音乐 API", create_server(args.host, args.api_port)))
        if args.mode in ("all", "web"):
            from .web.httpserver import create_server
            servers.append(("Mineradio 网页", create_server(args.host, args.web_port)))
        for label, server in servers:
            worker = threading.Thread(target=server.serve_forever,
                                      name=label, daemon=True)
            worker.start()
            workers.append(worker)
            print(f"{label}: http://{args.host}:{server.server_address[1]}", flush=True)
        if initialize_assets:
            from .web import client_assets
            client_assets.start()
        print("已启动；按 Ctrl+C 统一关闭。", flush=True)
        if args.open and args.mode != "api":
            webbrowser.open(f"http://127.0.0.1:{args.web_port}/")
        for name in ("SIGINT", "SIGTERM", "SIGBREAK"):
            value = getattr(signal, name, None)
            if value is not None:
                previous_handlers[value] = signal.signal(value, lambda *_: stopping.set())
        while not stopping.wait(0.5):
            if any(not worker.is_alive() for worker in workers):
                raise RuntimeError("服务线程意外退出，请查看启动窗口。")
    finally:
        if initialize_assets:
            from .web import client_assets
            client_assets.stop()
        for value, handler in previous_handlers.items():
            signal.signal(value, handler)
        for _, server in servers[:len(workers)]:
            server.shutdown()
        for _, server in servers:
            server.server_close()
        for worker in workers:
            worker.join(timeout=3)
        if servers:
            from .auth.router import shutdown
            shutdown()


def main(argv=None):
    args = parse_arguments(argv)
    try:
        if not all(1 <= value <= 65535 for value in (args.api_port, args.web_port)):
            raise ValueError("端口必须在 1–65535 之间。")
        if args.mode == "all" and args.api_port == args.web_port:
            raise ValueError("API 和网页需要使用不同端口。")
        run_services(args)
        return 0
    except KeyboardInterrupt:
        return 0
    except (OSError, RuntimeError, ValueError) as error:
        print(f"启动失败：{error}", flush=True)
        return 1
