'use strict';

if (typeof window.addEventListener === 'function') {
  window.addEventListener('mineradio:accounts-changed', invalidateNextTrackPreloadAccounts);
  window.addEventListener('storage', function (event) {
    if (!event || !event.key || event.key === 'mineradio-local-accounts-v1') invalidateNextTrackPreloadAccounts();
  });
}
