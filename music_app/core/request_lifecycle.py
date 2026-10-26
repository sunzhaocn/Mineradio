"""Transient cancellation for independent JSON GET reads, never platform writes.

The web/API servers share one process. An internal random ticket forwards the
outer read's socket lifetime without exposing a browser cancellation protocol.
"""
from contextlib import contextmanager
from contextvars import ContextVar
import secrets
import select
import socket
import threading
import time

from . import request_credentials


class RequestCancelled(Exception):
    """The owning GET consumer disconnected; do not cache an unavailable result."""


class ReadTask:
    def __init__(self, peer):
        self.peer = peer
        self.scope = secrets.token_hex(16)
        self.cancelled = False

    def check(self):
        if not self.cancelled:
            try:
                if select.select([self.peer], [], [], 0)[0]:
                    # GET only. Peeking never consumes body/pipelined bytes.
                    self.cancelled = self.peer.recv(1, socket.MSG_PEEK) == b''
            except (OSError, ValueError):
                self.cancelled = True
        if self.cancelled:
            raise RequestCancelled()


_CURRENT = ContextVar('music_read_task', default=None)
_TICKETS = {}
_TICKET_LOCK = threading.Lock()
TICKET_HEADER = 'X-Music-Read-Task'


def current():
    return _CURRENT.get()


def scope():
    task = current()
    return task.scope if task else ''


def check():
    task = current()
    if task:
        task.check()


def sleep(seconds):
    deadline = time.monotonic() + max(0, seconds)
    while True:
        check()
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            return
        time.sleep(min(.05, remaining))


@contextmanager
def _bind(task):
    token = _CURRENT.set(task)
    try:
        yield task
    finally:
        _CURRENT.reset(token)


@contextmanager
def detached():
    """Shared owner work must outlive any one subscribing socket."""
    with _bind(None):
        yield


@contextmanager
def web_read(peer, *, enabled):
    with _bind(ReadTask(peer) if enabled and peer is not None else None):
        check()
        yield


@contextmanager
def forward_ticket():
    task = current()
    if not task:
        yield ''
        return
    check()
    ticket = secrets.token_urlsafe(24)
    with _TICKET_LOCK:
        _TICKETS[ticket] = (task, request_credentials.fingerprint())
    try:
        yield ticket
    finally:
        with _TICKET_LOCK:
            _TICKETS.pop(ticket, None)


@contextmanager
def api_read(peer, ticket='', *, enabled=False, loopback=False):
    with _TICKET_LOCK:
        record = _TICKETS.get(ticket) if ticket and loopback else None
    task = record[0] if record and record[1] == request_credentials.fingerprint() else None
    if task is None and enabled and peer is not None:
        task = ReadTask(peer)
    with _bind(task):
        check()
        yield
