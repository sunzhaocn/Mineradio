/* Official Qishui PC 3.7.0 Passport verification in the current WebKit session.
 * No SMS/login request is made here. The caller explicitly retries afterward.
 * Verified runtime: verifycenter 1.0.0.427, SHA-256
 * 34ab7e29bc9f638008074bf615570cb940815ca67e28ff2a29e22af24d721be2.
 */
(function () {
  'use strict';

  const sdkURLs = [
    'https://lf-rc1.yhgfb-cn-static.com/obj/rc-verifycenter/verifycenter/1.0.0.427/index.js',
    'https://lf-rc2.yhgfb-cn-static.com/obj/rc-verifycenter/verifycenter/1.0.0.427/index.js',
    'https://lf-cdn-tos.bytescm.com/obj/rc-verifycenter/verifycenter/1.0.0.427/index.js',
  ];
  let sdkPromise = null;
  let active = null;
  let cancelActive = null;
  let revision = 0;

  function sdkAvailable() {
    const sdk = window.verifySDK;
    return sdk && typeof sdk.initVerifyOptions === 'function' &&
      typeof sdk.autoRender === 'function' ? sdk : null;
  }

  function allowedSDKURL(value) {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && !url.username && !url.password &&
        (!url.port || url.port === '443') && !url.hash && sdkURLs.includes(url.href) &&
        (!window.__qishuiIOSAllowedResource || window.__qishuiIOSAllowedResource(url.href));
    } catch (_) {
      return false;
    }
  }

  function loadScript(url) {
    if (!allowedSDKURL(url)) return Promise.reject(new Error('verification_resource'));
    return new Promise(function (resolve, reject) {
      const script = document.createElement('script');
      let settled = false;
      const finish = function (error) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        script.onload = script.onerror = null;
        if (error) {
          if (script.parentNode) script.parentNode.removeChild(script);
          reject(error);
        } else {
          const sdk = sdkAvailable();
          if (sdk) resolve(sdk);
          else reject(new Error('verification_sdk_export'));
        }
      };
      const timer = setTimeout(function () { finish(new Error('verification_sdk_timeout')); }, 20000);
      script.crossOrigin = 'anonymous';
      script.async = true;
      script.onload = function () { finish(); };
      script.onerror = function () { finish(new Error('verification_sdk_load')); };
      script.src = url;
      (document.head || document.documentElement).appendChild(script);
    });
  }

  function loadSDK() {
    const existing = sdkAvailable();
    if (existing) return Promise.resolve(existing);
    if (sdkPromise) return sdkPromise;
    const source = window.__qishuiVerifySDKSource;
    const urls = source === undefined ? sdkURLs : [source];
    sdkPromise = (async function () {
      for (const url of urls) {
        try { return await loadScript(url); } catch (_) { /* Try the official fallback. */ }
      }
      throw new Error('verification_sdk_unavailable');
    })().catch(function (error) { sdkPromise = null; throw error; });
    return sdkPromise;
  }

  function fingerprintValue(value) {
    return typeof value === 'string' && value.length <= 512 && !/[\x00-\x20\x7f]/.test(value) ? value : '';
  }

  async function fingerprint(sdk) {
    // This is the actual global export. verifySDK.getFp() does not exist.
    if (typeof sdk.getCaptchaWebId === 'function') {
      try {
        const value = fingerprintValue(await sdk.getCaptchaWebId());
        if (value) return value;
      } catch (_) { /* Use the same first-party storage as the official facade. */ }
    }
    try {
      const match = document.cookie.match(/(?:^|;\s*)s_v_web_id=([^;]*)/);
      const value = match && fingerprintValue(decodeURIComponent(match[1]));
      if (value) return value;
    } catch (_) { /* Cookie storage may be unavailable. */ }
    try { return fingerprintValue(localStorage.getItem('s_v_web_id')); } catch (_) { return ''; }
  }

  function parsedDecision(decision) {
    if (!decision || typeof decision !== 'object' || Array.isArray(decision)) return null;
    const data = decision.data && typeof decision.data === 'object' ? decision.data : {};
    let value = data.verify_center_decision_conf || data.verify_center_secondary_decision_conf ||
      decision.verify_center_decision_conf || decision.verify_center_secondary_decision_conf;
    if (typeof value === 'string') {
      if (value.length > 262144) return null;
      try { value = JSON.parse(value); } catch (_) { return null; }
    }
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
        ![10000, 20000, 30000, 40000].includes(Number(value.code))) return null;
    return value;
  }

  function identity(value) {
    return typeof value === 'string' || typeof value === 'number' ? String(value) : '0';
  }

  function verify(decision, options, currentRevision) {
    const verifyData = parsedDecision(decision);
    if (!verifyData) {
      const data = decision && decision.data && typeof decision.data === 'object' ? decision.data : {};
      const errorCode = Number(data.error_code || (decision && decision.error_code));
      const url = data.url || (decision && decision.url);
      // The existing wrapper validates and loads the official second-verification URL.
      if (errorCode === 2046 && url && typeof window.__qishuiSecondVerify === 'function') {
        return Promise.resolve().then(function () {
          if (currentRevision !== revision) return { status: false };
          return window.__qishuiSecondVerify(Object.assign({}, decision, data), options || {});
        }).then(function (result) {
          return result && typeof result === 'object' && result.status === true ? result : { status: false };
        }).catch(function () { return { status: false }; });
      }
      return Promise.resolve({ status: false });
    }

    return loadSDK().then(function (sdk) {
      if (currentRevision !== revision) return { status: false };
      const params = options && options.generalParams || {};
      const data = decision.data && typeof decision.data === 'object' ? decision.data : {};
      const commonOptions = {
        repoId: 579047, aid: 386088,
        did: identity(params.did || params.device_id),
        iid: identity(params.iid || params.install_id),
      };
      const captchaOptions = {
        sideSlide: 'disabled', lang: 'zh', showMode: 'mask', region: 'cn',
        app_name: '汽水音乐', h5_check_version: '4.0.12',
      };
      const secondVerifyWebOptions = {
        host: 'https://api.qishui.com', verifyAppName: '汽水音乐移动端', scene: '4',
      };
      return new Promise(function (resolve) {
        let settled = false;
        let completing = false;
        const finish = function (result) {
          if (settled) return;
          settled = true;
          resolve(result);
        };
        const success = async function () {
          if (settled || completing) return;
          if (currentRevision !== revision) { finish({ status: false }); return; }
          completing = true;
          const fp = await fingerprint(sdk);
          const result = { status: true };
          if (fp) { result.fp = fp; result.verifyFp = fp; }
          const smsCodeKey = data.sms_code_key || decision.sms_code_key;
          if (Number(data.error_code || decision.error_code) === 2046 && typeof smsCodeKey === 'string') {
            result.sms_code_key = smsCodeKey;
          }
          finish(result);
        };
        const failure = function () { if (!completing) finish({ status: false }); };
        const secondarySuccess = function (result) {
          // verifycenter 1.0.0.427 gates the underlying verify().status first,
          // then calls this callback with {}. Requiring status:true here would
          // reject its normal successful callback. Never accept explicit failure.
          if (result === false || (result && typeof result === 'object' && result.status === false)) {
            failure();
          } else {
            success();
          }
        };
        try {
          // initVerifyOptions and autoRender are void APIs in the official runtime;
          // completion comes exclusively from their official success/close callbacks.
          sdk.initVerifyOptions({ commonOptions, captchaOptions, secondVerifyWebOptions });
          sdk.autoRender({
            verify_data: verifyData,
            captchaOptions: Object.assign({}, captchaOptions, {
              successCb: success, closeCb: failure, errorCb: failure,
            }),
            secondVerifyWebOptions: Object.assign({}, secondVerifyWebOptions, {
              callBack: secondarySuccess, closeCallBack: failure,
            }),
          });
        } catch (_) { failure(); }
      });
    }).catch(function () { return { status: false }; });
  }

  window.__qishuiPhoneVerify = function (decision, options) {
    if (active) return active;
    const currentRevision = revision;
    let cancel;
    const cancelled = new Promise(function (resolve) { cancel = resolve; });
    const task = Promise.race([verify(decision, options, currentRevision), cancelled]).then(function (result) {
      if (active === task) { active = null; cancelActive = null; }
      return result;
    }, function () {
      if (active === task) { active = null; cancelActive = null; }
      return { status: false };
    });
    active = task;
    cancelActive = function () { revision++; cancel({ status: false }); };
    return task;
  };

  window.__qishuiCancelPhoneVerify = function () {
    const cancel = cancelActive;
    if (!cancel) return false;
    cancel();
    const sdk = sdkAvailable();
    if (sdk && typeof sdk.closeCaptcha === 'function') {
      try { sdk.closeCaptcha(); } catch (_) { /* The cancelled promise is already settled. */ }
    }
    return true;
  };
})();
