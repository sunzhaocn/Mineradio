"""播放只探测必要档位；明确指定的音质不能隐式升级或改成 auto。"""

QUALITY_ORDER = {
    'netease': ('jymaster', 'hires', 'lossless', 'exhigh', 'higher', 'standard'),
    'qqmusic': ('jymaster', 'hires', 'flac', '320', '128', 'aac'),
    'kugou': ('jymaster', 'hires', 'sq', '320', 'high', '128'),
}


def candidate_keys(provider, wanted, *, allow_fallback=False):
    wanted = str(wanted or 'auto').lower()
    order = QUALITY_ORDER[provider]
    if wanted in ('auto', 'best', ''):
        return order
    if not allow_fallback or wanted not in order:
        return (wanted,)
    return order[order.index(wanted):]
