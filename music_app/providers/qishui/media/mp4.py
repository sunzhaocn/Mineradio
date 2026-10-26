"""Offline decoding for SodaMusic PlayAuth and single-track CENC audio MP4.

No network access, file access, logging, or native application calls occur here.
``decrypt_mp4`` preserves the MP4 layout and returns a new byte string.

The PlayAuth transform and CENC interoperability approach were derived from
https://github.com/520Qiuyu/qishui-decrypt-tool at commit
f295639fb2280c74f1c11189c4afefad4743116a (lib/decode-spade.js, lib/cenc.js).
This implementation independently validates and parses the supported MP4 subset.

Upstream MIT License
Copyright (c) 2026 qiuyu

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
"""

from __future__ import annotations

from bisect import bisect_right
from dataclasses import dataclass

@dataclass(frozen=True, slots=True)
class _Box:
    kind: bytes
    start: int
    payload: int
    end: int


def _boxes(data: bytes, start: int, end: int) -> list[_Box]:
    result = []
    position = start
    while position < end:
        if end - position < 8:
            raise ValueError("Truncated MP4 box header.")
        size = int.from_bytes(data[position : position + 4], "big")
        kind = data[position + 4 : position + 8]
        header = 8
        if size == 1:
            if end - position < 16:
                raise ValueError("Truncated extended MP4 box header.")
            size = int.from_bytes(data[position + 8 : position + 16], "big")
            header = 16
        elif size == 0:
            size = end - position
        if kind == b"uuid":
            header += 16
        if size < header or size > end - position:
            raise ValueError("Invalid MP4 box size.")
        result.append(_Box(kind, position, position + header, position + size))
        position += size
    return result


def _one(boxes: list[_Box], kind: bytes, *, required: bool = True) -> _Box | None:
    matches = [box for box in boxes if box.kind == kind]
    if len(matches) > 1:
        raise ValueError("Duplicate MP4 metadata box.")
    if not matches:
        if required:
            raise ValueError("Missing required MP4 metadata box.")
        return None
    return matches[0]


def _uint(data: bytes, position: int, size: int, end: int) -> int:
    if position < 0 or position + size > end:
        raise ValueError("Truncated MP4 metadata.")
    return int.from_bytes(data[position : position + size], "big")


def _fullbox(data: bytes, box: _Box) -> tuple[int, int]:
    value = _uint(data, box.payload, 4, box.end)
    return value >> 24, value & 0xFFFFFF


def _ordinary_fullbox(data: bytes, box: _Box) -> None:
    if _fullbox(data, box) != (0, 0):
        raise ValueError("Unsupported MP4 table version or flags.")


def _sample_entry(data: bytes, stsd: _Box) -> tuple[_Box, str, int]:
    _ordinary_fullbox(data, stsd)
    count = _uint(data, stsd.payload + 4, 4, stsd.end)
    entries = _boxes(data, stsd.payload + 8, stsd.end)
    if count != len(entries) or count != 1:
        raise ValueError("Multiple or invalid MP4 sample descriptions are unsupported.")
    entry = entries[0]
    if entry.kind != b"enca":
        raise ValueError("An encrypted audio sample entry is required.")
    version = _uint(data, entry.payload + 8, 2, entry.end)
    extension = {0: 0, 1: 16, 2: 36}.get(version)
    if extension is None:
        raise ValueError("Unsupported audio sample entry version.")
    children_start = entry.payload + 28 + extension
    if children_start > entry.end:
        raise ValueError("Truncated audio sample entry.")
    children = _boxes(data, children_start, entry.end)
    has_flac = _one(children, b"dfLa", required=False) is not None
    sinf = _one(children, b"sinf", required=False)
    format_code = None
    iv_size = 8
    if sinf is not None:
        protection = _boxes(data, sinf.payload, sinf.end)
        frma = _one(protection, b"frma", required=False)
        if frma is not None:
            if frma.end - frma.payload != 4:
                raise ValueError("Invalid original audio format box.")
            format_code = data[frma.payload : frma.end]
        schm = _one(protection, b"schm", required=False)
        if schm is not None:
            version_flags = _fullbox(data, schm)
            if version_flags[0] != 0 or version_flags[1] not in (0, 1):
                raise ValueError("Unsupported encryption scheme metadata.")
            if schm.end - schm.payload < 12 or data[schm.payload + 4 : schm.payload + 8] != b"cenc":
                raise ValueError("Only CENC AES-CTR encryption is supported.")
        schi = _one(protection, b"schi", required=False)
        if schi is not None:
            tenc = _one(_boxes(data, schi.payload, schi.end), b"tenc", required=False)
            if tenc is not None:
                version, flags = _fullbox(data, tenc)
                if version not in (0, 1) or flags or tenc.end - tenc.payload != 24:
                    raise ValueError("Unsupported track encryption metadata.")
                pattern = _uint(data, tenc.payload + 5, 1, tenc.end)
                protected = _uint(data, tenc.payload + 6, 1, tenc.end)
                iv_size = _uint(data, tenc.payload + 7, 1, tenc.end)
                if pattern or protected != 1 or iv_size not in (8, 16):
                    raise ValueError("Unsupported track encryption mode or IV size.")
    if format_code is not None and format_code not in (b"mp4a", b"fLaC"):
        raise ValueError("Unsupported original audio codec.")
    if format_code == b"mp4a" and has_flac:
        raise ValueError("Conflicting audio codec metadata.")
    codec = "flac" if format_code == b"fLaC" or has_flac else "aac"
    return entry, codec, iv_size


