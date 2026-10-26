'use strict';

// Only the desktop login-window readiness checks are retained here. Platform
// requests and request-scoped credentials remain owned by the Python backend.
function cookieObject(text) {
  const result = {};
  for (const piece of String(text || '').split(';')) {
    const index = piece.indexOf('=');
    if (index < 1) continue;
    const key = piece.slice(0, index).trim();
    let value = piece.slice(index + 1).trim();
    try { value = decodeURIComponent(value); } catch (_) {}
    result[key] = value;
  }
  return result;
}

function extractKugouAuth(text) {
  const object = cookieObject(text);
  const compound = object.KuGoo || object.kugou || object.Kugou || '';
  const nested = cookieObject(compound.replace(/&/g, ';'));
  const userid = String(object.userid || object.UserId || object.KugooID || object.kugouID || nested.KugooID || nested.kugouID || nested.userid || nested.uid || '').replace(/\D/g, '');
  const token = String(object.token || object.Token || object.t || object.T || nested.t || nested.token || '').trim();
  return { loggedIn: !!(userid && userid !== '0') || !!compound, playbackReady: !!(userid && userid !== '0' && token) };
}

function qishuiCookieHasLogin(text) {
  return /(?:^|;\s*)(sessionid|sessionid_ss|sid_guard|sid_tt|uid_tt|uid_tt_ss)=/i.test(String(text || ''));
}

module.exports = { extractKugouAuth, qishuiCookieHasLogin };
