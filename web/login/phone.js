"use strict";
function clearSecrets() {
  $("password").value = "";
  $("captcha").value = "";
}
function updatePhoneButtons() {
  const cooldown = Math.max(0, Math.ceil((smsRetryAt - Date.now()) / 1000)),
    locked = phoneBusy || Boolean(result);
  $("sendSms").disabled = locked || cooldown > 0;
  text("sendSms", cooldown ? cooldown + " 秒后重试" : "发送验证码");
  $("phoneSubmit").disabled = locked;
  $("refresh").disabled = phoneBusy;
  for (const id of ["phone", "countrycode", "phoneMethod"])
    $(id).disabled = locked;
  const isSms = $("phoneMethod").value === "sms";
  $("captcha").disabled = locked || !isSms;
  $("password").disabled = locked || isSms;
}
function updatePhoneValidation() {
  const mainland = $("countrycode").value.trim() === "86";
  $("phone").pattern = mainland ? "[0-9]{11}" : "[0-9]{5,15}";
  $("phone").maxLength = mainland ? 11 : 15;
  $("phone").title = mainland
    ? "请输入 11 位中国大陆手机号"
    : "请输入 5 至 15 位数字手机号";
}
function applyPhoneExpiry(data) {
  if (data.expires_at) expiry = Number(data.expires_at) * 1000;
  else if (data.expires_in)
    expiry = Date.now() + Number(data.expires_in) * 1000;
}
function phoneStatus(data) {
  showDiagnostics(data);
  showVerification(data);
  applyPhoneExpiry(data);
  if (data.authorized) {
    showResult(data);
    return;
  }
  if (
    data.status === "verification_required" ||
    Number(data.code) === 8821 ||
    Number(data.last_error?.code) === 8821
  ) {
    text("status", "需要完成安全验证");
    text(
      "message",
      "仍需网易云官方安全验证，目前未取得 Cookie。请稍后重新开始，或按官方服务给出的验证要求完成操作。",
    );
    return;
  }
  text(
    "status",
    {
      waiting: "等待提交登录",
      sms_sent: "验证码已发送",
      cooldown: "请稍后再试",
      expired: "登录会话已过期",
      cancelled: "登录已取消",
    }[data.status] || "尚未完成登录",
  );
  text(
    "message",
    data.message ||
      data.last_error?.message ||
      "请输入手机号，选择密码或短信验证码登录。",
  );
  if (data.status === "expired" || data.status === "cancelled") {
    key = "";
    expiry = 0;
    text("countdown", "提交登录时会创建新的会话，也可点击“重新开始”。");
  }
}
function phoneError(error) {
  showDiagnostics(error);
  if (
    Number(error.code) === 8821 ||
    error.data?.status === "verification_required"
  ) {
    phoneStatus({ ...error.data, status: "verification_required" });
    return;
  }
  text("status", error.status === 429 ? "请稍后再试" : "登录尚未完成");
  text("message", error.message || "登录服务暂时不可用，请稍后重试。");
  if (error.status === 429 || Number(error.retry_after) > 0)
    smsRetryAt = Math.max(
      smsRetryAt,
      Date.now() +
        Math.max(1, Math.min(3600, Number(error.retry_after) || 60)) * 1000,
    );
  if ([404, 410].includes(error.status) || error.data?.status === "expired") {
    key = "";
    expiry = 0;
  }
}
async function newPhoneSession(version) {
  const data = await api("/login/netease/phone/session", {});
  if (version !== epoch) return false;
  if (!data.key) throw new Error("未能建立登录会话，请点击“重新开始”重试。");
  key = data.key;
  applyPhoneExpiry(data);
  phoneStatus(data);
  return true;
}
async function ensurePhoneSession(version) {
  if (key && expiry > Date.now()) return true;
  key = "";
  return newPhoneSession(version);
}
function validPhone() {
  return $("countrycode").reportValidity() && $("phone").reportValidity();
}
async function sendSms() {
  if (
    selected !== 0 ||
    phoneBusy ||
    result ||
    smsRetryAt > Date.now() ||
    !validPhone()
  )
    return;
  const version = epoch;
  phoneBusy = true;
  updatePhoneButtons();
  text("status", "正在发送验证码");
  text("message", "正在向网易云提交验证码请求，请勿重复点击。");
  try {
    if (!(await ensurePhoneSession(version))) return;
    const data = await api("/login/netease/sms/send", {
      key,
      phone: $("phone").value.trim(),
      countrycode: $("countrycode").value.trim(),
    });
    if (version !== epoch) return;
    phoneStatus(data);
    if (data.sms_sent || Number(data.retry_after) > 0) {
      smsRetryAt =
        Date.now() +
        Math.max(
          data.sms_sent ? 60 : 1,
          Math.min(3600, Number(data.retry_after) || 60),
        ) *
          1000;
      if (data.sms_sent) {
        text("status", "验证码已发送");
        text(
          "message",
          data.message || "请查看手机短信，并手动填写验证码完成登录。",
        );
        $("captcha").focus();
      }
    }
  } catch (error) {
    if (version === epoch) phoneError(error);
  } finally {
    if (version === epoch) {
      phoneBusy = false;
      updatePhoneButtons();
    }
  }
}
async function submitPhone(event) {
  event.preventDefault();
  if (selected !== 0 || phoneBusy || result || !$("phoneForm").reportValidity())
    return;
  const version = epoch;
  phoneBusy = true;
  updatePhoneButtons();
  text("status", "正在登录");
  text("message", "正在提交本次登录，请勿重复点击。");
  try {
    if (!(await ensurePhoneSession(version))) return;
    const body = {
      key,
      phone: $("phone").value.trim(),
      countrycode: $("countrycode").value.trim(),
    };
    if ($("phoneMethod").value === "password")
      body.password = $("password").value;
    else body.captcha = $("captcha").value.trim();
    const request = api("/login/netease/phone", body);
    clearSecrets();
    const data = await request;
    if (version !== epoch) return;
    phoneStatus(data);
  } catch (error) {
    if (version === epoch) phoneError(error);
  } finally {
    if (version === epoch) {
      clearSecrets();
      phoneBusy = false;
      updatePhoneButtons();
    }
  }
}
