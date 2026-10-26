"""平台适配：qqmusic / metadata。"""

import re
import time
from music_app.providers.qqmusic import config as qqmusic_config
from music_app.providers.qqmusic import transport as qqmusic_transport


def qq_parse_target(s):
    """
    返回 ("mid"|"songid"|"search", 值)；无法识别返回 (None, "")。
        10~14 位字母数字混排       -> mid       例 0039MnYb0qxYhV
        纯数字                     -> songid    例 97773
        y.qq.com/...songDetail/xxx  -> mid
        其它文本                   -> search（按歌名搜索取首条）
    """
    s = (s or "").strip().strip('"').strip("'")
    if not s:
        return (None, "")
    if re.fullmatch("\\d+", s):
        return ("songid", s)
    if re.fullmatch("[0-9A-Za-z]{10,14}", s) and re.search("[A-Za-z]", s):
        return ("mid", s)
    m = re.search("(?:songDetail/|songmid=|/song/)([0-9A-Za-z]{10,14})", s)
    if m:
        return ("mid", m.group(1))
    m = re.search("[?&]songmid=([0-9A-Za-z]{10,14})", s)
    if m:
        return ("mid", m.group(1))
    if s.startswith("http"):
        return (None, "")
    return ("search", s)


def qq_cover_fields(album_mid):
    """T002 = 专辑封面；500/800 实测可用，1080 不一定有。"""
    if not album_mid:
        return {"cover": "", "cover_hd": "", "cover_tpl": ""}
    tpl = qqmusic_config.qq_BASE + "/music/photo_new/T002R{size}x{size}M000" + album_mid + ".jpg"
    return {
        "cover": tpl.replace("{size}", "500"),
        "cover_hd": tpl.replace("{size}", "800"),
        "cover_tpl": tpl,
    }


def qq_singer_avatar_fields(singers):
    """T001 = 歌手头像；300 可用，400 会 404。"""
    mid = ""
    for s in singers or []:
        if isinstance(s, dict) and s.get("mid"):
            mid = s.get("mid")
            break
    if not mid:
        return {"singer_avatar": "", "singer_avatar_tpl": ""}
    tpl = qqmusic_config.qq_BASE + "/music/photo_new/T001R{size}x{size}M000" + mid + ".jpg"
    return {"singer_avatar": tpl.replace("{size}", "300"), "singer_avatar_tpl": tpl}


def qq__sizes_of(file_obj):
    """保留上游实际提供的 size_* 字段，区分明确为零与未提供音源信息。"""
    f = file_obj or {}
    return {
        k: f[k]
        for k in (
            "size_flac",
            "size_320mp3",
            "size_128mp3",
            "size_96aac",
            "size_ape",
            "size_hires",
            "size_48aac",
            "size_192aac",
        )
        if k in f
    }


def qq_song_detail(mid=None, song_id=None, cookie=None, *, strict=False):
    """get_song_detail_yqq（按 mid）/ get_song_detail（按数字 id）；返回 track_info 或 {}。"""
    if mid:
        data = {
            "songinfo": {
                "module": "music.pf_song_detail_svr",
                "method": "get_song_detail_yqq",
                "param": {"song_type": 0, "song_mid": mid},
            }
        }
    elif song_id:
        data = {
            "songinfo": {
                "module": "music.pf_song_detail_svr",
                "method": "get_song_detail",
                "param": {"song_id": int(song_id)},
            }
        }
    else:
        return {}
    try:
        j = qqmusic_transport.qq_musicu(data, cookie)
    except Exception:
        if strict:
            raise
        return {}
    if strict and (not isinstance(j, dict) or j.get('code') not in (0, '0', None)):
        raise RuntimeError('QQ 歌曲资料暂时无法读取，请稍后重试')
    node = j.get("songinfo") or {}
    if node.get("code") not in (0, None):
        if strict:
            raise RuntimeError('QQ 歌曲资料暂时无法读取，请稍后重试')
        return {}
    track = (node.get("data") or {}).get("track_info") or {}
    if strict and (not isinstance(track, dict) or not track or
                   (mid and str(track.get('mid') or track.get('songmid') or '') != str(mid)) or
                   (song_id and str(track.get('id') or '') != str(song_id))):
        raise RuntimeError('QQ 歌曲资料未能确认，请稍后重试')
    return track


