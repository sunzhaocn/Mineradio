'use strict';


async function startLocalBeatAnalysis(mode) {
  if (window.mineradioSimplePlayer && window.mineradioSimplePlayer.active()) return;
  var song = localBeatAnalysis.song || currentLocalSong;
  var audioUrl = localBeatAnalysis.audioUrl || (song && song.localUrl) || (audio && audio.src) || '';
  mode = mode || localBeatAnalysis.mode;
  mode = mode === 'dj' ? 'dj' : 'mr';
  if (!song || !song.localKey || !audioUrl || localBeatAnalysis.active) return;
  var cached = getLocalBeatEntry(song.localKey, mode);
  if (cached) {
    applyLocalBeatMap(song, mode, cached, true);
    closeGsapModal(document.getElementById('local-beat-modal'));
    return;
  }
  localBeatAnalysis.active = true;
  localBeatAnalysis.mode = mode;
  localBeatAnalysis.token++;
  var localToken = localBeatAnalysis.token;
  updateLocalBeatModal();
  setLocalBeatStatus((mode === 'dj' ? 'DJ' : 'MR') + ' 分析准备中...', 'warn');
  try {
    var map = null;
    if (mode === 'dj') {
      setDjModeActive(true, song);
      djBeatMapToken++;
      resetDjBeatMapState();
      currentBeatMap = null;
      resetBeatCameraSync(audio ? audio.currentTime : 0);
      var djToken = djBeatMapToken;
      map = await analyzePodcastDjBeats(audioUrl, djToken, audio && isFinite(audio.duration) ? audio.duration : 0);
      if (localToken !== localBeatAnalysis.token || djToken !== djBeatMapToken) return;
      if (!map) throw new Error('DJ analysis returned empty map');
    } else {
      setDjModeActive(false, song);
      beatMapToken++;
      currentBeatMap = null;
      beatMapNextIdx = 0;
      resetBeatCameraSync(audio ? audio.currentTime : 0);
      var mrToken = beatMapToken;
      map = await analyzeAudioBeats(audioUrl, audio && isFinite(audio.duration) ? audio.duration : 0, mrToken, { background: false, song: song });
      if (localToken !== localBeatAnalysis.token || mrToken !== beatMapToken) return;
      if (!map) throw new Error('MR analysis returned empty map');
    }
    storeLocalBeatEntry(song.localKey, mode, map, song);
    applyLocalBeatMap(song, mode, map, false);
    localBeatAnalysis.active = false;
    setLocalBeatStatus((mode === 'dj' ? 'DJ' : 'MR') + ' 分析完成: ' + localBeatVisualCount(map) + ' 个主拍');
    updateLocalBeatModal();
    showToast((mode === 'dj' ? 'DJ' : 'MR') + ' 本地节奏分析完成');
    setTimeout(function () {
      if (!localBeatAnalysis.active) closeGsapModal(document.getElementById('local-beat-modal'));
    }, 900);
  } catch (err) {
    console.warn('local beat analysis failed:', err);
    localBeatAnalysis.active = false;
    hideBeatChip();
    if (mode === 'dj') setDjModeActive(false, song);
    setLocalBeatStatus('分析失败，请换另一种模式重试', 'fail');
    updateLocalBeatModal();
    showToast('本地节奏分析失败');
  }
}

