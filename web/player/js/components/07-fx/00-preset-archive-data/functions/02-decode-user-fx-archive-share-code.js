'use strict';


async function decodeUserFxArchiveShareCode(text) {
  var code = extractUserFxShareCode(text);
  if (!code) throw new Error('INVALID_SHARE_CODE');
  var parts = code.slice((USER_FX_SHARE_PREFIX + ':').length).split('.');
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) throw new Error('INVALID_SHARE_CODE');
  var version = parts[0];
  var body = parts[1];
  var checksum = parts[2].toUpperCase();
  if (version !== String(USER_FX_SHARE_VERSION)) throw new Error('UNSUPPORTED_SHARE_VERSION');
  if (userFxShareChecksum(version + '.' + body) !== checksum) throw new Error('BAD_SHARE_CHECKSUM');
  var codec = body.charAt(0);
  var bytes = base64UrlToBytes(body.slice(1));
  var json = '';
  if (codec === USER_FX_SHARE_CODEC_GZIP) {
    json = await gunzipUserFxShareText(bytes);
  } else if (codec === USER_FX_SHARE_CODEC_JSON) {
    json = new TextDecoder().decode(bytes);
  } else {
    throw new Error('UNSUPPORTED_SHARE_CODEC');
  }
  var payload = JSON.parse(json);
  var archiveSchema = 0;
  var archiveName = '';
  var archiveSavedAt = Date.now();
  var compactSnapshot = null;
  if (Array.isArray(payload)) {
    archiveSchema = Number(payload[0]);
    if (Array.isArray(payload[1])) {
      compactSnapshot = payload[1];
    } else {
      archiveName = payload[1];
      compactSnapshot = payload[2];
    }
  } else if (payload && typeof payload === 'object') {
    archiveSchema = Number(payload.s);
    archiveName = payload.n;
    archiveSavedAt = Number(payload.a) || Date.now();
    compactSnapshot = payload.v;
  }
  if (!payload || archiveSchema !== USER_FX_ARCHIVE_SCHEMA) {
    throw new Error('INVALID_SHARE_PAYLOAD');
  }
  var snapshot = expandUserFxArchiveSnapshot(compactSnapshot);
  if (!snapshot) throw new Error('INVALID_SHARE_SNAPSHOT');
  return {
    name: normalizeUserFxArchiveName(archiveName || '短代码存档', userFxArchives.length),
    createdAt: Date.now(),
    savedAt: archiveSavedAt,
    snapshot: snapshot
  };
}

function addImportedUserFxArchiveSlot(slot, toastLabel) {
  if (!slot || !slot.snapshot) return false;
  userFxArchives.push(slot);
  saveUserFxArchives();
  renderUserFxArchives();
  showToast((toastLabel || '已导入 ') + slot.name);
  return true;
}

function getArchiveClipboardApi() {
  return typeof getDesktopWindowApi === 'function' ? getDesktopWindowApi() : null;
}

async function writeUserFxArchiveClipboard(text) {
  var api = getArchiveClipboardApi();
  if (api && typeof api.copyText === 'function') {
    var res = await Promise.resolve(api.copyText(text));
    if (!res || res.ok !== false) return true;
  }
  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    await navigator.clipboard.writeText(text);
    return true;
  }
  var area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', 'readonly');
  area.style.position = 'fixed';
  area.style.left = '-9999px';
  document.body.appendChild(area);
  area.select();
  var ok = false;
  try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
  document.body.removeChild(area);
  return ok;
}

async function readUserFxArchiveClipboard() {
  var api = getArchiveClipboardApi();
  if (api && typeof api.readText === 'function') {
    var res = await Promise.resolve(api.readText());
    if (res && res.ok !== false) return String(res.text || '');
  }
  if (navigator.clipboard && typeof navigator.clipboard.readText === 'function') {
    return await navigator.clipboard.readText();
  }
  return '';
}

async function copyUserFxArchiveShareCode(index) {
  var slot = userFxArchiveAt(index);
  if (!slot || !slot.snapshot) {
    showToast('空白存档不能复制短码');
    return;
  }
  try {
    var code = await encodeUserFxArchiveShareCode(slot);
    var copied = false;
    try { copied = await writeUserFxArchiveClipboard(code); } catch (_) { }
    if (copied) {
      showToast(code.length > 12000 ? '完整短码已复制，配置较长' : '用户存档短码已复制');
    } else {
      if (!window.mineradioDialogs || typeof window.mineradioDialogs.reveal !== 'function') {
        showToast('复制暂时不可用，请稍后重试');
        return;
      }
      await window.mineradioDialogs.reveal({
        title: '复制 MR2 短代码', description: '自动复制未完成，可复制下方完整短代码。', value: code
      });
      showToast('已打开完整短码');
    }
  } catch (e) {
    showToast('短码生成失败');
  }
}

async function importUserFxArchiveShareCodeText(text) {
  try {
    var slot = await decodeUserFxArchiveShareCode(text);
    return addImportedUserFxArchiveSlot(slot, '已导入短码 ');
  } catch (e) {
    showToast(e && e.message === 'BAD_SHARE_CHECKSUM' ? '短码校验失败，未导入' : '短码无效，未导入');
    return false;
  }
}

