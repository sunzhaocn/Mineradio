"""Read passport identity without refreshing tokens or requiring media SDKs."""
from music_app.core.session_health import Tracker
from . import passport_account

classify = passport_account.classify

tracker = Tracker('qishui')


def probe():
    return classify(passport_account.read())


def check(force=False):
    return tracker.check(probe, force)


def cached():
    return tracker.cached()
