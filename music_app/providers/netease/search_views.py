"""平台适配：netease / search_views。"""

from music_app.core import labels as core_labels
from music_app.core.artists import fields as artist_fields


def nes_fmt_duration(ms):
    """将网易云毫秒时长转为 分:秒 文本；用于搜索列表展示。"""
    s = int(ms or 0) // 1000
    return "%02d:%02d" % (s // 60, s % 60)


def nes_song_page(song_id):
    """用网易云歌曲 ID 构建网页地址，供搜索结果的 page 字段使用。"""
    return "https://music.163.com/#/song?id=%s" % song_id


def nes__song_row(s):
    """兼容 cloudsearch（al/ar/dt）与 legacy（album/artists/duration）两套字段。"""
    al = s.get("al") or s.get("album") or {}
    ar = s.get("ar") or s.get("artists") or []
    names = [a.get("name") for a in ar if a.get("name")]
    dt = s.get("dt") or s.get("duration") or 0
    return {
        "id": s.get("id"),
        "name": s.get("name"),
        "singer": "/".join(names),
        "artists": names,
        **artist_fields(ar),
        "album": al.get("name"),
        "cover": al.get("picUrl") or None,
        "duration": nes_fmt_duration(dt),
        "duration_ms": int(dt or 0),
        "fee": s.get("fee"),
        **core_labels.song_labels("netease", s),
        "mv": s.get("mv") or s.get("mvid") or 0,
        "album_id": al.get("id"),
        "page": nes_song_page(s.get("id")),
    }


def nes__generic_row(otype, s):
    """非歌曲类型（专辑/歌手/歌单/MV/用户）的紧凑视图。"""
    if otype == 10:
        return {
            "id": s.get("id"),
            "name": s.get("name"),
            "artist": (s.get("artist") or {}).get("name"),
            "cover": s.get("picUrl"),
            "song_count": s.get("size"),
            "publish": s.get("publishTime"),
            "page": "https://music.163.com/#/album?id=%s" % s.get("id"),
        }
    if otype == 100:
        return {
            "id": s.get("id"),
            "name": s.get("name"),
            "alias": s.get("alias"),
            "cover": s.get("picUrl") or s.get("img1v1Url"),
            "album_count": s.get("albumSize"),
            "song_count": s.get("musicSize"),
            "page": "https://music.163.com/#/artist?id=%s" % s.get("id"),
        }
    if otype == 1000:
        return {
            "id": s.get("id"),
            "name": s.get("name"),
            "cover": s.get("coverImgUrl"),
            "song_count": s.get("trackCount"),
            "creator": (s.get("creator") or {}).get("nickname"),
            "page": "https://music.163.com/#/playlist?id=%s" % s.get("id"),
        }
    if otype == 1004:
        return {
            "id": s.get("id"),
            "name": s.get("name"),
            "cover": s.get("cover"),
            "artist": (s.get("artist") or {}).get("name"),
            "duration": nes_fmt_duration(s.get("duration")),
            "page": "https://music.163.com/#/mv?id=%s" % s.get("id"),
        }
    if otype == 1002:
        return {
            "id": s.get("userId"),
            "name": s.get("nickname"),
            "cover": s.get("avatarUrl"),
            "signature": s.get("signature"),
        }
    return dict(s)
