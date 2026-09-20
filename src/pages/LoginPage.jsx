import { useState } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth/context";
import { sanitizeReturnTo } from "../lib/returnTo";
import { toUserMessage } from "../lib/errors";
import { supabase } from "../lib/supabase";

const authModes = {
  login: {
    title: "登录 CRM",
    description: "已经有账号，使用邮箱和密码直接进入企业工作台。",
    submit: "登录",
  },
  register: {
    title: "注册 CRM 账号",
    description: "先创建个人登录账号。注册后仍需企业管理员使用同一邮箱把你加入企业。",
    submit: "创建账号",
  },
};

export function LoginPage() {
  const auth = useAuth();
  const [params] = useSearchParams();
  const [mode, setMode] = useState(params.get("mode") === "register" ? "register" : "login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [feedback, setFeedback] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const returnTo = sanitizeReturnTo(params.get("returnTo"));
  const content = authModes[mode];

  if (!auth.loading && auth.session && auth.requiresPasswordSetup) return <Navigate replace to="/set-password" />;
  if (!auth.loading && auth.session && auth.membership) return <Navigate replace to={returnTo} />;

  function switchMode(nextMode) {
    setMode(nextMode);
    setPassword("");
    setConfirmation("");
    setFeedback(null);
  }

  async function submit(event) {
    event.preventDefault();
    setFeedback(null);

    const normalizedEmail = email.trim().toLowerCase();
    if (mode === "register" && password !== confirmation) {
      setFeedback({ type: "error", text: "两次输入的密码不一致，请重新确认。" });
      return;
    }

    setSubmitting(true);
    if (mode === "login") {
      const { error } = await supabase.auth.signInWithPassword({
        email: normalizedEmail,
        password,
      });
      if (error) {
        setFeedback({ type: "error", text: toUserMessage(error, "登录没有完成，请稍后重试。") });
      }
      setSubmitting(false);
      return;
    }

    const { data, error } = await supabase.auth.signUp({
      email: normalizedEmail,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/login?mode=login`,
      },
    });
    if (error) {
      setFeedback({ type: "error", text: toUserMessage(error, "注册没有完成，请稍后重试。") });
      setSubmitting(false);
      return;
    }

    if (data?.session) await supabase.auth.signOut();
    setMode("login");
    setPassword("");
    setConfirmation("");
    setFeedback({
      type: "success",
      text: data?.session
        ? "账号已经创建。请让企业管理员使用这个邮箱把你加入企业，然后在这里登录。"
        : "注册申请已提交。如果这是新邮箱，请先打开验证邮件；验证完成后，让企业管理员使用同一邮箱把你加入企业。已经注册过的邮箱可以直接登录。",
    });
    setSubmitting(false);
  }

  async function refreshMembership() {
    setSubmitting(true);
    setFeedback(null);
    await auth.refreshMembership();
    setFeedback({ type: "success", text: "已经重新检查。如果管理员刚完成邀请，页面会自动进入工作台；否则请确认邀请使用的是同一个邮箱。" });
    setSubmitting(false);
  }

  if (!auth.loading && auth.session && !auth.membership) {
    return <section className="login-card">
      <span className="eyebrow">账号已登录</span>
      <h1>等待加入企业</h1>
      <p>当前邮箱已经有登录账号，但还没有加入这个企业，所以暂时看不到客户和线索。</p>
      <div className="auth-guidance">
        <strong>下一步怎么做</strong>
        <p>让企业 Owner 在“成员与角色”中邀请 <b>{auth.user?.email}</b>。邀请完成后回到这里重新检查。</p>
      </div>
      {(feedback || auth.error) && <div className={feedback?.type === "success" ? "inline-success" : "inline-error"} role={feedback?.type === "success" ? "status" : "alert"}>{feedback?.text || auth.error}</div>}
      <div className="auth-actions">
        <button className="button button--primary" disabled={submitting} onClick={refreshMembership} type="button">{submitting ? "正在检查…" : "我已被邀请，重新检查"}</button>
        <button className="button button--secondary" disabled={submitting} onClick={() => void supabase.auth.signOut()} type="button">退出并更换账号</button>
      </div>
    </section>;
  }

  return <section className="login-card">
    <span className="eyebrow">企业独立部署版</span>
    <div aria-label="账号操作" className="auth-mode-switch" role="group">
      <button aria-pressed={mode === "login"} onClick={() => switchMode("login")} type="button">登录现有账号</button>
      <button aria-pressed={mode === "register"} onClick={() => switchMode("register")} type="button">注册账号</button>
    </div>
    <h1>{content.title}</h1>
    <p>{content.description}</p>
    {mode === "register" && <div className="auth-guidance">
      <strong>已经收到邀请邮件？</strong>
      <p>不用重复注册。请直接打开邀请邮件，接受邀请并设置密码。</p>
    </div>}
    <form onSubmit={submit}>
      <label>邮箱<input autoComplete="email" onChange={(event) => setEmail(event.target.value)} required type="email" value={email} /></label>
      <label>密码<input autoComplete={mode === "login" ? "current-password" : "new-password"} minLength="8" onChange={(event) => setPassword(event.target.value)} required type="password" value={password} /></label>
      {mode === "register" && <label>再次输入密码<input autoComplete="new-password" minLength="8" onChange={(event) => setConfirmation(event.target.value)} required type="password" value={confirmation} /></label>}
      {(feedback || auth.error) && <div className={feedback?.type === "success" ? "inline-success" : "inline-error"} role={feedback?.type === "success" ? "status" : "alert"}>{feedback?.text || auth.error}</div>}
      <button className="button button--primary" disabled={submitting} type="submit">{submitting ? (mode === "login" ? "正在登录…" : "正在注册…") : content.submit}</button>
    </form>
  </section>;
}
