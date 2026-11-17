'use strict';

const titles = { netease: '网易云音乐', qq: 'QQ 音乐', kugou: '酷狗音乐', qishui: '汽水音乐' };
const field = id => document.getElementById(id);
const tabs = Array.from(document.querySelectorAll('[data-provider]'));
let provider = 'netease';
let inventory = {};
let working = false;

function report(message, error = false) {
  field('message').textContent = message;
  field('message').classList.toggle('error', error);
}

async function request(path, payload) {
  const options = { cache: 'no-store', credentials: 'same-origin' };
  if (payload) {
    options.method = 'POST';
    options.headers = { 'Content-Type': 'application/json' };
    options.body = JSON.stringify(payload);
  }
  const response = await fetch('api/' + path, options);
  const result = await response.json();
  if (!response.ok) throw new Error(result.message || '服务器请求暂时失败');
  return result;
}

function render() {
  tabs.forEach(tab => tab.setAttribute('aria-pressed', String(tab.dataset.provider === provider)));
  field('platform').textContent = titles[provider];
  field('qishui-fields').hidden = provider !== 'qishui';
  const account = inventory[provider];
  field('account-state').textContent = !account ? '正在读取账号状态…' : account.configured ? '已保存登录资料' : '尚未保存登录资料';
  field('remove').disabled = working || !account?.configured;
  field('save').disabled = working;
}

async function refresh() {
  inventory = await request('accounts');
  render();
}

tabs.forEach(tab => tab.addEventListener('click', () => {
  provider = tab.dataset.provider;
  field('cookie-form').reset();
  report('');
  render();
}));

async function update(path, payload, message) {
  if (working) return;
  working = true;
  render();
  try {
    await request(path, payload);
    if (provider === payload.provider) field('cookie-form').reset();
    await refresh();
    if (provider === payload.provider) report(message);
  } catch (error) {
    if (provider === payload.provider) report(error.message, true);
  } finally {
    working = false;
    render();
  }
}

field('cookie-form').addEventListener('submit', event => {
  event.preventDefault();
  update('save', {
    provider, cookie: field('cookie').value.trim(),
    device_id: field('device-id').value.trim(), install_id: field('install-id').value.trim()
  }, '已保存，已授权客户端会自动领取。');
});

field('remove').addEventListener('click', () => {
  if (confirm('清除服务器上的' + titles[provider] + '登录资料？')) {
    update('remove', { provider }, '服务器上的登录资料已清除。');
  }
});

render();
refresh().catch(error => report(error.message, true));
