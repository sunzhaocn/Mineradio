'use strict';
(function (root) {
  function create(options) {
    var cookie = '', state = 'unknown', checkFailed = false, lastCheck = 0, pending = null, revision = 0;
    function sync() {
      var value = options.cookie() || '';
      if (value !== cookie) { cookie = value; state = 'unknown'; checkFailed = false; lastCheck = 0; pending = null; }
      return value;
    }
    function status() {
      var value = sync();
      return { authState: value ? state : 'logged_out', reauthRequired: !!value && state === 'expired',
        loggedIn: !!value && state !== 'expired', checkFailed: checkFailed, checkedAt: lastCheck };
    }
    function refresh(force) {
      var value = sync();
      if (!value) return Promise.resolve(status());
      if (pending) return pending;
      if (!force && lastCheck && Date.now() - lastCheck < 60000) return Promise.resolve(status());
      var startedRevision = revision;
      var task = Promise.resolve().then(function () { return options.request(!!force); }).then(function (result) {
        if (sync() !== value || revision !== startedRevision) return status();
        checkFailed = !!result.checkFailed || ['valid', 'expired'].indexOf(result.authState) < 0;
        if (result.authState === 'valid' || result.authState === 'expired') state = result.authState;
        lastCheck = Date.now();
        return status();
      }, function () {
        if (sync() === value && revision === startedRevision) { checkFailed = true; lastCheck = Date.now(); }
        return status();
      }).finally(function () {
        if (pending === task) { pending = null; if (options.changed) options.changed(); }
      });
      pending = task;
      return task;
    }
    function observe(result) {
      if (!sync() || !result || ['valid', 'expired'].indexOf(result.authState) < 0) return;
      revision += 1; state = result.authState; checkFailed = false; lastCheck = Date.now();
      if (options.changed) options.changed();
    }
    return { status: status, refresh: refresh, observe: observe };
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { create: create };
  else root.MineradioSessionHealth = { create: create };
})(typeof window !== 'undefined' ? window : globalThis);
