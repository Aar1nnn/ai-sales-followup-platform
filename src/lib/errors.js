const defaultCodeMessages = {
  UNAUTHENTICATED: "登录状态已失效，请重新登录后再试。",
  FORBIDDEN: "当前账号没有权限执行这项操作。",
  VALIDATION_ERROR: "填写的信息不完整或格式不正确，请检查后再提交。",
  NOT_FOUND: "找不到相关记录。它可能已被删除，或者你没有查看权限。",
  ORGANIZATION_INACTIVE: "当前企业空间已暂停使用，暂时不能进行这项操作。",
  VERSION_CONFLICT: "这条记录刚刚被其他人更新了，请刷新页面后再试。",
  IDEMPOTENCY_CONFLICT: "这次提交与此前的重复请求不一致，请刷新页面后重新提交。",
  PROVIDER_DISABLED: "这项连接目前没有启用，请联系管理员。",
  PROVIDER_NOT_IMPLEMENTED: "这项功能还没有开放。",
  CONNECTION_INVALID: "系统连接尚未配置好，请联系管理员检查设置。",
  SIGNATURE_INVALID: "连接验证失败，请检查密钥或签名设置。",
  RATE_LIMITED: "操作太频繁，请稍等一会儿再试。",
  TRANSIENT_PROVIDER_ERROR: "暂时无法连接服务，请稍后重试。",
  MANUAL_ACTION_REQUIRED: "请先在真实渠道完成联系，再回到系统记录结果。",
  REPLACEMENT_REQUIRED: "该成员还有未完成的工作，请先选择一位接替人。",
};

const messageRules = [
  [/invalid login credentials/i, "邮箱或密码不正确，请检查后重试。"],
  [/email not confirmed/i, "邮箱还没有完成验证，请先打开邀请或验证邮件。"],
  [/user already registered|already been registered/i, "这个邮箱已经注册过，请直接登录。"],
  [/signups? not allowed|signups? disabled/i, "当前系统暂未开放自行注册，请联系企业管理员发送邀请。"],
  [/email rate limit exceeded|too many.*email/i, "验证邮件发送额度暂时用完了，请稍后再试；如果持续出现，请联系管理员配置企业邮件服务。"],
  [/unable to validate email|invalid email/i, "邮箱格式不正确，请检查后重新填写。"],
  [/password should be at least|password.*too short/i, "密码长度不足，请设置至少 8 位密码。"],
  [/new password should be different/i, "新密码不能与旧密码相同，请换一个密码。"],
  [/auth session missing|jwt.*expired|invalid jwt|token.*expired/i, "登录状态已失效，请重新登录后再试。"],
  [/failed to fetch|networkerror|failed to send a request/i, "暂时无法连接服务器，请检查网络后重试。"],
  [/edge function returned|relay error invoking/i, "服务器没有完成这次操作，请稍后重试或联系管理员。"],
  [/permission denied|row-level security|violates row-level security/i, "当前账号没有权限执行这项操作。"],
  [/relation .* does not exist|column .* does not exist|schema cache/i, "当前服务器还没有完成系统升级，请联系管理员。"],
  [/duplicate key|already exists/i, "这条记录已经存在，请不要重复提交。"],
];

function rawMessage(error) {
  if (typeof error === "string") return error;
  return typeof error?.message === "string" ? error.message : "";
}

function hasChinese(value) {
  return /[\u3400-\u9fff]/u.test(value);
}

export function toUserMessage(error, fallback = "操作没有完成，请稍后再试。", codeMessages = {}) {
  const code = typeof error?.code === "string" ? error.code : "";
  const message = rawMessage(error).trim();
  const overrides = { ...defaultCodeMessages, ...codeMessages };

  if (code && codeMessages[code]) return codeMessages[code];
  if (message && hasChinese(message)) return message;
  if (code && overrides[code]) return overrides[code];

  const matchedRule = messageRules.find(([pattern]) => pattern.test(message));
  if (matchedRule) return matchedRule[1];
  return fallback;
}

async function readJson(source) {
  if (!source || typeof source.json !== "function") return null;
  try {
    return await source.json();
  } catch {
    return null;
  }
}

async function readFunctionBody(context) {
  const directJson = await readJson(context);
  if (directJson !== null) return directJson;

  const responseJson = await readJson(context?.response);
  if (responseJson !== null) return responseJson;

  if (context?.body && typeof context.body === "object") return context.body;
  if (context && typeof context === "object") return context;
  return null;
}

export async function functionFailureDetails(error, options = {}) {
  const body = await readFunctionBody(error?.context);
  const details = body?.error && typeof body.error === "object" ? body.error : body;
  const code = details?.code || error?.code || options.defaultCode || "TRANSIENT_PROVIDER_ERROR";
  const technicalMessage = typeof details?.message === "string"
    ? details.message
    : rawMessage(error);

  return {
    code,
    message: toUserMessage(
      { code, message: technicalMessage },
      options.fallback,
      options.codeMessages,
    ),
    retryable: Boolean(details?.retryable),
    technicalMessage,
  };
}

export async function functionErrorMessage(error, fallback, codeMessages = {}) {
  const details = await functionFailureDetails(error, { fallback, codeMessages });
  return details.message;
}
