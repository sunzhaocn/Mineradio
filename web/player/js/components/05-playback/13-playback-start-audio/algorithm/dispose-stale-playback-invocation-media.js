'use strict';

function playQueueAtDisposeStalePlaybackInvocationMedia(_invocationState, media) {
      if (!media || media === audio) return;
      try {
        media.pause();
        media.removeAttribute('src');
        media.load();
      } catch (e) { }
    }
