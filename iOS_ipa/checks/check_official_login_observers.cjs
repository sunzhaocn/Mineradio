'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../src/mineradio/official_login.py'), 'utf8');
const script = /KUGOU_OBSERVER = r'''([\s\S]*?)'''/.exec(source)[1];
function context(host = 'login-user.kugou.com') {
  const messages = [];
  class XHR {
    constructor() { this.listeners = []; }
    addEventListener(name, handler) { if (name === 'loadend') this.listeners.push(handler); }
    open(method, url) { this.responseURL = url; }
    complete(data, status = 200) {
      this.status = status; this.responseText = JSON.stringify(data);
      for (const handler of this.listeners) handler.call(this);
    }
  }
  const page = { URL, location: { hostname: host, href: `https://${host}/login/?appid=1014` }, XMLHttpRequest: XHR,
    webkit: { messageHandlers: { mineradioNeteaseLogin: { postMessage: value => messages.push(JSON.parse(JSON.stringify(value))) } } } };
  page.window = page;
  vm.runInNewContext(script, page);
  return { page, messages };
}
const fixture = { status: 1, error_code: 0, data: { status: 4, userid: 12345, token: 'synthetic-client',
  password: 'never-forward', captcha: 'never-forward', nickname: 'not-required' } };
const good = context();
const request = new good.page.XMLHttpRequest();
request.open('GET', 'https://login-user.kugou.com/v2/get_userinfo_qrcode?qrcode=synthetic');
request.complete(fixture);
assert.deepEqual(good.messages, [{ kind: 'kugou-client', path: '/v2/get_userinfo_qrcode', token: 'synthetic-client', userid: '12345' }]);
assert.ok(!JSON.stringify(good.messages).includes('never-forward'));
for (const url of ['https://unrelated.example/v2/get_userinfo_qrcode', 'http://login-user.kugou.com/v2/get_userinfo_qrcode',
  'https://login-user.kugou.com:444/v2/get_userinfo_qrcode', 'https://x@login-user.kugou.com/v2/get_userinfo_qrcode',
  'https://login-user.kugou.com/v2/loginbyverifycode/']) {
  const test = context(), xhr = new test.page.XMLHttpRequest();
  xhr.open('GET', url); xhr.complete(fixture);
  assert.equal(test.messages.length, 0, url);
}
for (const data of [{ ...fixture, status: 0 }, { ...fixture, error_code: 1 },
  { status: 1, data: { ...fixture.data, status: 2 } }, { status: 1, data: { ...fixture.data, token: null } }]) {
  const test = context(), xhr = new test.page.XMLHttpRequest();
  xhr.open('GET', 'https://login-user.kugou.com/v2/get_userinfo_qrcode'); xhr.complete(data);
  assert.equal(test.messages.length, 0);
}
const foreign = context('unrelated.example'), xhr = new foreign.page.XMLHttpRequest();
xhr.open('GET', 'https://login-user.kugou.com/v2/get_userinfo_qrcode'); xhr.complete(fixture);
assert.equal(foreign.messages.length, 0);
console.log('Official login observer checks passed: confirmed same-flow response only, no form data or network.');
