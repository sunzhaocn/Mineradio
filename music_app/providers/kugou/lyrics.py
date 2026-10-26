"""平台适配：kugou / lyrics。"""

import base64
import json
import re
import urllib.error
import urllib.parse
import urllib.request
import zlib
from music_app.api import views as api_views
from music_app.providers.kugou import config as kugou_config
from music_app.providers.kugou import transport as kugou_transport


def kg_lyric_search(song_hash, duration=0, keyword=""):
    """对应酷狗歌词 search 接口；输入歌曲 hash、时长和可选关键词，返回候选列表。
    排序规则为官方歌词优先，其次 score 降序；请求失败返回空列表。"""
    q = urllib.parse.urlencode(
        {
            "ver": "1",
            "man": "yes",
            "client": "mobi",
            "keyword": keyword,
            "duration": str(duration or ""),
            "hash": song_hash,
        }
    )
    try:
        js = kugou_transport.kg_http_json(kugou_config.kg_LYRIC_SEARCH + "?" + q)
    except Exception:
        return []
    cands = js.get("candidates") or []

    def rank(c):
        official = 0 if "官方" in (c.get("product_from") or "") or c.get("krctype") == 1 else 1
        return (official, -int(c.get("score") or 0))

    return sorted(cands, key=rank)


def kg_lyric_download(cand, fmt):
    """对应酷狗歌词 download 接口；cand 提供歌词 id/accesskey，fmt 指定 lrc 或 krc。
    将响应中的 Base64 content 解码为字节，后续再按歌词格式处理。"""
    url = "%s?ver=1&client=pc&id=%s&accesskey=%s&fmt=%s&charset=utf8" % (
        kugou_config.kg_LYRIC_DOWNLOAD,
        cand["id"],
        cand["accesskey"],
        fmt,
    )
    content = kugou_transport.kg_http_json(url).get("content") or ""
    return base64.b64decode(content) if content else b""


def kg_get_lrc(song_hash, duration=0, keyword=""):
    """只获取酷狗原文 LRC：最多尝试前三个候选，首个非空结果按 UTF-8 解码。"""
    for c in kg_lyric_search(song_hash, duration, keyword)[:3]:
        try:
            raw = kg_lyric_download(c, "lrc")
        except Exception:
            continue
        if raw:
            return raw.decode("utf-8", "replace")
    return ""


def kg_get_lyric(song_hash, duration=0, keyword=""):
    """获取酷狗多语种歌词：先搜索候选，再尝试前三个候选的 LRC。
    另从首个候选下载 KRC，用其 language 段补翻译 tlyric 和罗马音 roma；
    krc 保留原始字节供逐字歌词处理。单次下载失败会继续或保留已有结果。"""
    out = {"lrc": "", "tlyric": "", "roma": "", "title": "", "singer": "", "id": "", "krc": b""}
    cands = kg_lyric_search(song_hash, duration, keyword)
    if not cands:
        return out
    c = cands[0]
    out.update(
        {"title": c.get("song") or "", "singer": c.get("singer") or "", "id": c.get("id") or ""}
    )
    for cand in cands[:3]:
        try:
            raw = kg_lyric_download(cand, "lrc")
        except Exception:
            continue
        if raw:
            out["lrc"] = raw.decode("utf-8", "replace")
            out["id"] = cand.get("id") or out["id"]
            break
    try:
        out["krc"] = kg_lyric_download(c, "krc")
    except Exception:
        pass
    if out["krc"]:
        out["tlyric"], out["roma"] = kg_multilang_lyrics(kg_krc_decode(out["krc"]), out["lrc"])
    return out


def kg_krc_decode(buf):
    """将酷狗 KRC 二进制还原成文本：校验 krc1 文件头 → 循环异或 → zlib 解压。
    格式不符或解压失败返回空串；这里只解码，不解析逐字时间。"""
    if not buf or buf[:4] != b"krc1":
        return ""
    body = bytearray(buf[4:])
    for i in range(len(body)):
        body[i] ^= kugou_config.kg_KRC_TAB[i % 16]
    try:
        return zlib.decompress(bytes(body)).decode("utf-8", "replace")
    except Exception:
        return ""


def kg_krc_words(buf):
    """将 KRC 文本中的 [行起点,行时长]<字偏移,字时长,...> 解析为逐字时间表。
    返回每行 start_ms/dur_ms/text/words；所有时间单位均为毫秒。"""
    rows = []
    for ln in kg_krc_decode(buf).splitlines():
        m = re.match("\\[(\\d+),(\\d+)\\](.*)", ln.strip())
        if not m:
            continue
        st, dur, body = (int(m.group(1)), int(m.group(2)), m.group(3))
        words = [
            {"offset": int(w[0]), "dur": int(w[1]), "text": w[3]}
            for w in re.findall("<(\\d+),(\\d+),(\\d+)>([^<]*)", body)
        ]
        txt = "".join((w["text"] for w in words)) if words else re.sub("<[^>]*>", "", body)
        if txt:
            rows.append({"start_ms": st, "dur_ms": dur, "text": txt, "words": words})
    return rows


def kg_krc_times(krc_text):
    """读取 KRC 每行的起始时间，返回整数毫秒列表；由 kg_rows_to_lrc 转成 LRC 时间标签。"""
    times = []
    for ln in (krc_text or "").splitlines():
        m = re.match("\\[(\\d+),(\\d+)\\]", ln.strip())
        if m:
            times.append(int(m.group(1)))
    return times


def kg_language_tracks(krc_text):
    """解析 KRC 的 [language:Base64] JSON 段，提取 type 和逐行文本 rows。
    忽略解码失败的段；type 通常用于区分罗马音与翻译，最终判断见 kg_multilang_lyrics。"""
    tracks = []
    for ln in (krc_text or "").splitlines():
        s = ln.strip()
        if not s.startswith("[language:"):
            continue
        b64 = s[len("[language:") :].rstrip("]").strip()
        try:
            doc = json.loads(base64.b64decode(b64 + "=" * (-len(b64) % 4)).decode("utf-8"))
        except Exception:
            continue
        for item in doc.get("content") or []:
            rows = [
                "".join((w for w in row if isinstance(w, str))).strip()
                for row in item.get("lyricContent") or []
            ]
            if any(rows):
                tracks.append({"type": item.get("type"), "rows": rows})
    return tracks


def kg_rows_to_lrc(rows, times):
    """把某语种的逐行文本与 KRC 时间列表配对，合成为 LRC；空行跳过。"""
    out = []
    for i, txt in enumerate(rows):
        if not txt:
            continue
        if i < len(times):
            ms = times[i]
            out.append("[%02d:%02d.%03d]%s" % (ms // 60000, ms // 1000 % 60, ms % 1000, txt))
        else:
            out.append(txt)
    return "\n".join(out)


def kg_multilang_lyrics(krc_text, original_lrc):
    """从 krc 抽翻译(tlyric)和罗马音(roma)；没有就给空串。"""
    tlyric = roma = ""
    tracks = kg_language_tracks(krc_text)
    if not tracks:
        return (tlyric, roma)
    times = kg_krc_times(krc_text)
    lang_o = api_views.detect_lang(original_lrc)
    for tr in tracks:
        text = kg_rows_to_lrc(tr["rows"], times)
        lang = api_views.detect_lang("".join(tr["rows"]))
        is_roman = tr["type"] == 0 or (lang == "en" and lang_o not in ("en", "und"))
        if not is_roman and (tr["type"] == 1 or lang != lang_o):
            tlyric = tlyric or text
        elif is_roman:
            roma = roma or text
        elif not tlyric:
            tlyric = text
    return (tlyric, roma)
