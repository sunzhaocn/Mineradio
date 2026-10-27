// Execute the shipped UI script with synthetic DOM/fetch/timers only.
// No source rewriting, exported test hooks, network, accounts or SMS.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname,
  '../../web/player/js/components/local/local-auth/runtime/00-install-local-account-login.js'), 'utf8');

class Element {
  constructor(tag) {
    this.tagName = tag.toLowerCase(); this.children = []; this.listeners = new Map();
    this.attributes = {}; this.dataset = {}; this.value = ''; this.textContent = '';
    this.className = ''; this.disabled = false; this.hidden = false;
    const classes = () => new Set(this.className.split(/\s+/).filter(Boolean));
    this.classList = {
      add: (...names) => { this.className = [...new Set([...classes(), ...names])].join(' '); },
      remove: (...names) => { this.className = [...classes()].filter(name => !names.includes(name)).join(' '); },
      toggle: (name, enabled) => {
        const values = classes(); const on = enabled === undefined ? !values.has(name) : enabled;
        if (on) values.add(name); else values.delete(name);
        this.className = [...values].join(' '); return on;
      },
    };
  }
  appendChild(child) {
    this.children.push(child); child.parentNode = this;
    if (this.tagName === 'select' && !this.value) this.value = child.value;
    return child;
  }
  append(...children) { children.forEach(child => this.appendChild(child)); }
  setAttribute(name, value) { this.attributes[name] = String(value); if (name === 'id') this.id = String(value); }
  removeAttribute(name) { delete this.attributes[name]; if (name === 'src') delete this.src; }
  addEventListener(name, handler) {
    if (!this.listeners.has(name)) this.listeners.set(name, []);
    this.listeners.get(name).push(handler);
  }
  querySelector(selector) {
    const matches = node => selector.startsWith('.')
      ? node.className.split(/\s+/).includes(selector.slice(1))
      : selector.startsWith('#') ? node.id === selector.slice(1) : node.tagName === selector.toLowerCase();
    for (const child of this.children) {
      if (matches(child)) return child;
      const found = child.querySelector(selector); if (found) return found;
    }
    return null;
  }
  async click() {
    if (this.disabled) return;
    const event = { target: this, preventDefault() {}, stopImmediatePropagation() {} };
    await Promise.all((this.listeners.get('click') || []).map(handler => handler(event)));
  }
  reportValidity() { return true; }
  focus() {}
  select() {}
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function response(data, status = 200) { return { ok: status < 400, json: async () => data }; }
const flush = () => new Promise(resolve => setImmediate(resolve));

function harness() {
  const mask = new Element('div'); mask.id = 'login-modal';
  const panel = new Element('div'); panel.className = 'dual-login-modal'; mask.appendChild(panel);
  const head = new Element('div'); head.className = 'login-panel-head'; panel.appendChild(head);
  head.append(new Element('b'), new Element('small'));
  const close = new Element('button'); close.className = 'login-panel-close'; head.appendChild(close);
  const store = new Map(), timers = new Map(), calls = [], shows = [], checks = [];
  let nextTimer = 0, nextSession = 0;
  const timer = (fn, ms, interval) => { const id = ++nextTimer; timers.set(id, { fn, ms, interval }); return id; };
  const context = {
    URL, Promise, AbortController, Date, Event,
    MINERADIO_LOCAL_WEB: true, __mineradioIOS: true,
    location: { origin: 'http://127.0.0.1:18080' },
    crypto: { randomUUID: () => 'a'.repeat(32) },
    document: {
      hidden: false, createElement: tag => new Element(tag), addEventListener() {},
      getElementById: id => id === mask.id ? mask : mask.querySelector('#' + id),
    },
    localStorage: { getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, String(value)) },
    navigator: { clipboard: { writeText: async () => {} } },
    setTimeout: (fn, ms) => timer(fn, ms, false), clearTimeout: id => timers.delete(id),
    setInterval: (fn, ms) => timer(fn, ms, true), clearInterval: id => timers.delete(id),
    addEventListener() {}, dispatchEvent() {},
    MineradioSessionHealth: { create: () => ({
      status: () => ({ loggedIn: false, authState: 'unknown', configured: false }),
      refresh: async () => {}, observe() {},
    }) },
    hasPlatformLogin: () => false, firstLoggedProvider: () => 'netease',
    renderUserBtn() {}, providerAvatarSrc: () => '/synthetic-avatar.svg',
    providerVipBadge: () => '', stopQrPoll() {}, showToast() {},
    openGsapModal: node => { node.hidden = false; }, closeGsapModal: node => { node.hidden = true; },
    activeAccountProvider: 'netease', loginProvider: 'netease',
  };
  // These bindings normally precede the local module in the player bundle.
  for (const name of ['loginStatus', 'qqLoginStatus', 'kugouLoginStatus', 'qishuiLoginStatus',
    'loginStatusChecked', 'loginStatusCheckFailed', 'qqLoginWasLoggedIn', 'kugouLoginWasLoggedIn', 'qishuiLoginWasLoggedIn',
    'refreshLoginStatus', 'refreshQQLoginStatus', 'refreshKugouLoginStatus', 'refreshQishuiLoginStatus', 'refreshQQVipStatusNow',
    'showLoginModal', 'closeLoginModal', 'setLoginProvider', 'selectLoginProviderNode', 'logoutActiveAccount',
    'showUserModal', 'logoutAllAccountsAndResetEasterEgg']) context[name] = null;
  context.fetch = async (url, options) => {
    assert.ok(/^\/api\/local\/auth\/(session|show|check)$/.test(url), 'No real network or SMS endpoints');
    const operation = url.split('/').at(-1), body = JSON.parse(options.body);
    assert.ok(!('password' in body) && !('captcha' in body) && !('phone' in body), 'Official form secrets never enter local requests');
    calls.push({ operation, body });
    if (operation === 'session') return response({ key: 'synthetic-' + (++nextSession), status: 'waiting',
      manual_login: true, interactive_window: true, expires_in: 120 });
    const item = (operation === 'show' ? shows : checks).shift();
    if (item instanceof Error) throw item;
    if (item !== undefined) return await item;
    return response(operation === 'show' ? { shown: true, status: 'waiting' } : { status: 'waiting' });
  };
  context.window = context;
  vm.runInNewContext(source, context, { filename: '00-install-local-account-login.js' });
  context.showLoginModal({ provider: 'qq' });
  const button = context.document.getElementById('local-auth-open-official');
  const message = mask.querySelector('.local-auth-message');
  assert.ok(button && !button.disabled);
  const pollTimers = () => [...timers.entries()].filter(([, value]) => value.ms === 3000 && !value.interval);
  return { context, store, calls, shows, checks, button, message, pollTimers,
    async poll() {
      const pending = pollTimers(); assert.equal(pending.length, 1, 'Exactly one current poll timer');
      timers.delete(pending[0][0]); pending[0][1].fn(); await flush();
    },
  };
}

