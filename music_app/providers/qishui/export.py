"""按当前本机账号取得的歌曲资料，导出可直接播放的音频；不输出媒体密钥。"""
import argparse
from pathlib import Path
import re
import shutil
import sys

from . import api
from .playback import prepare_audio
from music_app.paths import ROOT


def main(argv=None):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    parser = argparse.ArgumentParser(description='汽水音乐本机解密导出')
    parser.add_argument('--id', required=True, help='搜索结果中的数字歌曲 ID')
    parser.add_argument('--quality', default='highest', choices=tuple(api.QUALITY_NAMES))
    parser.add_argument('--out', type=Path, help='完整输出文件路径，省略时保存到汽水音乐解密结果目录')
    args = parser.parse_args(argv)
    if not re.fullmatch(r'[1-9]\d{0,24}', args.id):
        parser.error('歌曲 ID 必须为数字')
    try:
        info = api.details(args.id)
        file = prepare_audio(args.id, args.quality)
        name = re.sub(r'[\\/:*?"<>|\x00-\x1f]', '_', info['title'])
        out = args.out or ROOT / '汽水音乐解密结果' / (name + '-' + api.QUALITY_NAMES[args.quality] + file.suffix)
        out.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(file, out)
        print('已导出：' + str(out.resolve()))
        return 0
    except api.QishuiError as error:
        print(str(error), file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
