import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/context";
import { toUserMessage } from "../lib/errors";
import { supabase } from "../lib/supabase";

export function SetPasswordPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (auth.loading) return <div className="full-state">正在验证邀请链接…</div>;
  if (!auth.session) return <Navigate replace to="/login" />;
  if (!auth.requiresPasswordSetup) return <Navigate replace to="/dashboard" />;

  async function submit(event) {
    event.preventDefault();
    setMessage("");
    if (password.length < 8) {
      setMessage("密码至少需要 8 位。");
      return;
    }
    if (password !== confirmation) {
      setMessage("两次输入的密码不一致。");
      return;
    }

    setSubmitting(true);
    const { error } = await supabase.auth.updateUser({
      password,
      data: {
        ...(auth.user?.user_metadata ?? {}),
        requires_password_setup: false,
      },
    });
    if (error) {
      setMessage(toUserMessage(error, "密码没有保存成功，请稍后重试。"));
      setSubmitting(false);
      return;
    }
    auth.completePasswordSetup();
    navigate("/dashboard", { replace: true });
  }

  return <section className="login-card">
    <span className="eyebrow">完成账户设置</span>
    <h1>设置登录密码</h1>
    <p>邀请已验证。请设置至少 8 位的 CRM 登录密码。</p>
    <form onSubmit={submit}>
      <label>新密码<input autoComplete="new-password" minLength="8" onChange={(event) => setPassword(event.target.value)} required type="password" value={password} /></label>
      <label>确认密码<input autoComplete="new-password" minLength="8" onChange={(event) => setConfirmation(event.target.value)} required type="password" value={confirmation} /></label>
      {message && <div className="inline-error" role="alert">{message}</div>}
      <button className="button button--primary" disabled={submitting} type="submit">{submitting ? "正在保存…" : "保存密码并进入 CRM"}</button>
    </form>
  </section>;
}
