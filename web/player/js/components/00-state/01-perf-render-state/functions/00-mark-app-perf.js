'use strict';

function markAppPerf(name) {
  try {
    var value = performance.now();
    appPerfMarks.push({ name: name, value: Math.round(value) });
    if (performance && performance.mark) performance.mark('mineradio:' + name);
    if (appPerfMarks.length <= 16) console.debug('[MineradioPerf]', name, Math.round(value) + 'ms');
  } catch (e) { }
}

function installStartupLongTaskObserver() {
  try {
    if (!('PerformanceObserver' in window)) return;
    var observer = new PerformanceObserver(function (list) {
      list.getEntries().forEach(function (entry) {
        if (entry.startTime > 15000) return;
        console.debug('[MineradioPerf] longtask', Math.round(entry.startTime) + 'ms', Math.round(entry.duration) + 'ms');
      });
    });
    observer.observe({ entryTypes: ['longtask'] });
    setTimeout(function () { try { observer.disconnect(); } catch (e) { } }, 16000);
  } catch (e) { }
}