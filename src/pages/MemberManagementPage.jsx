import { useState } from "react";
import { useAuth } from "../auth/context";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  StatusBadge,
} from "../components/AsyncState";
import {
  allowedMemberRoles,
  canAdministerOrganization,
  canManageFeishuIdentity,
  canManageMember,
  eligibleReplacements,
} from "../lib/adminAccess";
import { executeCommand } from "../lib/commands";
import { functionErrorMessage, toUserMessage } from "../lib/errors";
import { formatDate } from "../lib/format";
import { supabase } from "../lib/supabase";
import { useSupabaseQuery } from "../lib/useSupabaseQuery";

async function readManagementData() {
  const [members, invitations, connections] = await Promise.all([
    supabase.from("organization_members").select(
      "id,role,status,accepts_assignments,is_away,daily_lead_limit,last_assigned_at,version,profiles(display_name,phone,job_title),organization_member_channel_identities(id,provider,feishu_open_id,feishu_user_id,status,verified_at,version)",
    ).order("created_at"),
    supabase.from("organization_invitations").select(
      "id,email,display_name,job_title,role,status,expires_at,last_error_code,created_at,version",
    ).order("created_at", { ascending: false }).limit(20),
    supabase.from("channel_connections").select("id,provider,name,status")
      .eq("provider", "feishu_internal").eq("status", "active"),
  ]);
  const error = members.error || invitations.error || connections.error;
  return {
    data: error ? null : {
      members: members.data ?? [],
      invitations: invitations.data ?? [],
      connections: connections.data ?? [],
    },
    error,
  };
}

