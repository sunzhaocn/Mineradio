"""Replace the pinned template's icon launch view with the welcome wordmark.

Only fixed-length NIB values change. Object references, constraints, offsets,
and executable code remain intact. A new storyboard name avoids the old iOS
launch snapshot being selected after an in-place app update.
"""
from pathlib import Path
import hashlib
import io
import struct


def patch_launch_nib(raw):
    assert raw.startswith(b'NIBArchive')
    header = struct.unpack_from('<10I', raw, 10)
    assert header[:2] == (1, 10)
    count, offset, end = header[6], header[7], header[9]
    data = bytearray(raw)

    def number(pos):
        value = shift = 0
        while True:
            byte = raw[pos]; pos += 1
            value |= (byte & 127) << shift
            if byte & 128:
                return value, pos
            shift += 7
            assert shift < 35

    # Keys are read from the archive, never found with an unscoped byte replace.
    keys, pos = [], header[5]
    for _ in range(header[4]):
        length, pos = number(pos)
        keys.append(raw[pos:pos + length].decode('utf-8')); pos += length
    changes = []
    pos = offset
    sizes = {0: 1, 1: 2, 2: 4, 3: 8, 4: 0, 5: 0, 6: 4, 7: 8, 9: 0, 10: 4}
    for _ in range(count):
        key, pos = number(pos); kind = raw[pos]; pos += 1
        if kind == 8:
            size, pos = number(pos)
        else:
            size = sizes[kind]
        value = raw[pos:pos + size]
        replacement = None
        if keys[key] == 'NS.bytes' and kind == 8 and value == b'Splash':
            replacement = b'MStart'
        elif keys[key] in ('UIRed', 'UIGreen', 'UIBlue') and kind == 6:
            assert struct.unpack('<f', value) == (1.0,)
            replacement = struct.pack('<f', 0.0)
        elif keys[key] == 'NSRGB' and kind == 8:
            assert value == b'1 1 1'
            replacement = b'0 0 0'
        if replacement is not None:
            assert len(replacement) == size
            data[pos:pos + size] = replacement
            changes.append(keys[key])
        pos += size
    assert pos == end
    assert sorted(changes) == sorted(['NS.bytes', 'UIRed', 'UIGreen', 'UIBlue', 'NSRGB'])
    assert len(data) == len(raw)
    return bytes(data)


def make_welcome_png():
    """Render a code-defined launch UI, without changing the home-screen icon."""
    from PIL import Image, ImageDraw, ImageFont
    font_root = Path('C:/Windows/Fonts')
    title_font = ImageFont.truetype(str(font_root / 'seguisb.ttf'), 78)
    caption_font = ImageFont.truetype(str(font_root / 'segoeui.ttf'), 14)
    image = Image.new('RGB', (640, 640), '#000000')
    draw = ImageDraw.Draw(image)
    draw.text((320, 299), 'Mineradio', font=title_font, fill='#f8f8f2', anchor='mm')
    draw.line((268, 360, 372, 360), fill='#7ad7c2', width=2)
    text = 'PRIVATE VISUAL RADIO'
    draw.text((320, 389), text, font=caption_font, fill='#aeb9bd', anchor='mm')
    output = io.BytesIO(); image.save(output, format='PNG')
    return output.getvalue()
