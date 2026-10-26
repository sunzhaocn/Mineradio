'use strict';
const fs = require('node:fs');
const path = require('node:path');

function createDesktopPreferences({ app, userData, name, executable }) {
  const file = path.join(userData, 'desktop-preferences.json');
  let saved = {};
  try { saved = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) {}
  let closeBehavior = saved.closeBehavior === 'exit' ? 'exit' : 'tray';
  const loginOptions = () => ({ path: executable(), args: ['--start-in-tray'] });
  function startup() {
    if (process.platform !== 'win32' || !app.isPackaged) return { supported: false, enabled: false };
    const state = app.getLoginItemSettings(loginOptions());
    // Electron 45 can omit parsed args, making openAtLogin false for a valid
    // --start-in-tray entry. Its named launch item still reports Windows state.
    const own = (state.launchItems || []).find(item => item.name === name && item.path &&
      path.resolve(item.path).toLowerCase() === path.resolve(executable()).toLowerCase());
    return { supported: true, enabled: own ? own.enabled !== false : state.openAtLogin === true };
  }
  return {
    getCloseBehavior: () => closeBehavior,
    setCloseBehavior(value) {
      closeBehavior = value === 'exit' ? 'exit' : 'tray';
      fs.mkdirSync(userData, { recursive: true });
      const temporary = file + '.tmp';
      fs.writeFileSync(temporary, JSON.stringify({ version: 1, closeBehavior }, null, 2));
      fs.renameSync(temporary, file);
      return closeBehavior;
    },
    startup,
    setStartup(enabled) {
      if (typeof enabled !== 'boolean' || !app.isPackaged || process.platform !== 'win32') {
        throw new Error('开机自启动只支持已打包的 Windows 桌面版');
      }
      app.setLoginItemSettings({ ...loginOptions(), name, openAtLogin: enabled, enabled });
      const result = startup();
      if (result.enabled !== enabled) throw new Error('Windows 未确认开机自启动设置，请检查系统启动应用设置');
      return result;
    },
  };
}
module.exports = { createDesktopPreferences };
