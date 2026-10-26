'use strict';

function playQueueAtPlaybackInvocationStillCurrent(_invocationState, media) {
      return !!(media && !(_invocationState.resolutionOwner && _invocationState.resolutionOwner.wasCancelled)
        && _invocationState.token === trackSwitchToken && currentIdx === _invocationState.idx && audio === media);
    }
