"""Own and drain embedded HTTP connections before the interpreter is stopped."""
import socket
import threading

from music_app.core.httpserver import ExclusiveThreadingHTTPServer


class LocalHTTPServer(ExclusiveThreadingHTTPServer):
    daemon_threads = False

    def __init__(self, *args, **kwargs):
        self._connections = set()
        self._connection_lock = threading.Lock()
        super().__init__(*args, **kwargs)

    def get_request(self):
        connection, address = super().get_request()
        connection.settimeout(30)
        with self._connection_lock:
            self._connections.add(connection)
        return connection, address

    def shutdown_request(self, request):
        try:
            super().shutdown_request(request)
        finally:
            with self._connection_lock:
                self._connections.discard(request)

    def close_connections(self):
        with self._connection_lock:
            connections = tuple(self._connections)
        for connection in connections:
            try:
                connection.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
