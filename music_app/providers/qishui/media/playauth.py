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

import base64
import binascii

def decode_spade(value: str | bytes) -> bytes:
    """Decode a PlayAuth/spade_a value into a 16-byte AES key.

    Whitespace, unpadded Base64, and the URL-safe Base64 alphabet are accepted.
    Invalid input raises ValueError with a fixed message, never the input/key.
    This operation does not require PyCryptodome.
    """
    if not isinstance(value, (str, bytes)):
        raise ValueError("Invalid PlayAuth value.")
    try:
        encoded = value.encode("ascii") if isinstance(value, str) else value
        encoded = b"".join(encoded.split()).replace(b"-", b"+").replace(b"_", b"/")
        if len(encoded) % 4 == 1:
            raise ValueError
        raw = base64.b64decode(encoded + b"=" * (-len(encoded) % 4), validate=True)
    except (ValueError, UnicodeError, binascii.Error):
        raise ValueError("Invalid PlayAuth encoding.") from None
    if len(raw) < 3:
        raise ValueError("Invalid PlayAuth payload.")
    padding = (raw[0] ^ raw[1] ^ raw[2]) - 48
    if padding < 0 or padding > len(raw) - 2:
        raise ValueError("Invalid PlayAuth padding.")
    inner = raw[1 : len(raw) - padding]
    decoded = bytearray(len(inner))
    for i, byte in enumerate(inner):
        previous = (0xFA, 0x55)[i] if i < 2 else inner[i - 2]
        number = (byte ^ previous) - i.bit_count() - 21
        decoded[i] = number if number >= 0 else number % 255
    marker = decoded[0]
    if 48 <= marker <= 57:
        trailing = marker - 48
    elif 97 <= marker <= 122:
        trailing = marker - 87
    else:
        raise ValueError("Invalid PlayAuth key layout.")
    end = len(decoded) - trailing
    hex_key = decoded[1:end]
    if end < 1 or len(hex_key) != 32 or any(
        not (48 <= byte <= 57 or 65 <= byte <= 70 or 97 <= byte <= 102)
        for byte in hex_key
    ):
        raise ValueError("Invalid PlayAuth key layout.")
    return bytes.fromhex(hex_key.decode("ascii"))
