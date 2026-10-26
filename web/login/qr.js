"use strict";
async function poll(version) {
  if (version !== epoch) return;
  try {
    const data = await api(
      "/login/" +
        platforms[selected][0] +
        "/check?key=" +
        encodeURIComponent(key),
    );
    if (version !== epoch) return;
    showDiagnostics(data);
    showVerification(data);
    if (data.authorized) {
      showResult(data);
      return;
    }
    text(
      "status",
      {
        waiting: "等待扫码",
        scanned: "已扫码，等待确认",
        verification_required: "需要完成安全验证",
        cooldown: "平台暂时要求稍后重试",
        expired: "二维码已过期",
        cancelled: "已取消登录",
      }[data.status] || data.status,
    );
    text("message", data.last_error?.message || data.message);
    if (data.status === "expired" || data.status === "cancelled") {
      text("countdown", "点击“重新生成”继续。");
      expiry = 0;
      return;
    }
    timer = setTimeout(
      () => poll(version),
      Math.max(3, data.retry_after || 3) * 1000,
    );
  } catch (error) {
    if (version !== epoch) return;
    showDiagnostics(error);
    if ([400, 403, 404, 429].includes(error.status)) {
      text("status", "需要重新生成二维码");
      text("message", error.message);
      text("countdown", "点击“重新生成”继续。");
      expiry = 0;
      return;
    }
    text(
      "status",
      error.status === 409 ? "需要完成额外验证" : "凭据获取暂时失败",
    );
    text("message", error.message + "；正在重试。");
    timer = setTimeout(() => poll(version), 5000);
  }
}
async function create() {
  completed.delete(slot());
  renderResults();
  const version = ++epoch;
  clearTimeout(timer);
  clearSecrets();
  key = "";
  result = null;
  expiry = 0;
  phoneBusy = false;
  $("success").hidden = true;
  $("cookie").value = "";
  text("credentials", "");
  $("diagnosticsBox").hidden = true;
  $("verification").hidden = true;
  $("loginWindow").hidden = true;
  openWindowUrl = "";
  $("qr").hidden = true;
  $("empty").hidden = false;
  text("empty", "正在准备二维码…");
  text("status", selected === 0 ? "正在建立登录会话" : "正在生成二维码");
  text(
    "message",
    selected === 0
      ? "准备手机号登录，不会自动发送短信。"
      : "正在连接官方登录服务。",
  );
  text("countdown", "");
  $("refresh").disabled = true;
  renderAccount();
  if (selected === 0) {
    phoneBusy = true;
    updatePhoneButtons();
    try {
      await newPhoneSession(version);
    } catch (error) {
      if (version === epoch) phoneError(error);
    } finally {
      if (version === epoch) {
        phoneBusy = false;
        updatePhoneButtons();
      }
    }
    return;
  }
  try {
    const query =
      selected === 1
        ? "?method=" + encodeURIComponent($("qqMethod").value)
        : "";
    const data = await api("/login/" + platforms[selected][0] + "/qr" + query);
    if (version !== epoch) return;
    key = data.key;
    expiry = data.expires_at * 1000;
    if (!data.qr_image) throw new Error("接口未返回二维码图片");
    $("qr").src = data.qr_image;
    $("qr").hidden = false;
    $("empty").hidden = true;
    text("status", "等待扫码");
    text(
      "message",
      data.message || "请打开" + scanner() + "，扫一扫并在手机上确认登录。",
    );
    showDiagnostics(data);
    showVerification(data);
    poll(version);
  } catch (error) {
    if (version !== epoch) return;
    showDiagnostics(error);
    text("status", "二维码生成失败");
    text("message", error.message);
    text("empty", "请点击“重新生成”重试。");
  } finally {
    if (version === epoch) $("refresh").disabled = false;
  }
}
