"""QQ 两类播放适配器各自记住最近成功的 GUID，不耦合搜索和歌曲模块。"""

from music_app.providers.qqmusic.config import qq_GUID, qqs_GUID

playback_guid = {"good": qq_GUID}
search_guid = {"good": qqs_GUID}
