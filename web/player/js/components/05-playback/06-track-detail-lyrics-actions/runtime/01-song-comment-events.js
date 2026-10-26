'use strict';

if (typeof window.addEventListener === 'function') {
  window.addEventListener('mineradio:accounts-changed',function() {
    if (typeof cancelPendingTrackDetailRequests==='function') cancelPendingTrackDetailRequests(true);
    refreshSongDetailAccount();
  });
  window.addEventListener('mineradio:playback-intent',function(event) {
    if (typeof cancelPendingTrackDetailRequests==='function') cancelPendingTrackDetailRequests(false);
    var detail=event.detail || {};
    if (typeof scheduleCurrentTrackMetadata==='function') scheduleCurrentTrackMetadata(playQueue[detail.index],detail.token);
  });
}
