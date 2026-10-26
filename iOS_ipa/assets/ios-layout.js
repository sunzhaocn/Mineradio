'use strict';
(function () {
  function finite(value) { return typeof value==='number' && isFinite(value) && value>0; }
  function normalize(value) {
    if (!value || (value.deviceFamily!=='ipad' && value.deviceFamily!=='iphone')
      || !finite(value.windowWidth) || value.windowWidth>10000
      || !finite(value.windowHeight) || value.windowHeight>10000
      || !finite(value.contentWidth) || value.contentWidth>10000) return null;
    var pad=value.deviceFamily==='ipad',compact=!pad || Math.min(value.windowWidth,value.windowHeight)<600;
    var viewport=compact ? Math.max(320,Math.min(880,Math.round(value.contentWidth))) : 1100;
    return {version:1,deviceFamily:value.deviceFamily,profile:compact?'phone':'tablet',bootstrapVisuals:pad,
      windowWidth:value.windowWidth,windowHeight:value.windowHeight,contentWidth:value.contentWidth,
      minorDimension:Math.min(value.windowWidth,value.windowHeight),viewportWidth:viewport,
      scale:Math.round(value.contentWidth/viewport*1000000)/1000000};
  }
  function fallback() {
    var tablet=/(?:[?&])ios_layout=tablet(?:&|$)/.test(location.search||'');
    var visual=window.visualViewport,screen=window.screen||{};
    var width=visual && visual.width*visual.scale || screen.width || window.innerWidth || 390;
    var height=visual && visual.height*visual.scale || screen.height || window.innerHeight || 844;
    return normalize({deviceFamily:tablet?'ipad':'iphone',windowWidth:width,windowHeight:height,contentWidth:width});
  }
  var current=normalize(window.mineradioIOSLayout)||fallback();
  var bootstrapVisuals=current.deviceFamily==='ipad';
  var bootstrapping=bootstrapVisuals && !(window.MINERADIO_MODULE_STATUS && window.MINERADIO_MODULE_STATUS.ready);
  var lastKey='',version=0,scheduled=false,restoreVisuals=false;
  function simpleActive() { return current.profile==='phone' && !bootstrapping; }
  function resumeVisuals() {
    if (!restoreVisuals || simpleActive()) return;
    restoreVisuals=false;
    // Compact cover updates deliberately skip depth/palette/shelf work. Reapply
    // the already decoded latest cover when expanding, without a media request.
    var cover=document.getElementById('thumb-cover');
    var source=cover && cover.getAttribute('src');
    if (source && typeof coverPickerCanvas!=='undefined' && coverPickerCanvas
      && typeof applyCoverCanvas==='function') {
      var opts={noCoverTransition:true,deferHeavy:true};
      if (typeof trackSwitchToken!=='undefined') opts.trackToken=trackSwitchToken;
      applyCoverCanvas(coverPickerCanvas,source,opts);
    }
    if (typeof shelfManager!=='undefined' && shelfManager && typeof shelfManager.rebuild==='function') shelfManager.rebuild();
  }
  function announce() {
    scheduled=false;
    window.dispatchEvent(new Event('mineradio:ios-layout-changed'));
    window.dispatchEvent(new Event('resize'));
    resumeVisuals();
    if (!simpleActive() && typeof wakeMainLoopFromBackground==='function') wakeMainLoopFromBackground();
  }
  function schedule() {
    if (scheduled) return;
    scheduled=true;
    if (window.requestAnimationFrame) window.requestAnimationFrame(announce);
    else setTimeout(announce,0);
  }
  function apply(value) {
    var next=normalize(value);
    if (!next || (next.deviceFamily==='ipad')!==bootstrapVisuals) return false;
    var key=JSON.stringify(next);
    if (key===lastKey) return true;
    var originalAudio=window.audio,originalQueue=window.playQueue,originalPlaylist=window.playlist;
    if (!bootstrapping && current.profile==='phone' && next.profile==='tablet') restoreVisuals=true;
    current=next;lastKey=key;version++;
    window.mineradioIOSLayout=current;
    var meta=document.querySelector('meta[name="viewport"]');
    if (meta) meta.setAttribute('content','width='+current.viewportWidth+', initial-scale='+current.scale+', viewport-fit=cover');
    document.documentElement.dataset.iosLayoutProfile=current.profile;
    window.mineradioIOSLayoutDiagnostic={version:version,profile:current.profile,
      deviceFamily:current.deviceFamily,viewportWidth:current.viewportWidth,scale:current.scale,
      bootstrapVisuals:bootstrapVisuals,bootstrapping:bootstrapping,
      audioPreserved:originalAudio===window.audio,queuePreserved:originalQueue===window.playQueue,
      playlistPreserved:originalPlaylist===window.playlist};
    schedule();
    return true;
  }
  function ready() {
    if (!bootstrapping) return;
    bootstrapping=false;
    if (window.mineradioIOSLayoutDiagnostic) window.mineradioIOSLayoutDiagnostic.bootstrapping=false;
    announce();
  }
  window.mineradioIOSLayoutController=Object.freeze({bootstrapVisuals:bootstrapVisuals,
    simpleActive:simpleActive,current:function () { return Object.assign({},current); },apply:apply});
  window.mineradioIOSApplyLayout=apply;
  apply(current);
  window.addEventListener('mineradio:ready',ready);
})();
