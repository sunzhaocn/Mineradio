"""从公开榜单缓存建立电台偏好元数据，不记录用户播放数据。"""

import json
import os
import re
from music_app.api import chart_cache, charts as api_charts, params as api_params


def radio_metadata():
    """公开歌曲所属榜单索引，供网页在本地推断曲风/地区偏好。

    只读取已经获取的完整榜单缓存，不接收用户收藏、播放记录或 Cookie。
    返回的是分类线索，不声称为歌曲的权威流派标签；具体权重在浏览器内计算。
    """

    def load():
        song_charts, artist_charts, indexed_charts = ({}, {}, set())
        try:
            files = list(os.scandir(chart_cache.CHART_CACHE_DIR))
        except OSError:
            files = []
        for entry in files:
            if not re.fullmatch(
                "(?:request-v2_public_)?tracks_(netease|qqmusic|kugou|qishui)_[A-Za-z0-9_-]+\\.json", entry.name
            ):
                continue
            try:
                with open(entry.path, encoding="utf-8") as stream:
                    payload = json.load(stream)
                chart = payload.get("chart") or {}
                name = chart.get("name") or ""
                if not payload.get("complete") or not api_charts.chart_allowed(
                    name, chart.get("category", "")
                ):
                    continue
                indexed_charts.add((chart.get("platform"), chart.get("id")))
                for song in payload.get("songs") or []:
                    for source in song.get("sources") or []:
                        if source.get("platform") in api_params.PLATFORM_IDS and source.get("key"):
                            key = "%s:%s" % (source["platform"], source["key"])
                            song_charts.setdefault(key, set()).add(name)
                    for artist in song.get("artists") or [song.get("artist") or ""]:
                        for part in re.split("[/、,&，]+", artist):
                            if part.strip():
                                artist_charts.setdefault(part.strip(), set()).add(name)
            except (OSError, ValueError, TypeError, AttributeError):
                continue
        return {
            "song_charts": {key: sorted(value) for key, value in song_charts.items()},
            "artist_charts": {key: sorted(value) for key, value in artist_charts.items()},
            "songs_indexed": len(song_charts),
            "charts_indexed": len(indexed_charts),
            "complete": True,
        }

    return chart_cache.chart_cached("radio_metadata", 300, load)
