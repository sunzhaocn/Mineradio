'use strict';
(function () {
  function leave() {
    if (document.body.classList.contains('web-mobile-active')) return;
    if (typeof controlsHovering !== 'undefined') controlsHovering = false;
    if (typeof scheduleControlsHide === 'function') scheduleControlsHide(180);
    if (typeof setPeek === 'function') setPeek(document.getElementById('fx-panel'), false, 'fx');
    document.body.classList.remove('fullscreen-diy-peek');
  }
  // document mouseleave is not delivered reliably by embedded WebViews.
  window.addEventListener('blur', leave);
  document.documentElement.addEventListener('pointerleave', function (e) { if (!e.relatedTarget) leave(); });
  document.addEventListener('mouseout', function (e) { if (!e.relatedTarget) leave(); });
  document.addEventListener('visibilitychange', function () { if (document.hidden) leave(); });
  function bindQueueDismiss() {
    var panel=document.getElementById('playlist-panel');
    if (!panel || !window.mineradioPlayerControls) return;
    // Desktop keeps its existing edge/launcher hover and automatic dismissal.
    if (window.mineradioHoverPanels) return;
    if (panel.__webQueueBound) return;
    panel.__webQueueBound=true;
    function isQueueEdge(event) {
      var target=event.target;
      var surface=target===document.body || target.id==='desktop-window-shell' ||
        target.closest && target.closest('#canvas-container,#custom-bg,#song-mv-layer,#wallpaper-engine-layer');
      return event.clientX>=0 && event.clientX<=104 && event.clientY>82 && event.clientY<innerHeight-112 &&
        !document.body.classList.contains('splash-active') && !document.body.classList.contains('empty-home-active') &&
        !!surface;
    }
    document.addEventListener('click',function(event){
      if (!isQueueEdge(event)) return;
      event.preventDefault();event.stopImmediatePropagation();
      // Promote a mouse hover preview to an explicit opening on click.
      togglePlaylistPanel(!panel.classList.contains('show'));
    },true);
    var sub=panel.querySelector('.fx-sub');if(sub)sub.textContent='QUEUE · 点击空白处或 × 收起';
    var fxSub=document.querySelector('#fx-panel .fx-sub');if(fxSub)fxSub.textContent='MINERADIO VISUALS · 点击按钮展开或收起';
    var button=panel.querySelector('.playlist-panel-close');
    if (!button) {
      button=document.createElement('button');button.type='button';button.className='playlist-panel-close';
      button.textContent='×';button.setAttribute('aria-label','关闭歌单');
      panel.querySelector('.playlist-panel-sticky').prepend(button);
    }
    button.onclick=function(event){event.stopPropagation();togglePlaylistPanel(false);};
    document.addEventListener('pointerdown',function(event){
      if (!panel.classList.contains('show')&&!panel.classList.contains('peek')) return;
      if (isQueueEdge(event)) return;
      if (event.target.closest('#playlist-panel,#fx-panel,#top-right,#search-area,#bottom-bar,#bottom-handle,#web-library-mask,.modal-mask,button,input,select,textarea,a')) return;
      togglePlaylistPanel(false);
    },true);
  }
  window.addEventListener('mineradio:ready',bindQueueDismiss,{once:true});
})();
