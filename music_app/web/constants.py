"""网页适配层的平台名称及固定本机 API 地址。"""
import os

API = os.environ.get('MUSIC_API_BASE', 'http://127.0.0.1:18000').rstrip('/')
PROVIDERS = {'netease': 'netease', 'qq': 'qqmusic', 'kugou': 'kugou', 'qishui': 'qishui'}
CHART_PROVIDERS = ('netease', 'qqmusic', 'kugou', 'qishui')
