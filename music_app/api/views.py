"""音质、歌词和歌曲响应视图。"""

import re


def quality_summary(r):
    """从已经按高到低排列的 qualities 构建 quality_options 和 best_*。
    只有 available 为真且 url 非空才算可播放；首个满足条件的档位标记 is_best。
    不按 bitrate 再排序，也不发起网络探测；供详情、/qualities 和 /best 共用。"""
    opts = []
    for q in r.get("qualities") or []:
        opts.append(
            {
                "key": q.get("key") or "",
                "quality": q.get("quality") or "",
                "available": bool(q.get("available")),
                "bitrate": q.get("bitrate"),
                "filesize": q.get("filesize"),
                "encode": q.get("encode") or "",
                "url": q.get("url") or "",
                "is_best": False,
            }
        )
    best = None
    for o in opts:
        if o["available"] and o["url"]:
            o["is_best"] = True
            best = o
            break
    return {
        "best_quality": best["quality"] if best else "",
        "best_quality_key": best["key"] if best else "",
        "best_bitrate": best["bitrate"] if best else None,
        "best_filesize": best["filesize"] if best else None,
        "best_url": best["url"] if best else "",
        "quality_options": opts,
        "quality_hint": "选某一档: ?quality=<key>；取最高: ?quality=best（默认 auto 就是最高可用）",
    }


def add_quality(out, r):
    """把 quality_summary 结果合并到响应 out 中并返回 out；会原地修改响应字典。"""
    out.update(quality_summary(r))
    out.setdefault("quality_key", r.get("quality_key") or "")
    out.setdefault("requested_quality", r.get("requested_quality") or "")
    return out


def detect_lang(text):
    """粗略判断歌词主体语言：ja / zh / ko / en / ru / und。"""
    kana = han = hangul = latin = cyr = 0
    for ch in text or "":
        o = ord(ch)
        if 12352 <= o <= 12543:
            kana += 1
        elif 13312 <= o <= 19903 or 19968 <= o <= 40959:
            han += 1
        elif 44032 <= o <= 55215:
            hangul += 1
        elif 1024 <= o <= 1279:
            cyr += 1
        elif "a" <= ch.lower() <= "z":
            latin += 1
    if kana:
        return "ja"
    if hangul:
        return "ko"
    if han and han >= latin:
        return "zh"
    if cyr:
        return "ru"
    if latin:
        return "en"
    return "und"


def _line_count(text):
    """统计歌词非空行数量；包含元信息行，因此不是精确的有效歌词句数。"""
    return len([x for x in (text or "").splitlines() if x.strip()])


def _lyric_body_lines(text):
    """去掉 [ti:]/[ar:] 这类头和时间戳，只留正文行，用于判断「翻译是不是占位符」。"""
    rows = []
    for ln in (text or "").splitlines():
        s = ln.strip()
        if not s:
            continue
        m = re.match("^\\[[\\d:\\.]{4,}\\]\\s*(.*)$", s)
        if m:
            rows.append(m.group(1).strip())
        elif not s.startswith("["):
            rows.append(s)
    return rows


def lyric_info(r):
    """把 r 里的原文/翻译/罗马音整理成「有哪些语种」+ 三个完整 LRC。"""
    orig = (r.get("lrc") or "").strip()
    trans = (r.get("tlyric") or r.get("trans") or "").strip()
    roma = (r.get("roma") or "").strip()
    kana = (r.get("kana") or "").strip()
    t_body = _lyric_body_lines(trans)
    if t_body and (all((x == "//" for x in t_body)) or t_body == _lyric_body_lines(orig)):
        trans = ""
    lang_o = detect_lang("\n".join(_lyric_body_lines(orig)))
    lang_t = detect_lang("\n".join(_lyric_body_lines(trans))) if trans else ""
    lang_r = (
        ("ja-Latn" if lang_o == "ja" else "zh-Latn" if lang_o == "zh" else "en") if roma else ""
    )
    variants = []
    if orig:
        variants.append(
            {"role": "original", "lang": lang_o, "lines": _line_count(orig), "format": "lrc"}
        )
    if trans:
        variants.append(
            {"role": "translation", "lang": lang_t, "lines": _line_count(trans), "format": "lrc"}
        )
    if roma:
        variants.append(
            {"role": "roman", "lang": lang_r, "lines": _line_count(roma), "format": "lrc"}
        )
    return {
        "tlyric": trans,
        "roma": roma,
        "kana": kana,
        "has_translation": bool(trans),
        "has_roman": bool(roma),
        "lyric_langs": {"original": lang_o, "translation": lang_t, "roman": lang_r},
        "lyric_variants": variants,
    }


def add_lyrics(out, r):
    """将整理后的翻译/罗马音/语种信息合并进 out，并补 lrc 原文；原地修改 out。"""
    out.update(lyric_info(r))
    return out


def music_response(result, path, simple, simple_view):
    """把平台歌曲结果转换为对应路径的响应，返回 (HTTP 状态码, 内容)。

    result 已完成平台查询；这里不请求上游，也不重新选择音质。
    /qualities 返回全部档位；/best 返回最高可用档；/lyric 返回多语种歌词；
    /stream 返回内部 _location，交给 Handler 转成 Location 响应头。
    其他歌曲路径返回详情；simple_view 是调用平台自己的精简字段转换函数。
    """
    if path == "/qualities":
        body = {
            "title": result["title"],
            "hash": result["hash"],
            "qualities": result["qualities"],
            "error": result["error"],
        }
        return (200, add_quality(body, result))
    if path == "/best":
        summary = quality_summary(result)
        return (
            200,
            {
                "title": result["title"],
                "author": result["author"],
                "hash": result["hash"],
                "quality": summary["best_quality"],
                "quality_key": summary["best_quality_key"],
                "bitrate": summary["best_bitrate"],
                "filesize": summary["best_filesize"],
                "url": summary["best_url"] or (result["url"] or result["backup_url"]),
                "quality_options": summary["quality_options"],
                "error": result["error"],
            },
        )
    if path == "/lyric":
        body = {
            "title": result["title"],
            "lyric_id": result["lyric_id"],
            "lines": result["lrc_lines"],
            "lrc": result["lrc"],
            "trans": result.get("tlyric") or result.get("trans", ""),
            "error": result["error"],
        }
        return (200, add_lyrics(body, result))
    if path == "/stream":
        url = result["url"] or result["backup_url"]
        if not url:
            return (404, {"error_code": 404, "msg": "该音质无直链", "error": result["error"]})
        return (302, {"_location": url})
    body = simple_view(result) if simple else dict(result)
    add_lyrics(body, result)
    return (200, add_quality(body, result))
