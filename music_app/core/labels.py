"""统一平台明确返回的歌曲标签。不通过歌名、歌手排名或播放成功与否猜测原唱/VIP。"""


def enabled(value):
    return value is True or str(value).lower() in ('1', 'true')


def song_labels(platform, row):
    """会员专属歌曲与仅高音质需要会员分别标注；未知原唱状态保留 None。"""
    vip, paid, quality_vip, original = False, False, False, None
    quality_keys = []
    if platform == 'netease':
        fee = row.get('fee')
        vip, paid, quality_vip = fee == 1, fee == 4, fee == 8
        cover_type = row.get('originCoverType')
        if cover_type in (1, 2):
            original = cover_type == 1
        charge = (row.get('privilege') or {}).get('chargeInfoList') or []
        rates = {128000: 'standard', 192000: 'higher', 320000: 'exhigh', 999000: 'lossless'}
        quality_keys = [rates[x['rate']] for x in charge if x.get('chargeType') == 1 and x.get('rate') in rates]
    elif platform in ('qq', 'qqmusic'):
        pay = row.get('pay') or {}
        playback_paid = enabled(pay.get('pay_play', row.get('pay_play')))
        monthly = enabled(pay.get('pay_month', row.get('pay_month')))
        vip, paid = playback_paid and monthly, playback_paid and not monthly
    elif platform == 'kugou':
        # PayType 表示收费状态，不能仅凭 Privilege 数字把所有付费歌都说成 VIP。
        value = row.get('PayType', row.get('pay_type'))
        paid = str(value) in ('1', '2', '3', '4')
        value = row.get('IsOriginal', row.get('is_original'))
        if value is not None:
            original = enabled(value)
        vip = enabled(row.get('vip_required'))
    elif platform == 'qishui':
        info = row.get('label_info') or {}
        vip = enabled(info.get('only_vip_playable'))
        quality_keys = list(info.get('quality_only_vip_can_play') or [])
        quality_vip = bool(quality_keys) and not vip
        paid = enabled(info.get('only_purchase_playable'))
        for key in ('is_original', 'is_original_song'):
            value = info.get(key, row.get(key))
            if value is not None:
                original = enabled(value)
                break
    badges = []
    if vip:
        badges.append('VIP')
    elif paid:
        badges.append('付费')
    elif quality_vip:
        badges.append('高音质VIP')
    if original is True:
        badges.append('原唱')
    elif original is False:
        badges.append('翻唱')
    return dict(vipRequired=vip, paid=paid, qualityVip=quality_vip,
                qualityVipKeys=quality_keys, isOriginal=original, badges=badges)
