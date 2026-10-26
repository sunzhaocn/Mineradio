'use strict';


function setAudioInputBridgeDevice(deviceId, showNotice) {
  deviceId = String(deviceId || '');
  if (!deviceId) {
    if (showNotice) showToast('未检测到虚拟麦克风线缆输出端');
    renderAudioOutputDeviceUi();
    return;
  }
  var wasEnabled = !!(audioInputBridgeState && audioInputBridgeState.enabled && audioInputBridgeState.deviceId === deviceId);
  audioInputBridgeState = { enabled: !wasEnabled, deviceId: deviceId };
  saveAudioInputBridgePreference();
  if (audioInputBridgeState.enabled) {
    audioOutputDeviceId = deviceId;
    audioOutputMirrorDeviceIds = normalizeAudioOutputIdList(audioOutputMirrorDeviceIds).filter(function (id) { return id !== deviceId; });
    saveAudioOutputMirrorPreference();
    saveAudioOutputDevicePreference();
    Promise.resolve(applyAudioOutputDevice(audio)).then(function () {
      if (showNotice) showToast('已连接到虚拟麦克风桥接');
    });
  } else {
    if (audioOutputDeviceId === deviceId) {
      audioOutputDeviceId = '';
      saveAudioOutputDevicePreference();
      Promise.resolve(applyAudioOutputDevice(audio));
    }
    if (showNotice) showToast('已关闭虚拟麦克风桥接');
  }
  renderAudioOutputDeviceUi();
}