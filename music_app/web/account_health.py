"""Dispatch small read-only login checks to their platform adapters."""
import importlib

PROVIDERS = {'netease': 'netease', 'qq': 'qqmusic', 'kugou': 'kugou', 'qishui': 'qishui'}


def adapter(provider):
    return importlib.import_module('music_app.providers.' + PROVIDERS[provider] + '.session_status')


def check(provider, force=False):
    return adapter(provider).check(force=force)


def cached(provider):
    return adapter(provider).cached()
