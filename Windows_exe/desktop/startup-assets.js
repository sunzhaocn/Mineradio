'use strict';
const fs = require('fs');
const path = require('path');

function startupQuery(userData, appName) {
  let initialized = false;
  try {
    const marker = path.join(userData, 'data', 'runtime', 'cache', 'asset-init-v1.json');
    if (fs.statSync(marker).size <= 1024 * 1024) {
      const state = JSON.parse(fs.readFileSync(marker, 'utf8'));
      initialized = state.version === 1 && state.initialized === true;
    }
  } catch (_) { /* A fresh or damaged profile receives the first-start hint. */ }
  return { appName: String(appName || 'Mineradio'), initialize: initialized ? '0' : '1' };
}

module.exports = { startupQuery };
