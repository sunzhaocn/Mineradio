"""平台适配：kugou / search。"""

import hashlib
from music_app.core.artists import fields as artist_fields
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from music_app.core import cache as core_cache
from music_app.core import request_credentials
from music_app.core import labels as core_labels
from music_app.core import results as core_results
from music_app.providers.kugou import metadata as kugou_metadata
from music_app.providers.kugou import quality as kugou_quality
from music_app.providers.kugou import transport as kugou_transport

kgs__CACHE, kgs__CACHE_TTL = ({}, 300)


def kgs_cached_search(keyword, page, pagesize):
    """酷狗搜索缓存入口；以关键词、页码和每页数量作为缓存键。"""
    key = (keyword, page, pagesize)
    return core_results.cached_result(
        kgs__CACHE,
        key,
        kgs__CACHE_TTL,
        lambda: kugou_transport.kgs_fetch_upstream(
            kugou_transport.kgs_build_upstream(keyword, page, pagesize)
        ),
    )


kgs_PLAY_API = (
    "https://trackercdn.kugou.com/i/v2/?key=%s&hash=%s&appid=1014&pid=2&cmd=25&behavior=play"
)


kgs__URL_CACHE, kgs__URL_TTL = ({}, 600)


def kgs_play_info(hash_, album_id=""):
    """hash → {url, ext}；先尝试匿名 tracker，取不到时使用已配置的酷狗登录态。

    搜索的 FileHash/HQFileHash/SQFileHash 分别代表 128k/320k/无损，不能跨档替换 hash。
    部分歌曲的匿名 tracker 返回空地址，但登录账号可通过 songinfo 获取对应档位。
    album_id 来自搜索结果的 AlbumID，登录态回退时必须与 hash 一起传入。
    回退仍使用平台正常的 Cookie/权限校验；没有权限或请求失败时返回 url=None。
    成功结果缓存 kgs__URL_TTL 秒；失败只缓存 60 秒，避免短暂异常导致长时间无法补链。
    """
    if not hash_:
        return {"url": None, "ext": None}
    cache_key = core_cache.credential_cache_key("kugou", (hash_, str(album_id or "")))
    cached_entry = kgs__URL_CACHE.get(cache_key)
    if cached_entry:
        ttl = kgs__URL_TTL if cached_entry[1].get("url") else 60
        if time.time() - cached_entry[0] < ttl:
            return cached_entry[1]
    key = hashlib.md5((hash_ + "kgcloudv2").encode()).hexdigest()
    info = {"url": None, "ext": None}
    try:
        request = urllib.request.Request(
            kgs_PLAY_API % (key, hash_), headers={"User-Agent": "Mozilla/5.0"}
        )
        with urllib.request.urlopen(request, timeout=10) as response:
            data = json.loads(response.read().decode("utf-8", "replace"))
        url = (data.get("url") or [None])[0]
        if url and url.startswith("http://"):
            url = "https://" + url[7:]
        info = {"url": url, "ext": data.get("extName") if url else None}
    except Exception:
        pass
    if not info["url"]:
        cookie_fields = kugou_transport.kg_cookie_fields()
        if cookie_fields["token"] and cookie_fields["uid"]:
            try:
                playback = kugou_quality.kg_play_url_of_quality(hash_, album_id)
                if playback.get("url"):
                    url = playback["url"]
                    extension = os.path.splitext(urllib.parse.urlparse(url).path)[1]
                    info = {"url": url, "ext": extension.lstrip(".").lower() or None}
            except Exception:
                pass
    kgs__URL_CACHE[cache_key] = (time.time(), info)
    return info


def kgs_song_page(s):
    """歌曲「音乐主页」：优先 mixsong/{EMixSongID}.html，缺失时退化为 hash 播放页。"""
    emix = s.get("EMixSongID")
    if emix:
        return "https://www.kugou.com/mixsong/%s.html" % emix
    return "https://www.kugou.com/song/#hash=%s&album_id=%s" % (s.get("FileHash"), s.get("AlbumID"))


def kgs_simple_view(data, with_url=False):
    """将酷狗搜索 data.lists 转为精简 songs 列表。
    with_url=True 时并发补播放信息；name/singer/hash/页面链接等字段保留供聚合搜索使用。"""
    d = data.get("data") or {}
    songs = []
    for s in d.get("lists") or []:
        songs.append(
            {
                "name": s.get("SongName"),
                "singer": s.get("SingerName"),
                **artist_fields(s.get('Singers') or s.get('singerinfo')),
                "album": s.get("AlbumName"),
                **kugou_metadata.kg__cover_fields(
                    s.get("Image")
                    or s.get("AlbumImage")
                    or (s.get("trans_param") or {}).get("union_cover")
                    or ""
                ),
                "duration": s.get("Duration"),
                "hash": s.get("FileHash"),
                "hash_320": s.get("HQFileHash"),
                "hash_sq": s.get("SQFileHash"),
                "album_id": s.get("AlbumID"),
                "album_audio_id": str(s.get("MixSongID") or s.get("AlbumAudioID") or ""),
                "mixsongid": str(s.get("MixSongID") or s.get("AlbumAudioID") or ""),
                "privilege": s.get("Privilege"),
                "pay_type": s.get("PayType"),
                "page": kgs_song_page(s),
                "emix_id": s.get("EMixSongID"),
                **core_labels.song_labels("kugou", s),
            }
        )
    if with_url and songs:

        def attach(item):
            for h, q in (
                (item["hash_sq"], "flac"),
                (item["hash_320"], "320"),
                (item["hash"], "128"),
            ):
                if not h:
                    continue
                info = kgs_play_info(h, item["album_id"])
                if info["url"]:
                    item["url"], item["quality"], item["ext"] = (info["url"], q, info["ext"])
                    return
            item["url"] = item["quality"] = item["ext"] = None

        with ThreadPoolExecutor(max_workers=8) as ex:
            request_credentials.map_with_context(ex, attach, songs)
    return {
        "error_code": data.get("error_code"),
        "total": d.get("total"),
        "page": d.get("page"),
        "pagesize": d.get("pagesize"),
        "songs": songs,
    }


kgs_KEY_ALIAS = ("search", "seach", "keyword", "k", "q", "wd")
