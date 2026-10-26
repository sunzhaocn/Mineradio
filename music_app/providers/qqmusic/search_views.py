"""平台适配：qqmusic / search_views。"""

from music_app.core import labels as core_labels
from music_app.core.artists import fields as artist_fields
from music_app.providers.qqmusic import config as qqmusic_config


def qqs_fmt_duration(sec):
    """把 QQ 秒数转成 分:秒 展示文本；与网易云的毫秒输入不同。"""
    s = int(sec or 0)
    return "%02d:%02d" % (s // 60, s % 60)


def qqs__https(u):
    """把 QQ 图片等普通资源地址转为 HTTPS；不能用于改写 vkey 播放地址。"""
    return (u or "").replace("http://", "https://")


def qqs_cover_of(album_mid, size=500):
    """根据专辑 mid 和尺寸生成 QQ 专辑封面 URL；没有 mid 时返回空串。"""
    if not album_mid:
        return ""
    return qqmusic_config.qqs_BASE + "/music/photo_new/T002R%dx%dM000%s.jpg" % (
        size,
        size,
        album_mid,
    )


def qqs_avatar_of(singer_mid, size=300):
    """根据歌手 mid 和尺寸生成 QQ 歌手头像 URL；没有 mid 时返回空串。"""
    if not singer_mid:
        return ""
    return qqmusic_config.qqs_BASE + "/music/photo_new/T001R%dx%dM000%s.jpg" % (
        size,
        size,
        singer_mid,
    )


def qqs_song_row(s):
    """将 QQ 搜索单首歌曲转成精简字段，保留 mid、media_mid、音质大小和付费标志。
    interval→duration_s（秒），album.mid→cover；用于搜索与跨平台聚合。"""
    al = s.get("album") or {}
    names = [x.get("name") for x in s.get("singer") or [] if x.get("name")]
    f = s.get("file") or {}
    pay = s.get("pay") or {}
    return {
        "mid": s.get("mid"),
        "name": s.get("name"),
        "singer": "/".join(names),
        "singers": names,
        **artist_fields(s.get('singer')),
        "album": al.get("name"),
        "album_id": str(al.get("id") or ""),
        "album_mid": al.get("mid"),
        "duration": qqs_fmt_duration(s.get("interval")),
        "duration_s": s.get("interval") or 0,
        "pay_play": pay.get("pay_play"),
        **core_labels.song_labels("qqmusic", s),
        "media_mid": f.get("media_mid") or s.get("mid"),
        "sizes": {
            "flac": f.get("size_flac") or 0,
            "320": f.get("size_320mp3") or 0,
            "128": f.get("size_128mp3") or 0,
            "aac": f.get("size_96aac") or 0,
        },
        "cover": qqs_cover_of(al.get("mid")),
        "page": "https://y.qq.com/n/ryqq/songDetail/%s" % s.get("mid"),
    }


def qqs_album_row(s):
    """将 QQ 专辑搜索记录转成精简视图，补封面与专辑页面链接。"""
    return {
        "id": s.get("albumID"),
        "mid": s.get("albumMID"),
        "name": s.get("albumName"),
        "singer": s.get("singerName"),
        "singer_mid": s.get("singerMID"),
        "song_count": s.get("song_count"),
        "publish": s.get("publicTime"),
        "cover": qqs_cover_of(s.get("albumMID")),
        "page": "https://y.qq.com/n/ryqq/albumDetail/%s" % s.get("albumMID"),
    }


def qqs_singer_row(s):
    """将 QQ 歌手搜索记录转成精简视图，补头像与歌手页面链接。"""
    return {
        "id": s.get("singerID"),
        "mid": s.get("singerMID"),
        "name": s.get("singerName"),
        "song_count": s.get("songNum"),
        "album_count": s.get("albumNum"),
        "mv_count": s.get("mvNum"),
        "avatar": qqs_avatar_of(s.get("singerMID")),
        "page": "https://y.qq.com/n/ryqq/singer/%s" % s.get("singerMID"),
    }


def qqs_songlist_row(s):
    """将 QQ 歌单搜索记录转成精简视图，保留歌单标识、名称、创建者和页面信息。"""
    creator = s.get("creator") or {}
    return {
        "id": s.get("dissid"),
        "name": s.get("dissname"),
        "cover": qqs__https(s.get("imgurl")),
        "song_count": s.get("song_count"),
        "listen": s.get("listennum"),
        "creator": creator.get("name"),
        "creator_uin": creator.get("creator_uin"),
        "create_time": s.get("createtime"),
        "page": "https://y.qq.com/n/ryqq/playlist/%s" % s.get("dissid"),
    }


def qqs_mv_row(s):
    """将 QQ MV 搜索记录转成精简视图，保留视频标识、名称、封面和页面信息。"""
    return {
        "id": s.get("mv_id"),
        "vid": s.get("v_id"),
        "name": s.get("mv_name"),
        "singer": s.get("singer_name"),
        "cover": qqs__https(s.get("mv_pic_url")),
        "duration": qqs_fmt_duration(s.get("duration")),
        "play_count": s.get("play_count"),
        "publish": s.get("publish_date"),
        "page": "https://y.qq.com/n/ryqq/mv/%s" % s.get("v_id"),
    }


qqs_ROW_BUILDER = {
    0: qqs_song_row,
    1: qqs_singer_row,
    2: qqs_album_row,
    3: qqs_songlist_row,
    4: qqs_mv_row,
}
