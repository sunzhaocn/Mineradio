'use strict';

var homeDashboardReviewOffset = 0;

var homeDashboardHeroFingerprint = '';

var homeDashboardQuickFingerprint = '';

var homeDashboardDiscoveryFingerprint = '';

var homeDashboardDiscoveryCache = [];

var homeDashboardRefreshTimer = null;

var HOME_DASHBOARD_VIDEO_DB_NAME = 'mineradio-home-dashboard-video-v1';

var HOME_DASHBOARD_VIDEO_STORE = 'media';

var HOME_DASHBOARD_VIDEO_BLOB_ID = 'home-hero-video';

var HOME_DASHBOARD_VIDEO_META_KEY = 'mineradio-home-dashboard-video-meta-v1';

var HOME_DASHBOARD_VIDEO_MAX_BYTES = 300 * 1024 * 1024;

var homeDashboardVideoDbPromise = null;

var homeDashboardVideoObjectUrl = '';

var homeDashboardVideoLoadToken = 0;

var homeDashboardVideoAttachBusy = false;

var homeDashboardVideoDecodeFailed = false;

var homeDashboardVideoPowerObserver = null;

var homeDashboardVideoControlsBound = false;

var homePlatformRecommendationControlsBound = false;

var homePlatformRecommendationDailyRenderRaf = 0;

var HOME_PLATFORM_DAILY_ROW_HEIGHT = 84;

var HOME_PLATFORM_DAILY_OVERSCAN_ROWS = 3;

var HOME_PLATFORM_DAILY_MAX_RENDERED_CARDS = 24;

var homePlatformRecommendationState = {
  open: false,
  source: 'netease',
  previousFocus: null,
  neteaseLoading: false,
  feeds: {
    qishui: { loading: false, loaded: false, songs: [], error: '', message: '', mode: '', source: '', fallback: false, provenance: '' },
    kugou: { loading: false, loaded: false, songs: [], error: '', message: '', mode: '', source: '', fallback: false, provenance: '' },
  },
};


var HOME_DASHBOARD_REVIEW_DEFAULTS = [
  { text: '有些歌不是突然好听，而是终于听懂了。', source: '每日热评' },
  { text: '慢一点没关系，重要的是一直在向喜欢的生活靠近。', source: '每日热评' },
  { text: '错过落日余晖，还会有满天星辰。', source: '每日热评' },
  { text: '保持热爱，奔赴下一场山海。', source: '每日热评' },
  { text: '答案在路上，自由在风里。', source: '每日热评' },
  { text: '让今天的声音，从你喜欢的地方开始。', source: 'Mineradio' },
];


var homeDashboardBaseRenderHomeDiscover = typeof renderHomeDiscover === 'function' ? renderHomeDiscover : null;

if (homeDashboardBaseRenderHomeDiscover) {
  renderHomeDiscover = function () {
    var result = homeDashboardBaseRenderHomeDiscover.apply(this, arguments);
    renderHomeDashboard();
    return result;
  };
}


document.addEventListener('visibilitychange', function () {
  if (!document.hidden && emptyHomeActive) renderHomeDashboard();
  else scheduleHomeDashboardRefresh();
  homeDashboardUpdateVideoPower();
});


bindHomeDashboardVideoControls();

bindHomePlatformRecommendationControls();

renderHomeDashboard();
