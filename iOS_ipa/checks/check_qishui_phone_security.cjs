// Runs only synthetic SDK callbacks. No browser, account, SMS or network access.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.resolve(__dirname, '../assets/qishui-phone-security.js'), 'utf8');

function harness(extra = {}) {
  const scripts = [], calls = [];
  const context = {
    URL, Promise, setTimeout, clearTimeout,
    document: {
      cookie: '', createElement: () => ({}),
      head: { appendChild(script) { scripts.push(script); queueMicrotask(() => script.onerror && script.onerror()); } },
    },
    localStorage: { getItem() { return null; } },
    ...extra,
  };
  context.window = context;
  vm.runInNewContext(source, context);
  return { context, scripts, calls };
}
function sdkHarness(whenRender, extra = {}) {
  let init, render;
  const value = harness({
    verifySDK: {
      initVerifyOptions(options) { init = options; },
      autoRender(options) { render = options; whenRender && whenRender(options); },
      getCaptchaWebId() { return Promise.resolve('verified_fp'); },
    },
    ...extra,
  });
  return { ...value, init: () => init, render: () => render };
}
const decision = { data: { error_code: 1105, verify_center_decision_conf: JSON.stringify({ code: 10000, challenge: 'synthetic' }) } };

(async function () {
  const success = sdkHarness(options => {
    options.captchaOptions.successCb();
    options.captchaOptions.closeCb(); // SDK close after success cannot turn success into failure.
  });
  const first = success.context.__qishuiPhoneVerify(decision, { generalParams: { device_id: '123', install_id: '456' } });
  assert.equal(success.context.__qishuiPhoneVerify(decision, {}), first, 'Concurrent opens share one verification');
  const result = await first;
  assert.equal(result.status, true);
  assert.equal(result.fp, 'verified_fp');
  assert.equal(result.verifyFp, result.fp);
  assert.equal(success.init().commonOptions.aid, 386088);
  assert.equal(success.init().commonOptions.repoId, 579047);
  assert.equal(success.init().commonOptions.did, '123');
  assert.equal(success.init().commonOptions.iid, '456');
  assert.equal(success.init().captchaOptions.h5_check_version, '4.0.12');
  assert.equal(success.render().verify_data.challenge, 'synthetic');
  assert.equal(success.scripts.length, 0, 'Bundled SDK is preferred without a network load');

  // The actual fixed runtime normalizes its successful secondary result to {}.
  const secondary = sdkHarness(options => options.secondVerifyWebOptions.callBack({}));
  const secondaryResult = await secondary.context.__qishuiPhoneVerify({
    error_code: 2046, sms_code_key: 'synthetic_key',
    verify_center_secondary_decision_conf: { code: 20000, mfa_decision: 'synthetic' },
  }, {});
  assert.equal(secondaryResult.status, true);
  assert.equal(secondaryResult.sms_code_key, 'synthetic_key');
  assert.equal(secondary.init().secondVerifyWebOptions.host, 'https://api.qishui.com');
  assert.equal(secondary.render().secondVerifyWebOptions.scene, '4');

  for (const value of [false, { status: false }]) {
    const secondaryFailure = sdkHarness(options => options.secondVerifyWebOptions.callBack(value));
    assert.equal((await secondaryFailure.context.__qishuiPhoneVerify({
      verify_center_secondary_decision_conf: { code: 20000, mfa_decision: 'synthetic' },
    }, {})).status, false, 'An explicit false secondary callback is never accepted');
  }

  const renderResolve = sdkHarness();
  renderResolve.context.verifySDK.autoRender = () => Promise.resolve({ status: true });
  const notVerified = renderResolve.context.__qishuiPhoneVerify(decision, {});
  let acceptedRenderResult = false;
  notVerified.then(() => { acceptedRenderResult = true; });
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  assert.equal(acceptedRenderResult, false, 'Rendering return values do not prove verification');
  renderResolve.context.__qishuiCancelPhoneVerify();
  assert.equal((await notVerified).status, false);

  for (const callback of ['closeCb', 'errorCb']) {
    const cancelled = sdkHarness(options => options.captchaOptions[callback]());
    assert.equal((await cancelled.context.__qishuiPhoneVerify(decision, {})).status, false);
  }

  let closed = 0;
  const manualCancel = sdkHarness();
  manualCancel.context.verifySDK.closeCaptcha = () => { closed++; };
  const cancelledWork = manualCancel.context.__qishuiPhoneVerify(decision, {});
  await Promise.resolve();
  const oldCallbacks = manualCancel.render();
  assert.equal(manualCancel.context.__qishuiCancelPhoneVerify(), true);
  assert.equal((await cancelledWork).status, false, 'Explicit cancel settles a pending verification');
  assert.equal(closed, 1);
  assert.equal(manualCancel.context.__qishuiCancelPhoneVerify(), false);
  const retryWork = manualCancel.context.__qishuiPhoneVerify(decision, {});
  await Promise.resolve();
  oldCallbacks.captchaOptions.successCb();
  manualCancel.render().captchaOptions.successCb();
  assert.equal((await retryWork).status, true, 'A fresh verification can complete after cancellation');

  let delayedScript, delayedRenders = 0;
  const loadingCancel = harness({ document: {
    cookie: '', createElement: () => ({}),
    head: { appendChild(script) { delayedScript = script; } },
  } });
  const loadingWork = loadingCancel.context.__qishuiPhoneVerify(decision, {});
  loadingCancel.context.__qishuiCancelPhoneVerify();
  assert.equal((await loadingWork).status, false);
  loadingCancel.context.verifySDK = {
    initVerifyOptions() { throw Error('Cancelled init must not run'); },
    autoRender() { delayedRenders++; },
  };
  delayedScript.onload();
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  assert.equal(delayedRenders, 0, 'A late SDK load cannot reopen cancelled verification');

  const cookie = sdkHarness(options => options.captchaOptions.successCb(), {
    document: { cookie: 's_v_web_id=cookie_fp', createElement: () => ({}), head: { appendChild() { throw Error('Unexpected load'); } } },
  });
  delete cookie.context.verifySDK.getCaptchaWebId;
  assert.equal((await cookie.context.__qishuiPhoneVerify(decision, {})).fp, 'cookie_fp', 'Fallback uses only official fingerprint storage');

  let delegated = 0;
  const oldSecond = harness({ __qishuiSecondVerify(value, options) {
    delegated++;
    assert.equal(value.url, 'https://lf-ucenter-web.yhgfb-cn-static.com/synthetic.js');
    assert.equal(options.generalParams.did, '123');
    return Promise.resolve({ status: true, biz_params: { synthetic: 'verified' } });
  } });
  const delegatedResult = await oldSecond.context.__qishuiPhoneVerify({
    data: { error_code: 2046, url: 'https://lf-ucenter-web.yhgfb-cn-static.com/synthetic.js' },
  }, { generalParams: { did: '123' } });
  assert.equal(delegatedResult.status, true);
  assert.equal(delegatedResult.biz_params.synthetic, 'verified');
  assert.equal(delegated, 1);

  const untrusted = harness({ __qishuiVerifySDKSource: 'https://evil.example/index.js' });
  assert.equal((await untrusted.context.__qishuiPhoneVerify(decision, {})).status, false);
  assert.equal(untrusted.scripts.length, 0, 'Untrusted sources never become script tags');
  assert.equal((await untrusted.context.__qishuiPhoneVerify({ verify_center_decision_conf: '{broken' }, {})).status, false);
  assert.equal((await untrusted.context.__qishuiPhoneVerify({ verify_center_decision_conf: { code: 999 } }, {})).status, false);

  const missing = harness();
  assert.equal((await missing.context.__qishuiPhoneVerify(decision, {})).status, false);
  assert.equal(missing.scripts.length, 3, 'Only three fixed official resource URLs can load');
  assert.ok(missing.scripts.every(script => script.src.includes('/1.0.0.427/index.js')));
  assert.equal((await missing.context.__qishuiPhoneVerify({ error_code: 1105 }, {})).status, false);
  assert.equal(missing.scripts.length, 3, 'An error code alone does not fabricate a verification flow');

  console.log('Qishui phone verification checks passed: official SDK callbacks, fingerprint, explicit cancellation and late load, fallback and resource restrictions; no network or SMS.');
})().catch(error => { console.error(error); process.exitCode = 1; });
