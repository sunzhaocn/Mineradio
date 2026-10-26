"""平台适配：qqmusic / search。"""

import json
import time
import urllib.error
import urllib.parse
import urllib.request
from music_app.core import results as core_results
from music_app.providers.qqmusic import config as qqmusic_config
from music_app.providers.qqmusic import search_play as qqmusic_search_play
from music_app.providers.qqmusic import search_transport as qqmusic_search_transport
from music_app.providers.qqmusic import search_views as qqmusic_search_views


def qqs_search_payload(keyword, page=1, size=30, stype=0, cookie=None):
    """构造 QQ 桌面搜索 RPC 请求体；stype 使用 QQ 上游类型编号，非 HTTP 层的通用编号。"""
    return {
        "comm": {
            "ct": "19",
            "cv": "1859",
            "uin": qqmusic_search_transport.qqs_cookie_fields(cookie)["uin"] or "0",
        },
        "req": {
            "method": "DoSearchForQQMusicDesktop",
            "module": "music.search.SearchCgiService",
            "param": {
                "num_per_page": max(1, min(qqmusic_config.qqs_MAX_SIZE, int(size or 30))),
                "page_num": max(1, int(page or 1)),
                "query": keyword,
                "search_type": int(stype),
            },
        },
    }


def qqs_build_upstream(keyword, page=1, size=30, stype=0):
    """可直接重放的 GET URL（musicu.fcg 认 ?data=）"""
    return (
        qqmusic_config.qqs_MUSICU
        + "?format=json&data="
        + urllib.parse.quote(
            json.dumps(
                qqs_search_payload(keyword, page, size, stype),
                ensure_ascii=False,
                separators=(",", ":"),
            )
        )
        + "&g_tk=5381"
    )


def qqs_fetch_search(keyword, page=1, size=30, stype=0, cookie=None):
    """返回上游 body（五类都在里面，search_type 只填一类）；空结果自动重试一次。"""
    key_body = qqmusic_config.qqs_BODY_KEY.get(int(stype), "song")
    data = qqs_search_payload(keyword, page, size, stype, cookie)
    j = qqmusic_search_transport.qqs_musicu(data, cookie)
    envelope = 'req'
    if (j.get('req') or {}).get('code') == 2001:
        # Some current gateways reject the historical req/comm envelope but
        # accept the public module-named envelope for the same search method.
        envelope = 'music.search.SearchCgiService'
        data = {envelope: data['req']}
        j = qqmusic_search_transport.qqs_musicu(data, cookie)
    body = ((j.get(envelope) or {}).get("data") or {}).get("body") or {}
    if not ((body.get(key_body) or {}).get("list") or []) and keyword.strip():
        time.sleep(2.5)
        j = qqmusic_search_transport.qqs_musicu(data, cookie)
        body = ((j.get(envelope) or {}).get("data") or {}).get("body") or {}
    body["_code"] = (j.get(envelope) or {}).get("code")
    body["_raw_code"] = j.get("code")
    return body


qqs__SRCH_CACHE, qqs__SRCH_TTL = ({}, 300)


def qqs_cached_search(keyword, page, size, stype, cookie=None):
    """QQ 搜索缓存入口；键含关键词、分页、上游类型以及是否有 uin。
    沿用原规则，只区分游客与登录，不按具体账号区分。"""
    key = (
        keyword,
        page,
        size,
        stype,
        bool(qqmusic_search_transport.qqs_cookie_fields(cookie)["uin"]),
    )
    return core_results.cached_result(
        qqs__SRCH_CACHE, key, qqs__SRCH_TTL, qqs_fetch_search, keyword, page, size, stype, cookie
    )


def qqs_simple_view(body, keyword, stype, page, size, with_play=False, level="128", cookie=None):
    """按 stype 选择 QQ 行转换器，生成对应的歌曲/专辑/歌手/歌单/MV 精简结果。
    歌曲且 with_play=True 时并发补播放地址；level 的默认值为 128。"""
    up = qqmusic_config.qqs_TYPE_UPSTREAM.get(stype, 0)
    rows_raw = (body.get(qqmusic_config.qqs_BODY_KEY.get(up, "song")) or {}).get("list") or []
    builder = qqmusic_search_views.qqs_ROW_BUILDER.get(up, qqmusic_search_views.qqs_song_row)
    rows = [builder(s) for s in rows_raw]
    out = {
        "code": 200 if rows_raw else body.get("_code") or 0,
        "keyword": keyword,
        "type": stype,
        "type_name": qqmusic_config.qqs_TYPE_NAME.get(stype, str(stype)),
        "page": page,
        "pagesize": len(rows_raw),
        "count": len(rows_raw),
        "songs": [],
        "items": [],
    }
    if up == 0:
        if with_play:
            qqmusic_search_play.qqs_attach_play(rows, level=level, cookie=cookie)
        out["songs"] = rows
    else:
        out["items"] = rows
    return out


qqs_KEY_ALIAS = ("search", "seach", "keyword", "k", "q", "wd", "w", "s")


def qqs_type_of(w):
    """解析 QQ 搜索对象类型，返回通用编号：1 歌曲、10 专辑、100 歌手、1000 歌单、1004 MV。
    支持 qqs_TYPE_WORD 中的英文别名；其他输入回退 1。
    本函数不把数字 0～4 当作上游类型直接透传；映射发生在 qq_search/qq_link。"""
    w = (w or "1").strip().lower()
    if w in qqmusic_config.qqs_TYPE_WORD:
        return qqmusic_config.qqs_TYPE_WORD[w]
    try:
        n = int(w)
    except ValueError:
        return 1
    if n in qqmusic_config.qqs_TYPE_UPSTREAM:
        return n
    return 1