async function showFailureRecovery() {
  const failures = [
    ['login_session_missing', 404], ['official_login_closed', 409],
    ['official_login_unavailable', 503], ['official_login_timeout', 504],
    ['login_session_finished', 409], ['network', 0], ['abort', 0],
  ];
  for (const [code, status] of failures) {
    const h = harness(), pending = deferred(); h.shows.push(pending.promise);
    const click = h.button.click(); await flush();
    assert.equal(h.button.disabled, true, code + ': busy while opening');
    await h.button.click();
    assert.equal(h.calls.filter(call => call.operation === 'session').length, 1, 'A busy duplicate click creates no session');
    if (status) pending.resolve(response({ error: code, message: 'synthetic ' + code }, status));
    else { const error = new Error('synthetic ' + code); if (code === 'abort') error.name = 'AbortError'; pending.reject(error); }
    await click; await flush();
    assert.equal(h.button.disabled, false, code + ': finally releases Busy');
    assert.equal(h.message.dataset.kind, 'error');
    assert.equal(h.pollTimers().length, 0, 'A failed show does not automatically retry/poll');
    assert.equal(h.calls.length, 2, 'Only the explicit session + show ran');
    await h.button.click();
    assert.equal(h.calls.filter(call => call.operation === 'session').length, 2, code + ': next user click creates a fresh session');
    assert.deepEqual(h.calls.filter(call => call.operation === 'show').map(call => call.body.key), ['synthetic-1', 'synthetic-2']);
    assert.equal(h.button.disabled, false);
    assert.equal(h.pollTimers().length, 1);
    assert.equal(h.store.has('mineradio-local-accounts-v1'), false);
  }
}

async function staleCheckIsolation() {
  // Resolve between key clearing and next click to exercise key identity even
  // when the provider and action epoch have not changed yet. Also resolve after
  // new session creation to cover authorization, terminal and error outcomes.
  for (const when of ['before-new-click', 'after-new-click']) {
    for (const outcome of ['authorized', 'expired', 'error']) {
      const h = harness(), old = deferred();
      await h.button.click();
      h.checks.push(old.promise); await h.poll();
      assert.equal(h.calls.at(-1).body.key, 'synthetic-1');
      h.shows.push(response({ error: 'official_login_closed', message: 'synthetic closed' }, 409));
      await h.button.click(); // Reuse fails; key clears without advancing epoch.
      assert.equal(h.button.disabled, false);
      if (when === 'after-new-click') await h.button.click();
      const expectedMessage = h.message.textContent;
      if (outcome === 'error') old.reject(new Error('synthetic late check error'));
      else old.resolve(response(outcome === 'authorized'
        ? { status: 'authorized', authorized: true, cookie: 'qqmusic_key=synthetic-stale; uin=12345' }
        : { status: 'expired', message: 'synthetic stale expiration' }));
      await flush(); await flush();
      assert.equal(h.store.has('mineradio-local-accounts-v1'), false, 'Late authorization cannot save a stale account');
      assert.equal(h.message.textContent, expectedMessage, 'Late check cannot overwrite the current message');
      assert.equal(h.button.disabled, false, 'Late check cannot leave the current UI busy');
      if (when === 'before-new-click') await h.button.click();
      assert.equal(h.calls.filter(call => call.operation === 'session').length, 2);
      assert.equal(h.calls.filter(call => call.operation === 'show').at(-1).body.key, 'synthetic-2');
      await h.poll();
      assert.equal(h.calls.at(-1).operation, 'check');
      assert.equal(h.calls.at(-1).body.key, 'synthetic-2', 'The new poll retains the new key after old results settle');
      await h.button.click();
      assert.equal(h.calls.filter(call => call.operation === 'session').length, 2, 'A valid new key is still reusable');
    }
  }
}

(async () => {
  await showFailureRecovery();
  await staleCheckIsolation();
  console.log('Local auth window recovery passed: 7 show failures, Busy release, explicit fresh retry, and 6 stale-check interleavings; no network or account use.');
})().catch(error => { console.error(error); process.exitCode = 1; });
