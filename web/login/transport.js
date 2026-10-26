"use strict";
async function api(path, body) {
  const r = await fetch(path, {
    cache: "no-store",
    credentials: "omit",
    ...(body === undefined
      ? {}
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
  });
  let data;
  try {
    data = await r.json();
  } catch {
    const error = new Error("登录服务未返回有效结果，请稍后重试。");
    error.status = r.status;
    throw error;
  }
  if (!r.ok) {
    const error = new Error(
      data.msg ||
        data.message ||
        {
          400: "请检查填写的登录信息。",
          403: "登录请求被拒绝。",
          404: "登录会话不存在，请重新开始。",
          409: "登录会话需要更新，请重新开始。",
          429: "请求过于频繁，请稍后再试。",
        }[r.status] ||
        "登录服务暂时不可用。",
    );
    error.status = r.status;
    error.diagnostics = data.diagnostics;
    error.code = data.code;
    error.retry_after = data.retry_after;
    error.data = data;
    throw error;
  }
  return data;
}
