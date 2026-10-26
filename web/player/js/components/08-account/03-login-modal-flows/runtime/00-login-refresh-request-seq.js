'use strict';

var loginRefreshRequestSeq = 0;

var loginWorkflowDrag = null;

var LOGIN_WORKFLOW_CONNECTION_STORE_KEY = 'mineradio-login-workflow-connections-v1';

var LOGIN_WORKFLOW_PROVIDERS = ['netease', 'qq', 'kugou', 'qishui'];

var loginWorkflowPendingProvider = '';

var loginWorkflowVerifiedSession = {};

var loginProviderPointer = null;

var loginProviderClickSuppressed = false;

var loginWorkflowEdgeRenderFrame = 0;

var loginWorkflowEdgeRenderTimers = [];

var SPOTIFY_DEVELOPER_DASHBOARD_URL = 'https://developer.spotify.com/dashboard';

var SPOTIFY_REDIRECT_URI = 'http://127.0.0.1:43879/callback';

var spotifySetupCallbackReady = false;

var spotifySetupDiagnostics = null;

var spotifySetupBusy = false;

var spotifySetupAutoCheckKey = '';


var pendingCookieExportProvider = '';