def qq__from_track(track, source="musicu.fcg/get_song_detail_yqq"):
    """将 QQ 详情 track 转成统一歌曲字段，并保留 media_mid、音质大小及歌手元数据。
    interval 为秒；album.mid 生成封面；hash 兼容字段在此平台存 songmid。"""
    if not track:
        return {}
    album = track.get("album") or {}
    singers = track.get("singer") or []
    file_obj = track.get("file") or {}
    pay = track.get("pay") or {}
    return {
        "source": source,
        "title": track.get("name") or "",
        "author": "/".join([s.get("name") for s in singers if s.get("name")]),
        "album": album.get("name") or "",
        "album_id": str(album.get("id") or ""),
        "album_mid": album.get("mid") or "",
        "duration_s": round(float(track.get("interval") or 0), 3),
        "hash": track.get("mid") or "",
        "song_id": track.get("id") or 0,
        "media_mid": file_obj.get("media_mid") or track.get("mid") or "",
        "privilege": pay.get("pay_play"),
        "pay": pay,
        "sizes": qq__sizes_of(file_obj),
        "singers": [{"name": s.get("name"), "mid": s.get("mid")} for s in singers],
    }


def qq__from_row(row, source="musicu.fcg/DoSearchForQQMusicDesktop"):
    """搜索行 → 详情同形（search 行同样带 file.media_mid / pay）"""
    if not row:
        return {}
    album = row.get("album") or {}
    singers = row.get("singer") or []
    file_obj = row.get("file") or {}
    pay = row.get("pay") or {}
    return {
        "source": source,
        "title": row.get("name") or "",
        "author": "/".join([s.get("name") for s in singers if s.get("name")]),
        "album": album.get("name") or "",
        "album_id": str(album.get("id") or ""),
        "album_mid": album.get("mid") or "",
        "duration_s": round(float(row.get("interval") or 0), 3),
        "hash": row.get("mid") or "",
        "song_id": row.get("id") or 0,
        "media_mid": file_obj.get("media_mid") or row.get("mid") or "",
        "privilege": pay.get("pay_play"),
        "pay": pay,
        "sizes": qq__sizes_of(file_obj),
        "singers": [{"name": s.get("name"), "mid": s.get("mid")} for s in singers],
    }


def qq_search_body(keyword, page=1, size=30, stype=0, cookie=None):
    """返回 body（song/album/singer/songlist/mv 五类都在里面，按 search_type 只填一类）。"""
    size = max(1, min(50, int(size or 30)))
    data = {
        "comm": {
            "ct": "19",
            "cv": "1859",
            "uin": qqmusic_transport.qq_cookie_fields(cookie)["uin"] or "0",
        },
        "req": {
            "method": "DoSearchForQQMusicDesktop",
            "module": "music.search.SearchCgiService",
            "param": {
                "num_per_page": size,
                "page_num": max(1, int(page or 1)),
                "query": keyword,
                "search_type": int(stype),
            },
        },
    }
    key = qqmusic_config.qq_BODY_KEY.get(int(stype), "song")
    j = qqmusic_transport.qq_musicu(data, cookie)
    body = ((j.get("req") or {}).get("data") or {}).get("body") or {}
    rows = (body.get(key) or {}).get("list") or []
    if not rows and keyword.strip():
        time.sleep(2.5)
        j = qqmusic_transport.qq_musicu(data, cookie, retries=0)
        body = ((j.get("req") or {}).get("data") or {}).get("body") or {}
    return body


def qq_search_songs(keyword, limit=5, page=1, cookie=None):
    """从 QQ 桌面搜索结果提取歌曲列表，支持可选关键词、数量和页码。"""
    body = qq_search_body(keyword, page, limit, 0, cookie)
    out = []
    for s in (body.get("song") or {}).get("list") or []:
        meta = qq__from_row(s)
        out.append(
            {
                "mid": s.get("mid"),
                "name": s.get("name"),
                "singers": [x.get("name") for x in s.get("singer") or [] if x.get("name")],
                "album": (s.get("album") or {}).get("name"),
                "album_mid": (s.get("album") or {}).get("mid"),
                "duration_s": meta.get("duration_s") or 0,
                "pay_play": (s.get("pay") or {}).get("pay_play"),
                "cover": qq_cover_fields((s.get("album") or {}).get("mid"))["cover"],
            }
        )
    return out
