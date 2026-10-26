"use strict";
for (const [index, platform] of platforms.entries()) {
  const b = document.createElement("button");
  b.textContent = platform[1];
  b.id = "tab-" + platform[0];
  b.onclick = () => select(index);
  $("platforms").append(b);
}
function select(index) {
  clearSecrets();
  selected = index;
  epoch++;
  clearTimeout(timer);
  phoneBusy = false;
  for (const [i, p] of platforms.entries()) {
    const b = $("tab-" + p[0]);
    b.classList.toggle("selected", i === selected);
    b.setAttribute("aria-pressed", String(i === selected));
  }
  $("qqMethods").hidden = selected !== 1;
  $("phoneForm").hidden = selected !== 0;
  $("qrPanel").hidden = selected === 0;
  text("refresh", selected === 0 ? "重新开始" : "重新生成");
  text(
    "step",
    "第 " +
      (selected + 1) +
      " / 4 个 · " +
      (selected === 0 ? "网易云登录" : platforms[selected][1]),
  );
  $("next").disabled = selected === platforms.length - 1;
  if (completed.has(slot())) {
    expiry = 0;
    $("refresh").disabled = false;
    showResult(completed.get(slot()));
    return;
  }
  create();
}
$("refresh").onclick = create;
$("next").onclick = () => {
  if (selected < platforms.length - 1) select(selected + 1);
};
$("qqMethod").onchange = () => select(selected);
$("countrycode").oninput = updatePhoneValidation;
$("phoneForm").onsubmit = submitPhone;
$("sendSms").onclick = sendSms;
$("phoneMethod").onchange = () => {
  clearSecrets();
  const isSms = $("phoneMethod").value === "sms";
  $("smsRow").hidden = !isSms;
  $("passwordRow").hidden = isSms;
  $("captcha").required = isSms;
  $("password").required = !isSms;
  updatePhoneButtons();
};
$("showLogin").onclick = async () => {
  if (!openWindowUrl) return;
  const button = $("showLogin"),
    version = epoch;
  button.disabled = true;
  try {
    const data = await api(openWindowUrl);
    if (version !== epoch) return;
    text("message", data.message || "请在本次网易云登录窗口中完成扫码或验证。");
  } catch (error) {
    if (version === epoch) text("message", error.message);
  } finally {
    button.disabled = false;
  }
};
async function copy(value, button) {
  try {
    await navigator.clipboard.writeText(value);
    button.textContent = "已复制";
    setTimeout(() => {
      button.textContent =
        button.id === "copy" ? "复制 Cookie" : "复制完整登录结果";
    }, 1500);
  } catch {
    text("message", "浏览器无法自动复制，请选中文本手动复制。");
  }
}
$("copy").onclick = () => copy(result?.cookie || "", $("copy"));
$("copyall").onclick = () =>
  copy(JSON.stringify(result, null, 2), $("copyall"));
setInterval(() => {
  if (selected === 0) updatePhoneButtons();
  if (expiry && !result) {
    const seconds = Math.max(0, Math.ceil((expiry - Date.now()) / 1000));
    text(
      "countdown",
      selected === 0
        ? seconds
          ? "本次登录会话约 " + seconds + " 秒后过期"
          : "本次登录会话已到有效期，提交时将创建新会话。"
        : seconds
          ? "二维码约 " + seconds + " 秒后过期"
          : "二维码已到有效期，请重新生成。",
    );
  }
}, 1000);
window.addEventListener("pagehide", () => {
  epoch++;
  clearTimeout(timer);
  clearSecrets();
});
renderResults();
select(
  Math.max(
    0,
    platforms.findIndex(
      (p) => p[0] === new URLSearchParams(location.search).get("platform"),
    ),
  ),
);
