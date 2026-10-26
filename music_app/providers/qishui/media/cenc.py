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

from .mp4 import _Box, _boxes, _one, _uint, _fullbox, _sample_entry, _sample_sizes, _sample_ranges

try:
    from music_app.runtime_crypto import AES as _AES
except ImportError:
    _AES = None

def is_available() -> bool:
    """Return whether a platform-compatible AES implementation is available."""
    return _AES is not None


def _sample_encryption(
    data: bytes, senc: _Box, sizes: list[int], iv_size: int
) -> list[tuple[bytes, list[tuple[int, int]] | None]]:
    version, flags = _fullbox(data, senc)
    if version not in (0, 1) or flags & ~2:
        raise ValueError("Unsupported sample encryption version or flags.")
    count = _uint(data, senc.payload + 4, 4, senc.end)
    if count != len(sizes):
        raise ValueError("MP4 encryption and sample counts do not match.")
    position = senc.payload + 8
    encryption = []
    for size in sizes:
        if position + iv_size > senc.end:
            raise ValueError("Truncated sample encryption IV.")
        iv = data[position : position + iv_size]
        position += iv_size
        pairs = None
        if flags & 2:
            pair_count = _uint(data, position, 2, senc.end)
            position += 2
            if not pair_count:
                raise ValueError("Empty subsample encryption records are unsupported.")
            if position + 6 * pair_count > senc.end:
                raise ValueError("Truncated subsample encryption table.")
            pairs = []
            total = 0
            for _ in range(pair_count):
                clear = _uint(data, position, 2, senc.end)
                encrypted = _uint(data, position + 2, 4, senc.end)
                position += 6
                total += clear + encrypted
                pairs.append((clear, encrypted))
            if total != size:
                raise ValueError("Subsample lengths do not match the MP4 sample.")
        encryption.append((iv, pairs))
    if position != senc.end:
        raise ValueError("Unexpected sample encryption payload length.")
    return encryption


def decrypt_mp4(data: bytes, key: bytes) -> tuple[bytes, str]:
    """Decrypt a nonfragmented, single-audio-track CENC AES-128-CTR MP4.

    Returns ``(clear_mp4_bytes, 'aac' or 'flac')``. The output remains an MP4
    container, including when its audio codec is FLAC. Eight- and sixteen-byte
    IVs follow tenc.default_Per_Sample_IV_Size; absent tenc defaults to eight.
    Subsample clear regions are preserved and only protected bytes consume CTR
    keystream. Unsupported modes and malformed containers raise fixed ValueError
    messages. A missing AES dependency raises a fixed RuntimeError.
    """
    if not isinstance(data, bytes) or not data:
        raise ValueError("MP4 input must be nonempty bytes.")
    if not isinstance(key, bytes) or len(key) != 16:
        raise ValueError("An AES-128 key of exactly sixteen bytes is required.")
    if _AES is None:
        raise RuntimeError("AES support is unavailable.")
    top = _boxes(data, 0, len(data))
    if any(box.kind == b"moof" for box in top):
        raise ValueError("Fragmented MP4 files are unsupported.")
    moov = _one(top, b"moov")
    movie = _boxes(data, moov.payload, moov.end)
    if any(box.kind == b"mvex" for box in movie):
        raise ValueError("Fragmented MP4 files are unsupported.")
    tracks = [box for box in movie if box.kind == b"trak"]
    if len(tracks) != 1:
        raise ValueError("Only a single audio track is supported.")
    mdats = [box for box in top if box.kind == b"mdat"]
    if not mdats:
        raise ValueError("Missing MP4 media data.")
    track = tracks[0]
    mdia = _one(_boxes(data, track.payload, track.end), b"mdia")
    media = _boxes(data, mdia.payload, mdia.end)
    handler = _one(media, b"hdlr")
    if handler.end - handler.payload < 12 or data[handler.payload + 8 : handler.payload + 12] != b"soun":
        raise ValueError("Only an audio track is supported.")
    minf = _one(media, b"minf")
    stbl = _one(_boxes(data, minf.payload, minf.end), b"stbl")
    tables = _boxes(data, stbl.payload, stbl.end)
    for box in tables:
        if box.kind in (b"sgpd", b"sbgp") and data[box.payload + 4 : box.payload + 8] == b"seig":
            raise ValueError("Per-sample encryption overrides are unsupported.")
    entry, codec, iv_size = _sample_entry(data, _one(tables, b"stsd"))
    sizes = _sample_sizes(data, _one(tables, b"stsz"), sum(box.end - box.payload for box in mdats))
    ranges = _sample_ranges(data, tables, sizes, mdats)
    encryption = _sample_encryption(data, _one(tables, b"senc"), sizes, iv_size)
    output = bytearray(data)
    for (start, end), (iv, pairs) in zip(ranges, encryption):
        try:
            cipher = _AES.new(
                key,
                _AES.MODE_CTR,
                nonce=b"",
                initial_value=int.from_bytes(iv.ljust(16, b"\0"), "big"),
            )
            if pairs is None:
                output[start:end] = cipher.decrypt(data[start:end])
            else:
                position = start
                for clear, encrypted in pairs:
                    position += clear
                    if encrypted:
                        output[position : position + encrypted] = cipher.decrypt(data[position : position + encrypted])
                    position += encrypted
        except (ValueError, OverflowError, TypeError):
            raise ValueError("AES-CTR sample decryption failed.") from None
    output[entry.start + 4 : entry.start + 8] = b"fLaC" if codec == "flac" else b"mp4a"
    return bytes(output), codec