function MemberRow({ member, members, actorRole, auth, onChanged, onFeedback, feishuConnection }) {
  const [busy, setBusy] = useState(false);
  const [openId, setOpenId] = useState("");
  const manageable = canManageMember(actorRole, member.role);
  const canMapFeishu = canManageFeishuIdentity(
    actorRole,
    auth.membership.id,
    member.role,
    member.id,
  );
  const roles = allowedMemberRoles(actorRole);
  const replacements = eligibleReplacements(members, member.id);
  const identity = member.organization_member_channel_identities?.find(
    (item) => item.provider === "feishu_internal",
  );

  async function run(action) {
    setBusy(true);
    onFeedback(null);
    try {
      await action();
      await onChanged();
    } catch (error) {
      onFeedback({
        type: "error",
        message: toUserMessage(error, "成员设置没有保存成功，请稍后再试。"),
      });
    } finally {
      setBusy(false);
    }
  }

  function updateMember(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    return run(async () => {
      await executeCommand({
        commandName: "update_organization_member",
        organizationId: auth.organization.id,
        actorUserId: auth.user.id,
        targetType: "organization_member",
        targetId: member.id,
        expectedVersion: member.version,
        payload: {
          role: form.get("role"),
          accepts_assignments: form.get("accepts") === "on",
          is_away: form.get("away") === "on",
          daily_lead_limit: form.get("limit") || null,
        },
      });
      onFeedback({ type: "success", message: "成员设置已保存。" });
    });
  }

  function deactivate() {
    const replacement = document.getElementById(`replacement-${member.id}`)?.value || null;
    return run(async () => {
      await executeCommand({
        commandName: "deactivate_organization_member",
        organizationId: auth.organization.id,
        actorUserId: auth.user.id,
        targetType: "organization_member",
        targetId: member.id,
        expectedVersion: member.version,
        payload: { replacement_member_id: replacement },
      });
      onFeedback({ type: "success", message: "成员已停用；未结工作量已在同一事务中迁移。" });
    });
  }

  function reactivate() {
    return run(async () => {
      await executeCommand({
        commandName: "reactivate_organization_member",
        organizationId: auth.organization.id,
        actorUserId: auth.user.id,
        targetType: "organization_member",
        targetId: member.id,
        expectedVersion: member.version,
        payload: { role: member.role, accepts_assignments: true },
      });
      onFeedback({ type: "success", message: "成员已重新启用。" });
    });
  }

  async function verifyFeishu(event) {
    event.preventDefault();
    setBusy(true);
    onFeedback(null);
    const commandId = crypto.randomUUID();
    const occurredAt = new Date().toISOString();
    const { data, error } = await supabase.functions.invoke("channel-validate", {
      body: {
        resource_type: "member_identity",
        operation: "verify",
        organization_id: auth.organization.id,
        connection_id: feishuConnection?.id ?? null,
        member_id: member.id,
        feishu_open_id: openId,
        idempotency_key: crypto.randomUUID(),
        command_id: commandId,
        occurred_at: occurredAt,
      },
    });
    if (error || !data?.ok) {
      onFeedback({ type: "error", message: await functionErrorMessage(error, "飞书成员验证失败，请检查连接设置后重试。") });
    } else {
      setOpenId("");
      onFeedback({ type: "success", message: `飞书身份验证成功：${data.validation?.member_name || openId}` });
      await onChanged();
    }
    setBusy(false);
  }

  function removeFeishu() {
    return run(async () => {
      await executeCommand({
        commandName: "remove_member_channel_identity",
        organizationId: auth.organization.id,
        actorUserId: auth.user.id,
        targetType: "member_channel_identity",
        targetId: identity.id,
        expectedVersion: identity.version,
        payload: {},
      });
      onFeedback({ type: "success", message: "飞书成员映射已失效。" });
    });
  }

  return <article className="panel member-card">
    <div className="member-card__header">
      <div>
        <h2>{member.profiles?.display_name || "未命名成员"}</h2>
        <p>{member.profiles?.job_title || "未填写职位"}</p>
      </div>
      <StatusBadge tone={member.status === "active" ? "success" : "neutral"}>{member.role} · {member.status}</StatusBadge>
    </div>
    <form className="member-controls" onSubmit={updateMember}>
      <label>角色<select defaultValue={member.role} disabled={!manageable || member.status !== "active"} name="role">
        {!roles.includes(member.role) && <option value={member.role}>{member.role}</option>}
        {roles.map((role) => <option key={role} value={role}>{role}</option>)}
      </select></label>
      <label>每日线索上限<input defaultValue={member.daily_lead_limit ?? ""} disabled={!manageable || member.status !== "active"} min="0" name="limit" type="number" /></label>
      <label className="check"><input defaultChecked={member.accepts_assignments} disabled={!manageable || member.status !== "active"} name="accepts" type="checkbox" />接收分配</label>
      <label className="check"><input defaultChecked={member.is_away} disabled={!manageable || member.status !== "active"} name="away" type="checkbox" />暂时离岗</label>
      {manageable && member.status === "active" && <button className="button button--secondary" disabled={busy} type="submit">保存</button>}
    </form>
    {manageable && member.status === "active" && <div className="member-deactivate">
      <label>停用时的工作接替人<select id={`replacement-${member.id}`} defaultValue=""><option value="">无未结工作时可留空</option>{replacements.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.profiles?.display_name || candidate.id}</option>)}</select></label>
      <button className="button button--danger" disabled={busy} onClick={deactivate} type="button">停用成员</button>
    </div>}
    {manageable && member.status === "inactive" && <button className="button button--secondary" disabled={busy} onClick={reactivate} type="button">重新启用</button>}
    {canAdministerOrganization(actorRole) && canMapFeishu && <div className="member-feishu">
      <div>
        <strong>飞书身份映射</strong>
        {identity?.status === "verified"
          ? <p><StatusBadge tone="success">verified</StatusBadge> <code>{identity.feishu_open_id}</code> · {formatDate(identity.verified_at)}</p>
          : <p className="muted">必须由已连接的客户飞书应用实时验证 open ID。</p>}
      </div>
      {identity?.status === "verified"
        ? <button className="button button--secondary" disabled={busy} onClick={removeFeishu} type="button">移除映射</button>
        : <form className="inline-form" onSubmit={verifyFeishu}><input aria-label="飞书 open ID" disabled={!feishuConnection || busy} onChange={(event) => setOpenId(event.target.value)} placeholder="ou_xxx" required value={openId} /><button className="button button--secondary" disabled={!feishuConnection || busy} type="submit">验证并绑定</button></form>}
    </div>}
  </article>;
}

