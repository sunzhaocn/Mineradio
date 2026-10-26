'use strict';

function playQueueAtStartTrackLyricFetch(_invocationState) {
      if (_invocationState.earlyLyricFetchStarted) return false;
      if (!_invocationState.song || _invocationState.song.type === 'podcast' || _invocationState.song.type === 'local' || _invocationState.song.source === 'local' || _invocationState.song.localUrl) return false;
      if (typeof fetchLyric !== 'function') return false;
      _invocationState.earlyLyricFetchStarted = true;
      setTimeout(function () {
        if (_invocationState.token === trackSwitchToken) fetchLyric(_invocationState.song, _invocationState.token);
      }, 0);
      return true;
    }
