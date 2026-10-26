'use strict';

var CUEFIELD_AUTOMIX_STORE_KEY = 'mineradio-cuefield-automix-v1';

var cuefieldAutoMixEnabled = false;

var cuefieldAutoMix = null;

var cuefieldAutoMixPrepareTimer = 0;

var cuefieldAutoMixExecuting = false;

var cuefieldAutoMixPreparedAudio = null;

var cuefieldMediaFadeSerial = 0;

var cuefieldMediaFadeRaf = 0;

var cuefieldMediaFadeTimer = 0;

var cuefieldPairFadeResolve = null;

var cuefieldTransitionGeneration = 0;

var cuefieldDelayWaiters = [];

var cuefieldActiveTransitionContext = null;

var cuefieldAudioDescriptorCache = {};

var cuefieldRecentRecipes = [];

var cuefieldBridgeEngine = null;

var cuefieldSourceLoopRuntime = null;

var cuefieldDeckVolumeSerial = { A: 0, B: 0 };

var cuefieldFeedbackState = { context: null, timer: 0, submitted: false };

var CUEFIELD_AUTOMIX_NORMAL_START_SETTLE_MS = 4200;

var CUEFIELD_AUTOMIX_HANDOFF_SETTLE_MS = 5200;


cuefieldAutoMixEnabled = readCuefieldAutoMixPreference();

initCuefieldAutoMix();

updateCuefieldAutoMixUi(cuefieldAutoMixEnabled ? 'waiting' : 'disabled');