export function MemberManagementPage() {
  const auth = useAuth();
  const query = useSupabaseQuery(readManagementData, []);
  const [feedback, setFeedback] = useState(null);
  const [showInvite, setShowInvite] = useState(false);
  const [inviteBusy, setInviteBusy] = useState(false);
  const canAdmin = canAdministerOrganization(auth.membership.role);

  async function invite(event) {
    event.preventDefault();
    setFeedback(null);
    setInviteBusy(true);
    const form = new FormData(event.currentTarget);
    const { data, error } = await supabase.functions.invoke("member-admin", {
      body: {
        operation: "invite",
        organization_id: auth.organization.id,
        email: form.get("email"),
        display_name: form.get("displayName"),
        job_title: form.get("jobTitle") || null,
        role: form.get("role"),
        accepts_assignments: form.get("accepts") === "on",
        idempotency_key: crypto.randomUUID(),
      },
    });
    if (error || !data?.ok) {
      setFeedback({ type: "error", message: await functionErrorMessage(error, "成员邀请没有发送成功，请稍后再试。") });
      setInviteBusy(false);
      return;
    }
    event.currentTarget.reset();
    setShowInvite(false);
    setFeedback({
      type: "success",
      message: data.delivery === "existing_user"
        ? "已有 Auth 用户已安全加入组织。"
        : data.delivery === "email_sent"
          ? "邀请邮件已发送，成员关系已建立。"
          : "该邀请此前已经成功处理。",
    });
    await query.refresh();
    setInviteBusy(false);
  }

  const data = query.data;
  const feishu = data?.connections?.[0] ?? null;
  return <section>
    <PageHeader eyebrow="企业设置" title="成员、角色与飞书身份" description="邀请和成员状态变更由服务端事务执行。停用有未结工作量的成员时，必须选择可接单的 Sales 作为接替人。" actions={canAdmin && <button className="button button--primary" onClick={() => setShowInvite((value) => !value)} type="button">{showInvite ? "取消邀请" : "邀请成员"}</button>} />
    {feedback && <div className={`feedback feedback--${feedback.type}`}>{feedback.message}</div>}
    {!canAdmin && <div className="notice"><strong>只读模式</strong><p>只有 Owner/Admin 可以邀请、调整或停用成员。</p></div>}
    {showInvite && <form className="panel settings-form member-invite" onSubmit={invite}>
      <h2>邀请新成员</h2>
      <div className="form-grid"><label>姓名<input name="displayName" required /></label><label>企业邮箱<input name="email" required type="email" /></label><label>职位<input name="jobTitle" /></label></div>
      <label>角色<select name="role">{allowedMemberRoles(auth.membership.role).map((role) => <option key={role} value={role}>{role}</option>)}</select></label>
      <label className="check"><input defaultChecked name="accepts" type="checkbox" />接收自动分配</label>
      <button className="button button--primary" disabled={inviteBusy} type="submit">{inviteBusy ? "正在邀请…" : "发送邀请"}</button>
    </form>}
    {query.loading && <LoadingState />}
    {query.error && <ErrorState message={query.error} onRetry={query.refresh} />}
    {data?.members.length === 0 && <EmptyState message="暂无成员。" />}
    {data?.members.length > 0 && <div className="member-grid">{data.members.map((member) => <MemberRow actorRole={auth.membership.role} auth={auth} feishuConnection={feishu} key={member.id} member={member} members={data.members} onChanged={query.refresh} onFeedback={setFeedback} />)}</div>}
    {canAdmin && <section className="subsection"><h2>最近邀请</h2>{data?.invitations.length
      ? <div className="table-card"><table><thead><tr><th>成员</th><th>角色</th><th>状态</th><th>错误</th><th>创建时间</th></tr></thead><tbody>{data.invitations.map((invitation) => <tr key={invitation.id}><td>{invitation.display_name}<br /><span className="muted">{invitation.email}</span></td><td>{invitation.role}</td><td><StatusBadge tone={invitation.status === "provisioned" ? "success" : "neutral"}>{invitation.status}</StatusBadge></td><td>{invitation.last_error_code || "—"}</td><td>{formatDate(invitation.created_at)}</td></tr>)}</tbody></table></div>
      : <EmptyState message="暂无邀请记录。" />}</section>}
  </section>;
}
