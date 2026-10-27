"""Render actual Electron/FFmpeg clips from synthetic audio, with no user profile."""
import argparse
import array
import base64
from io import BytesIO
import json
import math
import os
from pathlib import Path
import re
import struct
import subprocess
import sys
import tempfile
import threading
import wave
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--presets', default=','.join(map(str, range(13))), help='Comma-separated built-in presets; MV/slides are added')
    args = parser.parse_args()
    output = ROOT / 'runtime/video-export'
    output.mkdir(parents=True, exist_ok=True)
    ffmpeg = ROOT / 'Windows_exe/build/tools/ffmpeg.exe'
    electron = ROOT / 'Windows_exe/node_modules/electron/dist/electron.exe'
    assert ffmpeg.is_file() and electron.is_file(), 'Prepare Windows tools and Electron first'
    with tempfile.TemporaryDirectory(prefix='mr-video-check-') as directory:
        data = Path(directory)
        os.environ.update(MINERADIO_ROOT=directory, MINERADIO_RESOURCE_ROOT=str(ROOT), MINERADIO_CLIENT_ASSET_INIT='0')
        from music_app.web.httpserver import Handler, ThreadingHTTPServer

        class Quiet(Handler):
            def log_message(self, *args):
                pass

        server = ThreadingHTTPServer(('127.0.0.1', 0), Quiet)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        duration = 2.4
        samples = [int(2000 * (1 + .7 * math.sin(i / 48000 * 8)) * math.sin(i / 48000 * 440 * 2 * math.pi))
                   for i in range(int(48000 * duration))]
        with wave.open(str(data / 'tone.wav'), 'wb') as wav:
            wav.setparams((1, 2, 48000, 0, 'NONE', 'not compressed'))
            wav.writeframes(b''.join(struct.pack('<h', sample) for sample in samples))

        def picture(first, second):
            image = Image.new('RGB', (96, 96))
            image.putdata([(int(first[0] + (second[0]-first[0])*x/95), int(first[1]+(second[1]-first[1])*y/95),
                            int(first[2]+(second[2]-first[2])*x/95)) for y in range(96) for x in range(96)])
            stream = BytesIO()
            image.save(stream, format='PNG')
            return 'data:image/png;base64,' + base64.b64encode(stream.getvalue()).decode()

        (data / 'cover.txt').write_text(picture((220, 40, 20), (20, 120, 240)), encoding='utf-8')
        cases = [dict(preset=int(preset), name='Builtin ' + preset) for preset in args.presets.split(',')]
        cases += [dict(preset=14, name='Slides', resources=dict(slides=[
            dict(name='a.png', data=picture((255, 0, 0), (255, 0, 0))),
            dict(name='b.png', data=picture((0, 255, 0), (0, 255, 0)))], slideSeconds=2)),
            dict(preset=13, name='MV and fallback', movie=True, resources=dict(mvFallback=9, mvEndMode='fallback')),
            dict(preset=9, name='1080p 60fps', width=1920, height=1080, fps=60)]
        schema = re.search(r"VISUAL_PRESET_SCHEMA = '([^']+)'", (ROOT / 'web/player/js/components/00-state/00-core-stores/runtime/00-audio.js').read_text(encoding='utf-8')).group(1)
        (data / 'cases.json').write_text(json.dumps(dict(cases=cases, visualPresetSchema=schema)), encoding='utf-8')
        subprocess.run([str(ffmpeg), '-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=30:duration=1.2',
                        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', str(data / 'movie.mp4')], capture_output=True, check=True)
        cases += [dict(preset=3, name='Portable background image', snapshot=dict(backgroundAlbumCover=False,backgroundOpacity=1),
                       resources=dict(background=dict(name='background.png',data=picture((30,180,40),(60,200,100))))),
                  dict(preset=3, name='Portable background video', snapshot=dict(backgroundAlbumCover=False,backgroundOpacity=1),
                       resources=dict(background=dict(name='background.mp4',data='data:video/mp4;base64,'+base64.b64encode((data/'movie.mp4').read_bytes()).decode())))]
        font = Path(os.environ.get('WINDIR','C:/Windows')) / 'Fonts/arial.ttf'
        if font.is_file():
            cases.append(dict(preset=9,name='Portable custom font',snapshot=dict(lyricFont='custom:fontfixture'),
                resources=dict(font=dict(id='fontfixture',name='Font fixture',family='MineradioCustomLyricFont-fontfixture',
                    dataUrl='data:font/ttf;base64,'+base64.b64encode(font.read_bytes()).decode(),size=font.stat().st_size))))
        (data / 'cases.json').write_text(json.dumps(dict(cases=cases, visualPresetSchema=schema)), encoding='utf-8')
        source = (ROOT / 'Windows_exe/checks/video-export-fixture.cjs').read_text(encoding='utf-8')
        entry = data / 'fixture.cjs'
        entry.write_text(source.replace("const root = path.resolve(__dirname,'../..');", 'const root = ' + json.dumps(str(ROOT)) + ';'), encoding='utf-8')
        try:
            run = subprocess.run([str(electron), str(entry)], env={**os.environ,
                'MR_VIDEO_ORIGIN':f'http://127.0.0.1:{server.server_address[1]}', 'MR_VIDEO_FOLDER':directory},
                capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=480)
            (output / 'electron-check.log').write_text(run.stdout + '\n' + run.stderr, encoding='utf-8')
            assert run.returncode == 0, (run.stdout + run.stderr)[-4000:]
            report = json.loads((data / 'result.json').read_text(encoding='utf-8'))
            assert report['passed']
            for case in report['cases']:
                clip = data / case['file']
                (output / case['file']).write_bytes(clip.read_bytes())
                probe = subprocess.run([str(ffmpeg), '-hide_banner', '-i', str(clip), '-f', 'null', '-'], capture_output=True, text=True, errors='replace')
                assert probe.returncode == 0 and 'Video: h264' in probe.stderr and 'Audio: aac' in probe.stderr
                assert f"{case['width']}x{case['height']}" in probe.stderr and f"{case['fps']} fps" in probe.stderr
                assert re.search(r'frame=\s*' + str(math.ceil(duration * case['fps'])) + r'\b', probe.stderr), probe.stderr[-800:]
                decoded = subprocess.run([str(ffmpeg), '-v', 'error', '-i', str(clip), '-vn', '-ac', '1', '-ar', '48000', '-f', 's16le', '-'], capture_output=True, check=True).stdout
                audio = array.array('h', decoded)
                assert len(audio) >= len(samples)
                original = samples[5000:100000:10]
                actual = audio[5000:100000:10]
                correlation = sum(a*b for a,b in zip(original, actual)) / math.sqrt(sum(a*a for a in original)*sum(b*b for b in actual))
                assert correlation > .98, (case['name'], correlation)
                case['audioCorrelation'] = correlation
                frames = []
                for index, position in enumerate(('0.6', '2.3')):
                    target = output / (case['file'] + f'-{index}.png')
                    subprocess.run([str(ffmpeg), '-v', 'error', '-y', '-ss', position, '-i', str(clip), '-frames:v', '1', str(target)], capture_output=True, check=True)
                    frames.append(Image.open(target).convert('RGB'))
                if case['preset'] == 14:
                    red = frames[0].getpixel((case['width']//2, case['height']//2))
                    green = frames[1].getpixel((case['width']//2, case['height']//2))
                    assert red[0] > 240 and red[1] < 10 and green[1] > green[0], (red, green)
                case['mediaVerified'] = True
            (output / 'video-verification.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
            print(json.dumps(dict(passed=True, renderedClips=len(report['cases']), allFifteenBuiltins=set(range(15)).issubset({case['preset'] for case in cases}),
                                 audioVideoTimingVerified=True, cancellationAndCleanupVerified=True)))
        finally:
            server.shutdown()
            server.server_close()


if __name__ == '__main__':
    main()
