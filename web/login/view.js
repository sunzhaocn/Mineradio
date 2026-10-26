"use strict";
function slot() {
  return (
    platforms[selected][0] + (selected === 1 ? ":" + $("qqMethod").value : "")
  );
}
function scanner() {
  return selected === 1
    ? { qq: "手机 QQ", wechat: "微信", mobile: "QQ 音乐 App" }[
        $("qqMethod").value
      ]
    : platforms[selected][2];
}
function showDiagnostics(data) {
  if (data.diagnostics?.length) {
    $("diagnosticsBox").hidden = false;
    text("diagnostics", JSON.stringify(data.diagnostics, null, 2));
  }
}
function showVerification(data) {
  openWindowUrl = "";
  if (selected === 0) {
    $("loginWindow").hidden = true;
    $("verification").hidden = true;
    $("verificationLink").removeAttribute("href");
    return;
  }
  let allowed = false;
  try {
    const url = new URL(data.verification_url);
    allowed =
      !data.interactive_window &&
      url.protocol === "https:" &&
      ["163.com", "qq.com", "qishui.com"].some(
        (host) => url.hostname === host || url.hostname.endsWith("." + host),
      );
  } catch {}
  $("loginWindow").hidden = true;
  $("verification").hidden = !allowed;
  if (allowed) $("verificationLink").href = data.verification_url;
  else $("verificationLink").removeAttribute("href");
}
function text(id, value) {
  $(id).textContent = value;
}
function renderAccount(account = {}) {
  $("account").replaceChildren();
  const dl = document.createElement("dl");
  for (const [name, value] of [
    ["平台", platforms[selected][1]],
    ["账号 ID", account.id || account.user_id || account.userid],
    ["昵称", account.name || account.nickname],
  ]) {
    if (value === undefined || value === "") continue;
    const dt = document.createElement("dt"),
      dd = document.createElement("dd");
    dt.textContent = name;
    dd.textContent = String(value);
    dl.append(dt, dd);
  }
  $("account").append(dl);
}
function showResult(data) {
  result = data;
  clearTimeout(timer);
  clearSecrets();
  $("success").hidden = false;
  $("loginWindow").hidden = true;
  $("verification").hidden = true;
  openWindowUrl = "";
  $("qr").hidden = true;
  text("empty", "✓ 登录成功");
  $("empty").hidden = false;
  text("status", "登录成功");
  text(
    "message",
    data.message || "已取得本次登录的账号凭据。可继续测试下一个平台。",
  );
  text("countdown", "登录结果可复制，或切换到下一个平台。");
  $("cookie").value = data.cookie || "";
  text(
    "credentials",
    JSON.stringify(
      {
        account: data.account || {},
        credentials: data.credentials || {},
        ...(data.session_config ? { session_config: data.session_config } : {}),
      },
      null,
      2,
    ),
  );
  renderAccount(data.account);
  completed.set(slot(), data);
  showDiagnostics(data);
  renderResults();
  updatePhoneButtons();
}
function renderResults() {
  $("results").replaceChildren();
  for (const [id, name] of platforms) {
    const done = [...completed.keys()].some(
      (key) => key === id || key.startsWith(id + ":"),
    );
    const badge = document.createElement("span");
    badge.className = "badge" + (done ? " done" : "");
    badge.textContent = name + (done ? " · 已通过" : " · 待测试");
    $("results").append(badge);
  }
}
