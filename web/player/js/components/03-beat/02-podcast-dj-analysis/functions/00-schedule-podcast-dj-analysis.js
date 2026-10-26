'use strict';

function schedulePodcastDjAnalysis(songKey, audioUrl, token, durationSec) {
  cancelDjBeatAnalysisTimer();
  if (!songKey || !audioUrl) return;
  djBeatAnalysisTimer = setTimeout(function waitForDjStart() {
    djBeatAnalysisTimer = null;
    if (token !== djBeatMapToken || !djMode.active || djMode.songKey !== songKey || djBeatMapCache[songKey]) return;
    var startAnalysis = function () {
      if (token !== djBeatMapToken || !djMode.active || djMode.songKey !== songKey || djBeatMapCache[songKey]) return;
      if (djBeatMapBusy) {
        djBeatAnalysisTimer = setTimeout(waitForDjStart, 900);
        return;
      }
      if (/^https?:\/\//i.test(audioUrl || '') && (durationSec <= 0 || durationSec > 3300)) {
        analyzePodcastDjIntroBeats(audioUrl, token, durationSec).then(function (map) {
          if (token !== djBeatMapToken || !map) return;
          smoothPodcastDjIntroHandoff(songKey, map, token);
        }).catch(function (err) {
          console.warn('podcast DJ intro beat analysis failed:', err);
        });
      }
      analyzePodcastDjBeats(audioUrl, token, durationSec).then(function (map) {
        if (token !== djBeatMapToken || !map) return;
        smoothPodcastDjMapHandoff(songKey, map, token);
      }).catch(function (err) {
        console.warn('podcast DJ beat analysis failed:', err);
        hideBeatChip();
      });
    };
    scheduleAnalysisTask(startAnalysis, 900);
  }, 900);
}


async function analyzePodcastDjIntroBeats(audioUrl, token, durationSec) {
  if (!/^https?:\/\//i.test(audioUrl || '')) return null;
  if (token !== djBeatMapToken || !djMode.active) return null;
  var introResp = await fetch('/api/podcast/dj-beatmap?url=' + encodeURIComponent(audioUrl) + '&duration=' + encodeURIComponent(durationSec || 0) + '&intro=180');
  if (token !== djBeatMapToken || !djMode.active) return null;
  var introData = await introResp.json().catch(function () { return null; });
  if (introResp.ok && introData && introData.ok && introData.map && introData.map.cameraBeats && introData.map.cameraBeats.length >= 4) {
    return introData.map;
  }
  return null;
}