def _sample_sizes(data: bytes, stsz: _Box, mdat_bytes: int) -> list[int]:
    _ordinary_fullbox(data, stsz)
    fixed_size = _uint(data, stsz.payload + 4, 4, stsz.end)
    count = _uint(data, stsz.payload + 8, 4, stsz.end)
    if count == 0 or count > mdat_bytes:
        raise ValueError("Invalid MP4 sample count.")
    expected = stsz.payload + 12 + (0 if fixed_size else 4 * count)
    if expected != stsz.end:
        raise ValueError("Invalid MP4 sample size table.")
    if fixed_size:
        if fixed_size * count > mdat_bytes:
            raise ValueError("MP4 samples exceed media data.")
        return [fixed_size] * count
    sizes = [
        _uint(data, stsz.payload + 12 + 4 * i, 4, stsz.end)
        for i in range(count)
    ]
    if any(size == 0 for size in sizes) or sum(sizes) > mdat_bytes:
        raise ValueError("Invalid MP4 sample sizes.")
    return sizes


def _sample_ranges(
    data: bytes, tables: list[_Box], sizes: list[int], mdats: list[_Box]
) -> list[tuple[int, int]]:
    offset_tables = [box for box in tables if box.kind in (b"stco", b"co64")]
    if len(offset_tables) != 1:
        raise ValueError("A single MP4 chunk offset table is required.")
    offsets_box = offset_tables[0]
    _ordinary_fullbox(data, offsets_box)
    chunk_count = _uint(data, offsets_box.payload + 4, 4, offsets_box.end)
    width = 8 if offsets_box.kind == b"co64" else 4
    if not chunk_count or offsets_box.payload + 8 + width * chunk_count != offsets_box.end:
        raise ValueError("Invalid MP4 chunk offset table.")
    stsc = _one(tables, b"stsc")
    _ordinary_fullbox(data, stsc)
    map_count = _uint(data, stsc.payload + 4, 4, stsc.end)
    if not map_count or stsc.payload + 8 + 12 * map_count != stsc.end:
        raise ValueError("Invalid MP4 chunk mapping table.")
    mappings = []
    for i in range(map_count):
        position = stsc.payload + 8 + i * 12
        first = _uint(data, position, 4, stsc.end)
        per_chunk = _uint(data, position + 4, 4, stsc.end)
        description = _uint(data, position + 8, 4, stsc.end)
        if not per_chunk or description != 1 or not 1 <= first <= chunk_count:
            raise ValueError("Unsupported or invalid MP4 chunk mapping.")
        if (i == 0 and first != 1) or (mappings and first <= mappings[-1][0]):
            raise ValueError("Invalid MP4 chunk mapping order.")
        mappings.append((first, per_chunk))
    expected_count = sum(
        ((mappings[i + 1][0] if i + 1 < len(mappings) else chunk_count + 1) - first) * per_chunk
        for i, (first, per_chunk) in enumerate(mappings)
    )
    if expected_count != len(sizes):
        raise ValueError("MP4 chunk and sample counts do not match.")
    ranges = []
    media_starts = [box.payload for box in mdats]
    sample_index = 0
    mapping_index = 0
    for chunk in range(chunk_count):
        while mapping_index + 1 < len(mappings) and chunk + 1 >= mappings[mapping_index + 1][0]:
            mapping_index += 1
        position = _uint(data, offsets_box.payload + 8 + chunk * width, width, offsets_box.end)
        for _ in range(mappings[mapping_index][1]):
            end = position + sizes[sample_index]
            media_index = bisect_right(media_starts, position) - 1
            if media_index < 0 or not position < end <= mdats[media_index].end:
                raise ValueError("An MP4 sample lies outside media data.")
            ranges.append((position, end))
            position = end
            sample_index += 1
    ordered = sorted(ranges)
    if any(ordered[i][0] < ordered[i - 1][1] for i in range(1, len(ordered))):
        raise ValueError("Overlapping MP4 sample ranges are unsupported.")
    return ranges
