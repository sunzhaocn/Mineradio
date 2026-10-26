'use strict';

// ============================================================
var idleGuideCanvas = null;

var idleGuideCtx = null;

var idleGuideW = 0, idleGuideH = 0, idleGuideDpr = 1;

var idleGuideParticles = [];

var idleGuideTrails = [[], [], [], []];

var idleGuideStartedAt = performance.now();

var idleGuideVisible = false;

var idleGuideLastFrameAt = performance.now();

var idleGuideDelayTimer = null;

// Keep Wallpaper as the only startup idle background.
var IDLE_GUIDE_BACKGROUND_ENABLED = false;

var idleGuideInteraction = {
  angle: 0,
  velocity: 0,
  rotX: -0.12,
  rotY: 0,
  spinX: 0,
  spinY: 0,
  zoom: 1,
  zoomTarget: 1,
  zoomPulse: 0,
  dragging: false,
  lastX: 0,
  lastY: 0,
  lastT: 0,
  pointerX: 0.5,
  pointerY: 0.5,
  pointerActive: false,
  focus: 0,
  press: 0,
  tiltX: 0,
  tiltY: 0
};


// ============================================================
//  toast
// ============================================================
var toastTimer = null;


var visualGuideSteps = [
  {
    target: 'stage',
    kicker: '01 / Welcome',
    title: 'Mineradio 是用来听歌的视觉播放器',
    body: '它不是单纯歌单页：搜索或导入一首歌后，封面、歌词、粒子和镜头会跟着音乐一起动。'
  },
  {
    selector: '#search-box',
    kicker: '02 / Play',
    title: '从搜索或导入开始',
    body: '输入歌名、歌手或关键词即可播放；如果有本地音乐，也可以用导入入口直接放进舞台。'
  },
  {
    selector: '#bottom-bar',
    kicker: '03 / Control',
    title: '播放以后看底部控制台',
    body: '播放、切歌、进度、队列和歌词都集中在底部，先把它当作一个正常播放器使用就可以。'
  },
  {
    selector: '#user-btn',
    kicker: '04 / Account',
    title: '登录只是为了同步你的音乐库',
    body: '登录后会同步歌单、红心和播客；不登录也可以搜索和播放，不会强制卡住你。'
  },
  {
    target: 'shelf',
    kicker: '05 / Visual',
    title: '进阶视觉都放在舞台周围',
    body: '右侧 3D 歌单架和 DIY 玩家模式是进阶入口；先播放一首歌，再慢慢调视觉效果。'
  },
  {
    selector: '#diy-mode-btn',
    kicker: '06 / DIY',
    title: '高级功能在 DIY 玩家模式',
    body: '视觉控制台、上传/封面、自定义歌词、音质和更多面板都会在这里展开。'
  }
];

var visualGuideStepsDiy = [
  {
    selector: '#diy-mode-btn',
    kicker: '01 / DIY',
    title: 'DIY 玩家模式已展开',
    body: '这里可以随时切回默认模式。DIY 模式会显示完整控制台、上传、视觉面板和高级调参。'
  },
  {
    selector: '#search-box',
    kicker: '02 / Search',
    title: '搜索源和导入入口会展开',
    body: '顶部搜索支持更多来源切换，上传歌曲、封面等入口也会在 DIY 模式中显示。'
  },
  {
    selector: '#playlist-panel',
    kicker: '03 / Library',
    title: '左侧是完整歌单和队列',
    body: '靠近左侧边缘可以打开歌单/队列面板，在这里管理队列、个人歌单和播客。'
  },
  {
    selector: '#fx-panel',
    kicker: '04 / Visual Lab',
    title: '右侧是视觉控制台',
    body: '靠近右下角或点击视觉按钮，可以调节粒子、歌词、镜头、3D 歌单架和更多视觉参数。'
  },
  {
    selector: '#quality-control',
    kicker: '05 / Controls',
    title: '高级播放控制会补全',
    body: '音质、播放顺序、收藏、歌词源和更多按钮会在 DIY 模式中完整显示。'
  },
  {
    target: 'shelf',
    kicker: '06 / Shelf',
    title: '3D 歌单架支持直接打开',
    body: '右侧的 3D 歌单架会在靠近时半透明浮现，点击卡片可打开歌单，点卡片里的播放按钮可直接播放整张歌单。'
  }
];

(function bindVisualGuideSurfaceClick() {
  var guide = document.getElementById('visual-guide');
  if (guide) guide.addEventListener('click', handleVisualGuideSurfaceClick);
})();

// ============================================================
//  摄像头 / 手势 v8 — 仅保留手势, 头部追踪已下线
//   - 21 个关键点用 EMA 平滑滤波, 消除抖动
//   - 食指尖 + 手掌中心 共同推开粒子 (真实手感, 不再是单点小球)
//   - 在 hand-canvas 上画出手掌骨架, 视觉跟随手
//   - 捏合 = 拖动旋转封面 (Y 反向修正)
//   - 没有挥扫 / 没有手势切歌