function userFxArchiveShareInput() {
  return document.getElementById('user-archive-share-input');
}

function updateUserFxArchiveShareDraft(value) {
  userFxArchiveShareDraft = String(value || '');
}

function focusUserFxArchiveShareInput(selectAll) {
  var input = userFxArchiveShareInput();
  if (!input) return;
  input.focus();
  if (selectAll) input.select();
}

async function pasteUserFxArchiveShareCodeToBox() {
  var text = '';
  try {
    text = await readUserFxArchiveClipboard();
  } catch (e) {
    text = '';
  }
  text = String(text || '').trim();
  if (!text) {
    showToast('剪贴板里没有可粘贴的存档码');
    focusUserFxArchiveShareInput(false);
    return false;
  }
  userFxArchiveShareDraft = text;
  var input = userFxArchiveShareInput();
  if (input) {
    input.value = userFxArchiveShareDraft;
    input.focus();
  }
  showToast(looksLikeUserFxShareCode(text) ? '短码已粘到输入框' : '已粘到输入框，可尝试作为旧 JSON 导入');
  return true;
}

async function importUserFxArchiveShareCodeFromBox() {
  var input = userFxArchiveShareInput();
  var text = input ? input.value : userFxArchiveShareDraft;
  userFxArchiveShareDraft = String(text || '');
  if (!userFxArchiveShareDraft.trim()) {
    showToast('先把 MR2 短码粘到输入框');
    focusUserFxArchiveShareInput(false);
    return false;
  }
  var ok = await importUserFxArchiveText(userFxArchiveShareDraft, '短代码');
  if (ok) {
    userFxArchiveShareDraft = '';
    renderUserFxArchives();
  }
  return ok;
}

function clearUserFxArchiveShareCodeBox() {
  userFxArchiveShareDraft = '';
  var input = userFxArchiveShareInput();
  if (input) {
    input.value = '';
    input.focus();
  }
}

function handleUserFxArchiveShareInputKey(e) {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault();
    importUserFxArchiveShareCodeFromBox();
  }
}

async function importUserFxArchiveFromShareCodePrompt() {
  return pasteUserFxArchiveShareCodeToBox();
}

function renderUserFxArchives() {
  var grid = document.getElementById('user-archive-grid');
  if (!grid) return;
  var toolbar =
    '<div class="user-archive-toolbar">' +
    '<div class="user-archive-note">主入口使用 MR2 短代码复制/粘贴；旧 JSON 仍可拖拽或作为兼容备份导入。</div>' +
    '<div class="user-archive-tools">' +
    '<button class="fx-mini-btn ghost" type="button" onclick="createUserFxArchive()">新建</button>' +
    '<button class="fx-mini-btn ghost" type="button" onclick="importUserFxArchiveFromShareCodePrompt()">粘贴码</button>' +
    '<button class="fx-mini-btn ghost" type="button" onclick="importUserFxArchiveFromDialog()">导入 JSON</button>' +
    '</div>' +
    '</div>';
  var shareBox =
    '<div class="user-archive-share-panel">' +
    '<textarea id="user-archive-share-input" class="user-archive-share-input" spellcheck="false" placeholder="把 MR2 短代码粘到这里，也兼容旧 JSON 存档" oninput="updateUserFxArchiveShareDraft(this.value)" onkeydown="handleUserFxArchiveShareInputKey(event)">' + escHtml(userFxArchiveShareDraft) + '</textarea>' +
    '<div class="user-archive-share-actions">' +
    '<button type="button" onclick="pasteUserFxArchiveShareCodeToBox()">从剪贴板粘贴</button>' +
    '<button type="button" onclick="importUserFxArchiveShareCodeFromBox()">导入短码</button>' +
    '<button type="button" onclick="clearUserFxArchiveShareCodeBox()">清空</button>' +
    '</div>' +
    '</div>';
  var cards = userFxArchives.map(function (slot, index) {
    var hasSave = !!slot.snapshot;
    var editing = userFxArchiveEditing === index;
    var nameHtml = editing
      ? '<input class="user-archive-input" id="user-archive-input-' + index + '" type="text" maxlength="28" value="' + escHtml(slot.name) + '" onkeydown="handleUserFxArchiveRenameKey(event,' + index + ')">'
      : '<div class="user-archive-name" title="' + escHtml(slot.name) + '">' + escHtml(slot.name) + '</div>';
    var actionsHtml = editing
      ? '<button type="button" onclick="commitUserFxArchiveRename(' + index + ')">确定</button>' +
      '<button type="button" onclick="cancelUserFxArchiveRename()">取消</button>'
      : '<button type="button" onclick="applyUserFxArchive(' + index + ')"' + (hasSave ? '' : ' disabled') + '>应用</button>' +
      '<button type="button" onclick="saveUserFxArchive(' + index + ')">保存</button>' +
      '<button type="button" onclick="copyUserFxArchiveShareCode(' + index + ')"' + (hasSave ? '' : ' disabled') + '>复制码</button>' +
      '<button type="button" onclick="renameUserFxArchive(' + index + ')">命名</button>' +
      '<button type="button" onclick="exportUserFxArchive(' + index + ')"' + (hasSave ? '' : ' disabled') + '>文件</button>' +
      '<button type="button" onclick="removeUserFxArchive(' + index + ')">删除</button>';
    return '<div class="user-archive-slot' + (hasSave ? ' has-save' : '') + '" data-slot="' + index + '">' +
      nameHtml +
      '<div class="user-archive-meta">' + (hasSave ? formatUserArchiveTime(slot.savedAt) : '空白存档，点击保存写入当前视觉') + '</div>' +
      '<div class="user-archive-actions">' + actionsHtml + '</div>' +
      '</div>';
  }).join('');
  var addCard = '<button class="user-archive-slot is-new" type="button" onclick="createUserFxArchive()"><strong>＋ 新建空白存档</strong><span class="user-archive-meta">可继续创建，不限制 4 个</span></button>';
  grid.innerHTML = toolbar + shareBox + cards + addCard;
  bindUserFxArchiveDrop();
  if (userFxArchiveEditing >= 0) {
    setTimeout(function () {
      var input = document.getElementById('user-archive-input-' + userFxArchiveEditing);
      if (input) {
        input.focus();
        input.select();
      }
    }, 0);
  }
}

