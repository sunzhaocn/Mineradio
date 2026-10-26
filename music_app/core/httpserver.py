"""Windows 端口使用排他绑定，避免多个版本同时接收同一地址的请求。"""
import os
import socket
from http.server import ThreadingHTTPServer


class ExclusiveThreadingHTTPServer(ThreadingHTTPServer):
    allow_reuse_address = os.name != 'nt'

    def server_bind(self):
        if os.name == 'nt':
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        return super().server_bind()
