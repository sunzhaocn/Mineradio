'use strict';


function shouldHidePlaylistPanelOnWindowLeave(e) {
  var panel = document.getElementById('playlist-panel');
  if (!panel || playlistPanelPinned) return false;
  if (!panel.classList.contains('peek') && !panel.classList.contains('show')) return false;
  if (e && e.relatedTarget) return false;
  if (!e) return true;
  if (isPlaylistFullscreenEdgeMode() && e.clientX <= 2 && e.clientY > playlistPanelEdgeTopGutter(window.innerHeight) && e.clientY < window.innerHeight - playlistPanelEdgeBottomGutter(window.innerHeight)) return false;
  return e.clientX <= 12 || e.clientX >= window.innerWidth - 2 || e.clientY <= 2 || e.clientY >= window.innerHeight - 2;
}