function createUserFxArchive() {
  var index = userFxArchives.length;
  userFxArchives.push({
    name: normalizeUserFxArchiveName('', index),
    createdAt: Date.now(),
    savedAt: 0,
    snapshot: null
  });
  userFxArchiveEditing = index;
  saveUserFxArchives();
  renderUserFxArchives();
  showToast('已新建空白用户存档');
}

function saveUserFxArchive(index) {
  var slot = userFxArchiveAt(index);
  if (!slot) return;
  slot.snapshot = captureFxArchiveSnapshot();
  slot.savedAt = Date.now();
  slot.createdAt = slot.createdAt || slot.savedAt;
  slot.name = normalizeUserFxArchiveName(slot.name, index);
  saveUserFxArchives();
  renderUserFxArchives();
  showToast('已保存到 ' + slot.name);
}

function applyUserFxArchive(index) {
  var slot = userFxArchiveAt(index);
  if (!slot || !slot.snapshot) {
    showToast('这个用户存档还是空白');
    return;
  }
  if (applyFxArchiveSnapshot(slot.snapshot)) showToast('已应用 ' + slot.name);
}

function renameUserFxArchive(index) {
  if (!userFxArchiveAt(index)) return;
  userFxArchiveEditing = Math.floor(Number(index) || 0);
  renderUserFxArchives();
}

function commitUserFxArchiveRename(index) {
  var slot = userFxArchiveAt(index);
  if (!slot) return;
  var input = document.getElementById('user-archive-input-' + index);
  slot.name = normalizeUserFxArchiveName(input && input.value, index);
  slot.createdAt = slot.createdAt || Date.now();
  userFxArchiveEditing = -1;
  saveUserFxArchives();
  renderUserFxArchives();
  showToast('已命名为 ' + slot.name);
}

function cancelUserFxArchiveRename() {
  userFxArchiveEditing = -1;
  renderUserFxArchives();
}

function removeUserFxArchive(index) {
  if (!userFxArchiveAt(index)) return;
  userFxArchives.splice(index, 1);
  userFxArchiveEditing = -1;
  saveUserFxArchives();
  renderUserFxArchives();
  showToast('已删除用户存档');
}

function userFxArchiveExportPayload(slot) {
  return {
    type: USER_FX_ARCHIVE_EXPORT_TYPE,
    schema: USER_FX_ARCHIVE_SCHEMA,
    exportedAt: Date.now(),
    name: slot.name,
    savedAt: slot.savedAt,
    snapshot: slot.snapshot
  };
}

function safeArchiveFileName(name) {
  return String(name || 'Mineradio 用户存档').replace(/[\\/:*?"<>|]+/g, '-').slice(0, 48) + '.json';
}

function exportUserFxArchive(index) {
  var slot = userFxArchiveAt(index);
  if (!slot || !slot.snapshot) {
    showToast('空白存档不能导出');
    return;
  }
  var payload = userFxArchiveExportPayload(slot);
  var text = JSON.stringify(payload, null, 2);
  var api = getDesktopWindowApi && getDesktopWindowApi();
  if (api && typeof api.exportJsonFile === 'function') {
    api.exportJsonFile({ defaultName: safeArchiveFileName(slot.name), text: text }).then(function (res) {
      if (res && res.ok) showToast('用户存档已导出');
      else if (!res || !res.canceled) showToast('用户存档导出失败');
    }).catch(function () { showToast('用户存档导出失败'); });
    return;
  }
  var blob = new Blob([text], { type: 'application/json;charset=utf-8' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = safeArchiveFileName(slot.name);
  a.click();
  setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
}
