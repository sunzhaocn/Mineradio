'use strict';



function initFxConsoleSearchAndHistory() {
  var panel = document.getElementById('fx-panel');
  var search = document.getElementById('fx-console-search');
  if (!panel || !search || panel._fxConsoleSearchHistoryBound) return;
  panel._fxConsoleSearchHistoryBound = true;
  fxConsoleRegisterHotkeySearchEntry();
  search.addEventListener('input', function () { renderFxConsoleSearchResults(search.value); });
  search.addEventListener('focus', function () { if (search.value) renderFxConsoleSearchResults(search.value); });
  search.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      search.value = '';
      renderFxConsoleSearchResults('');
      search.blur();
    } else if (e.key === 'Enter') {
      var first = document.querySelector('#fx-console-search-results .fx-console-search-result');
      if (first) { e.preventDefault(); first.click(); }
    }
  });
  var undo = document.getElementById('fx-console-undo');
  if (undo) undo.addEventListener('click', undoFxConsoleHistory);
  var historyBtn = document.getElementById('fx-console-history-toggle');
  var historyPop = document.getElementById('fx-console-history');
  if (historyBtn && historyPop) historyBtn.addEventListener('click', function () {
    var open = historyPop.hidden;
    closeFxConsolePopovers();
    historyPop.hidden = !open;
    historyBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
  panel.addEventListener('pointerdown', function (e) {
    if (e.target && e.target.matches && e.target.matches('input[type="range"],input[type="color"]')) fxConsoleBeginRangeTxn(e.target);
  }, true);
  panel.addEventListener('focusin', function (e) {
    if (e.target && e.target.matches && e.target.matches('input[type="range"],input[type="color"]')) fxConsoleBeginRangeTxn(e.target);
  }, true);
  panel.addEventListener('keydown', function (e) {
    if (e.target && e.target.matches && e.target.matches('input[type="range"]')) fxConsoleBeginRangeTxn(e.target);
  }, true);
  panel.addEventListener('change', function (e) {
    if (!e.target || !e.target.matches || !e.target.matches('input[type="range"],input[type="color"]')) return;
    queueMicrotask(function () { fxConsoleCommitRangeTxn(e.target); });
  }, true);
  panel.addEventListener('focusout', function (e) {
    if (!fxConsoleHistoryTxn || fxConsoleHistoryTxn.control !== e.target) return;
    queueMicrotask(function () { fxConsoleCommitRangeTxn(e.target); });
  }, true);
  panel.addEventListener('click', function (e) {
    if (fxConsoleHistoryApplying) return;
    var entry = fxConsoleEntryForElement(e.target);
    if (!fxConsoleClickIsReversible(e.target, entry)) return;
    var before = captureFxConsoleState();
    var label = fxConsoleHistoryControlLabel(entry, e.target);
    var key = entry.id + ':' + label;
    // The console listens in capture phase, while many controls still use
    // inline/bubble click handlers. Defer to the next task so the target
    // handler has committed its value before the "after" snapshot is read.
    setTimeout(function () {
      pushFxConsoleHistory(label, key, before, captureFxConsoleState(), false);
    }, 0);
  }, true);
  document.addEventListener('pointerdown', function (e) {
    if (!e.target || !e.target.closest || !e.target.closest('#color-lab-pop')) return;
    if (!fxConsoleHistoryTxn && typeof colorLabState !== 'undefined' && colorLabState && colorLabState.picker) fxConsoleBeginRangeTxn(colorLabState.picker);
  }, true);
  document.addEventListener('pointerup', function (e) {
    if (!fxConsoleHistoryTxn) return;
    if (e.target && e.target.closest && e.target.closest('#color-lab-pop button')) return;
    var colorTxn = fxConsoleHistoryTxn.control.matches('input[type="color"]');
    if (colorTxn && (!e.target || !e.target.closest || !e.target.closest('#color-lab-pop'))) return;
    queueMicrotask(function () { fxConsoleCommitRangeTxn(colorTxn ? e.target : null); });
  }, true);
  document.addEventListener('pointercancel', function () {
    if (fxConsoleHistoryTxn) queueMicrotask(function () { fxConsoleCommitRangeTxn(null); });
  }, true);
  document.addEventListener('click', function (e) {
    if (!fxConsoleHistoryTxn || !e.target || !e.target.closest || !e.target.closest('#color-lab-pop')) return;
    queueMicrotask(function () { fxConsoleCommitRangeTxn(e.target); });
  }, true);
  document.addEventListener('change', function (e) {
    if (!fxConsoleHistoryTxn || !e.target || !e.target.closest || !e.target.closest('#color-lab-pop')) return;
    queueMicrotask(function () { fxConsoleCommitRangeTxn(e.target); });
  }, true);
  document.addEventListener('pointerdown', function (e) {
    if (!e.target || !e.target.closest || e.target.closest('#fx-console-toolbar,#color-lab-pop')) return;
    closeFxConsolePopovers();
  }, true);
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    var results = document.getElementById('fx-console-search-results');
    var history = document.getElementById('fx-console-history');
    if ((!results || results.hidden) && (!history || history.hidden)) return;
    closeFxConsolePopovers();
    if (document.activeElement && document.activeElement.closest && document.activeElement.closest('.fx-console-popover')) search.focus();
  }, true);
  window.addEventListener('blur', function () {
    if (fxConsoleHistoryTxn) fxConsoleCommitRangeTxn(null);
  });
  renderFxConsoleHistory();
}