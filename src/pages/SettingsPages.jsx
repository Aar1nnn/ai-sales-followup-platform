import { useState } from "react";
import { useAuth } from "../auth/context";
import { EmptyState, ErrorState, LoadingState, PageHeader, StatusBadge } from "../components/AsyncState";
import { executeCommand } from "../lib/commands";
import { functionErrorMessage, toUserMessage } from "../lib/errors";
import { formatDate } from "../lib/format";
import { supabase } from "../lib/supabase";
import { useSupabaseQuery } from "../lib/useSupabaseQuery";

function SettingsPage({ title, description, children }) { return <section><PageHeader eyebrow="企业设置" title={title} description={description} />{children}</section>; }

export function MembersSettingsPage() {
  const query = useSupabaseQuery(() => supabase.from("organization_members").select("id,role,status,accepts_assignments,is_away,daily_lead_limit,last_assigned_at,profiles(display_name,phone,job_title)").order("created_at"), []);
  return <SettingsPage title="成员与角色" description="角色只保存在 organization_members；生产组织只能有一个 active Owner。">{query.loading && <LoadingState />}{query.error && <ErrorState message={query.error} />}{query.data && <div className="table-card"><table><thead><tr><th>成员</th><th>角色</th><th>状态</th><th>接单</th><th>今日上限</th><th>上次分配</th></tr></thead><tbody>{query.data.map((row) => <tr key={row.id}><td>{row.profiles?.display_name || "—"}</td><td><StatusBadge>{row.role}</StatusBadge></td><td>{row.status}</td><td>{row.is_away ? "请假" : row.accepts_assignments ? "是" : "否"}</td><td>{row.daily_lead_limit ?? "组织默认"}</td><td>{formatDate(row.last_assigned_at)}</td></tr>)}</tbody></table></div>}</SettingsPage>;
}

export function AssignmentSettingsPage() {
  const auth = useAuth();
  const query = useSupabaseQuery(() => supabase.from("organization_assignment_settings").select("*").maybeSingle(), []);
  const [feedback, setFeedback] = useState(null);
  async function save(event) {
    event.preventDefault(); const form = new FormData(event.currentTarget); setFeedback(null);
    try {
      await executeCommand({ commandName: "update_assignment_settings", organizationId: auth.organization.id, actorUserId: auth.user.id, targetType: "assignment_settings", targetId: query.data.id, expectedVersion: query.data.version, payload: { strategy: form.get("strategy"), auto_assignment_enabled: form.get("auto") === "on", daily_limit_enabled: form.get("limit") === "on", default_daily_limit: form.get("daily") || null, first_response_sla_minutes: Number(form.get("sla")), lead_deduplication_window_days: Number(form.get("dedupe")), draft_approval_required: form.get("approval") === "on", sales_self_approval_enabled: form.get("selfApproval") === "on" } });
      setFeedback({ type: "success", message: "分配设置已更新并创建新 rule_version。" }); await query.refresh();
    } catch (error) { setFeedback({ type: "error", message: toUserMessage(error, "分配设置没有保存成功，请稍后再试。") }); }
  }
  return <SettingsPage title="分配与 SLA" description="并发分配由数据库事务锁保护；无人可分配时进入人工池。">{query.loading && <LoadingState />}{query.error && <ErrorState message={query.error} />}{feedback && <div className={`feedback feedback--${feedback.type}`}>{feedback.message}</div>}{query.data && <form className="panel settings-form" key={query.data.version} onSubmit={save}><label>策略<select defaultValue={query.data.strategy} name="strategy"><option value="round_robin">轮询分配</option><option value="least_open_tasks">最少未完成任务</option><option value="manager_manual">经理手工分配</option></select></label><label className="check"><input defaultChecked={query.data.auto_assignment_enabled} name="auto" type="checkbox" />自动分配</label><label className="check"><input defaultChecked={query.data.daily_limit_enabled} name="limit" type="checkbox" />启用每日上限</label><label>默认每日上限<input defaultValue={query.data.default_daily_limit ?? ""} min="0" name="daily" type="number" /></label><label>首次响应 SLA（分钟）<input defaultValue={query.data.first_response_sla_minutes} min="5" name="sla" required type="number" /></label><label>Lead 去重窗口（天）<input defaultValue={query.data.lead_deduplication_window_days} min="1" name="dedupe" required type="number" /></label><label className="check"><input defaultChecked={query.data.draft_approval_required} name="approval" type="checkbox" />客户草稿必须审批</label><label className="check"><input defaultChecked={query.data.sales_self_approval_enabled} name="selfApproval" type="checkbox" />Sales 可自审自己负责的草稿</label><button className="button button--primary" disabled={!['owner','admin'].includes(auth.membership.role)} type="submit">保存设置</button></form>}</SettingsPage>;
}

function splitList(value) { return String(value || "").split(/[，,]/).map((item) => item.trim()).filter(Boolean); }

export function ScoringSettingsPage() {
  const auth = useAuth(); const query = useSupabaseQuery(() => supabase.from("organization_scoring_profiles").select("*").eq("status", "active").maybeSingle(), []); const [feedback, setFeedback] = useState(null);
  async function save(event) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    try { await executeCommand({ commandName: "create_scoring_profile_version", organizationId: auth.organization.id, actorUserId: auth.user.id, targetType: "organization", targetId: auth.organization.id, expectedVersion: null, payload: { name: form.get("name"), currency: "CNY", pricing_model: form.get("pricing"), minimum_viable_budget: form.get("minimum") || null, target_budget_min: form.get("min") || null, target_budget_max: form.get("max") || null, target_industries: splitList(form.get("industries")), target_company_sizes: splitList(form.get("sizes")), target_regions: splitList(form.get("regions")), target_use_cases: splitList(form.get("uses")), target_buyer_roles: splitList(form.get("roles")), positive_signals: splitList(form.get("positive")), disqualifying_signals: splitList(form.get("negative")) } }); setFeedback({ type: "success", message: "已创建新的评分上下文版本，旧分数历史未被覆盖。" }); await query.refresh(); }
    catch (error) { setFeedback({ type: "error", message: toUserMessage(error, "评分设置没有保存成功，请稍后再试。") }); }
  }
  return <SettingsPage title="Standard v1 评分上下文" description="六维权重固定；这里配置企业预算与 ICP，保存时创建新版本。">{query.loading && <LoadingState />}{query.error && <ErrorState message={query.error} />}{feedback && <div className={`feedback feedback--${feedback.type}`}>{feedback.message}</div>}{query.data && <form className="panel settings-form" key={query.data.id} onSubmit={save}><label>版本名称<input defaultValue={query.data.name} name="name" required /></label><label>定价方式<input defaultValue={query.data.pricing_model || ""} name="pricing" /></label><div className="form-grid"><label>最低可服务预算<input defaultValue={query.data.minimum_viable_budget || ""} min="0" name="minimum" type="number" /></label><label>目标预算下限<input defaultValue={query.data.target_budget_min || ""} min="0" name="min" type="number" /></label><label>目标预算上限<input defaultValue={query.data.target_budget_max || ""} min="0" name="max" type="number" /></label></div><label>目标行业（逗号分隔）<input defaultValue={query.data.target_industries.join("，")} name="industries" /></label><label>企业规模<input defaultValue={query.data.target_company_sizes.join("，")} name="sizes" /></label><label>地区<input defaultValue={query.data.target_regions.join("，")} name="regions" /></label><label>目标用例<input defaultValue={query.data.target_use_cases.join("，")} name="uses" /></label><label>买方角色<input defaultValue={query.data.target_buyer_roles.join("，")} name="roles" /></label><label>正向信号<input defaultValue={query.data.positive_signals.join("，")} name="positive" /></label><label>排除信号<input defaultValue={query.data.disqualifying_signals.join("，")} name="negative" /></label><button className="button button--primary" disabled={!['owner','admin'].includes(auth.membership.role)} type="submit">创建新版本</button></form>}</SettingsPage>;
}

export function ChannelsSettingsPage() {
  const auth = useAuth(); const query = useSupabaseQuery(() => supabase.from("channel_connections").select("id,public_id,provider,name,status,validated_at,version").order("created_at"), []); const [feedback, setFeedback] = useState(null); const [showForm, setShowForm] = useState(false);
  async function configure(event) {
    event.preventDefault(); const form = new FormData(event.currentTarget); setFeedback(null);
    const credentials = { app_id: form.get("appId"), app_secret: form.get("appSecret"), verification_token: form.get("verificationToken"), encrypt_key: form.get("encryptKey") };
    const existingFeishu = query.data?.find((connection) => connection.provider === "feishu_internal");
    const { data, error } = await supabase.functions.invoke("channel-validate", { body: { operation: "configure", organization_id: auth.organization.id, connection_id: existingFeishu?.id ?? null, provider: "feishu_internal", name: form.get("name"), credentials, public_config: {} } });
    if (error || !data?.ok) {
      const message = error
        ? await functionErrorMessage(error, "飞书连接失败，请检查填写的信息后重试。")
        : toUserMessage(data?.error, "飞书连接失败，请检查填写的信息后重试。");
      setFeedback({ type: "error", message });
      return;
    }
    event.currentTarget.reset(); setShowForm(false); setFeedback({ type: "success", message: "飞书连接已验证，Secret 已写入 Vault；页面不会回显。" }); await query.refresh();
  }
  return <SettingsPage title="渠道连接" description="v1 只启用飞书内部通知与人工客户触达；Secret 只进入 Supabase Vault。">{feedback && <div className={`feedback feedback--${feedback.type}`}>{feedback.message}</div>}{query.loading && <LoadingState />}{query.error && <ErrorState message={query.error} />}{query.data && <div className="card-grid">{query.data.map((row) => <article className="panel" key={row.id}><h2>{row.name}</h2><p>{row.provider}</p><StatusBadge>{row.status}</StatusBadge><small>{row.validated_at ? `验证于 ${formatDate(row.validated_at)}` : "尚未验证"}</small></article>)}{["wecom_internal", "wecom_customer_contact", "wechat_customer_service", "email", "whatsapp_business"].map((provider) => <article className="panel panel--disabled" key={provider}><h2>{provider}</h2><StatusBadge>disabled</StatusBadge><p>不属于中国标准模板 v1 验收范围。</p></article>)}</div>}<button className="button button--primary" disabled={!['owner','admin'].includes(auth.membership.role)} onClick={() => setShowForm((value) => !value)} type="button">{showForm ? "取消" : "配置客户自有飞书应用"}</button>{showForm && <form className="panel settings-form secret-form" onSubmit={configure}><div className="notice"><strong>Secret 不会回显</strong><p>提交后先调用飞书验证；成功才加密保存到 Vault。轮换时重新提交完整凭证。</p></div><label>连接名称<input defaultValue="飞书内部通知" name="name" required /></label><label>App ID<input autoComplete="off" name="appId" required /></label><label>App Secret<input autoComplete="new-password" name="appSecret" required type="password" /></label><label>Verification Token<input autoComplete="new-password" name="verificationToken" required type="password" /></label><label>Encrypt Key<input autoComplete="new-password" name="encryptKey" required type="password" /></label><button className="button button--primary" type="submit">验证并安全保存</button></form>}</SettingsPage>;
}

export function IntegrationsSettingsPage() {
  const auth = useAuth();
  const query = useSupabaseQuery(() => supabase.from("lead_source_connections").select("id,public_id,provider,name,status,external_source_id,mapping,settings,rate_limit_per_minute,max_payload_bytes,validated_at,updated_at,version").order("updated_at", { ascending: false }), []);
  const [editing, setEditing] = useState(null);
  const [provider, setProvider] = useState("generic_webhook");
  const [mappingText, setMappingText] = useState('{"paths":{"contact.name":"contact.name","contact.phone":"contact.phone","contact.email":"contact.email","lead.need":"lead.need","lead.budget":"lead.budget"}}');
  const [feedback, setFeedback] = useState(null);

  function beginEdit(connection = null) {
    const nextProvider = connection?.provider || "generic_webhook";
    setEditing(connection || { id: null });
    setProvider(nextProvider);
    setMappingText(JSON.stringify(connection?.mapping || (nextProvider === "tally"
      ? { "contact.name": "姓名", "contact.phone": "电话", "contact.email": "邮箱", "lead.need": "需求", "lead.budget": "预算" }
      : { paths: { "contact.name": "contact.name", "contact.phone": "contact.phone", "contact.email": "contact.email", "lead.need": "lead.need", "lead.budget": "lead.budget" } }), null, 2));
    setFeedback(null);
  }

  function changeProvider(nextProvider) {
    setProvider(nextProvider);
    setMappingText(JSON.stringify(nextProvider === "tally"
      ? { "contact.name": "姓名", "contact.phone": "电话", "contact.email": "邮箱", "lead.need": "需求", "lead.budget": "预算" }
      : { paths: { "contact.name": "contact.name", "contact.phone": "contact.phone", "contact.email": "contact.email", "lead.need": "lead.need", "lead.budget": "lead.budget" } }, null, 2));
  }

  async function configure(event) {
    event.preventDefault();
    setFeedback(null);
    const form = new FormData(event.currentTarget);
    let mapping;
    try { mapping = JSON.parse(mappingText); }
    catch { setFeedback({ type: "error", message: "字段映射必须是有效 JSON。" }); return; }
    const credentials = provider === "tally"
      ? { hmac_secret: form.get("hmacSecret") }
      : provider === "internal_manual"
        ? { token: form.get("token") }
        : { token: form.get("token") || undefined, hmac_secret: form.get("hmacSecret") || undefined };
    const verifiedIdentityFields = ["phone", "email"].filter((field) => form.get(`verified_${field}`) === "on");
    const { data, error } = await supabase.functions.invoke("channel-validate", { body: {
      resource_type: "source_connection", operation: "configure", organization_id: auth.organization.id,
      connection_id: editing?.id || null, provider, name: form.get("name"), external_source_id: form.get("externalSourceId") || null,
      credentials, mapping, settings: { verified_identity_fields: verifiedIdentityFields },
      rate_limit_per_minute: Number(form.get("rateLimit")), max_payload_bytes: Number(form.get("maxPayload")),
    } });
    if (error || !data?.ok) {
      const message = error
        ? await functionErrorMessage(error, "线索来源没有保存成功，请检查连接信息后重试。")
        : toUserMessage(data?.error, "线索来源没有保存成功，请检查连接信息后重试。");
      setFeedback({ type: "error", message });
      return;
    }
    setEditing(null);
    setFeedback({ type: "success", message: "来源连接已启用；Secret 已写入 Vault，页面不会回显。" });
    await query.refresh();
  }

  return <SettingsPage title="线索来源" description="正式 Adapter：Tally、Generic Webhook、Internal Manual；字段映射按连接配置，不硬编码表单 UUID。">
    {feedback && <div className={`feedback feedback--${feedback.type}`}>{feedback.message}</div>}
    {query.loading && <LoadingState />}{query.error && <ErrorState message={query.error} />}
    {query.data?.length === 0 && <EmptyState message="尚未创建来源连接。" />}
    {query.data?.length > 0 && <div className="table-card"><table><thead><tr><th>名称</th><th>Provider</th><th>外部来源</th><th>状态</th><th>Webhook 路径</th><th>操作</th></tr></thead><tbody>{query.data.map((row) => <tr key={row.id}><td>{row.name}</td><td>{row.provider}</td><td>{row.external_source_id || "—"}</td><td>{row.status}</td><td><code>/functions/v1/lead-intake/{row.public_id}</code></td><td><button className="button button--secondary" disabled={!['owner','admin'].includes(auth.membership.role)} onClick={() => beginEdit(row)} type="button">编辑 / 轮换 Secret</button></td></tr>)}</tbody></table></div>}
    <button className="button button--primary" disabled={!['owner','admin'].includes(auth.membership.role)} onClick={() => editing ? setEditing(null) : beginEdit()} type="button">{editing ? "取消" : "新增来源连接"}</button>
    {editing && <form className="panel settings-form secret-form" key={editing.id || "new"} onSubmit={configure}>
      <div className="notice"><strong>Secret 不会回显</strong><p>创建或轮换时必须重新提交完整凭证；成功后业务表只保存 Vault 引用。</p></div>
      <label>Provider<select disabled={Boolean(editing.id)} onChange={(event) => changeProvider(event.target.value)} value={provider}><option value="generic_webhook">Generic Webhook</option><option value="tally">Tally</option><option value="internal_manual">Internal Manual</option></select></label>
      <label>连接名称<input defaultValue={editing.name || "官网线索入口"} name="name" required /></label>
      {provider === "tally" && <label>Tally Form ID<input defaultValue={editing.external_source_id || ""} name="externalSourceId" required /></label>}
      {provider !== "tally" && <input name="externalSourceId" type="hidden" value="" />}
      {provider !== "tally" && <label>Connection Token<input autoComplete="new-password" name="token" required={provider === "internal_manual"} type="password" /></label>}
      {provider !== "internal_manual" && <label>HMAC Secret<input autoComplete="new-password" name="hmacSecret" required={provider === "tally"} type="password" /></label>}
      <label>字段映射 JSON<textarea onChange={(event) => setMappingText(event.target.value)} rows="10" value={mappingText} /></label>
      <label className="check"><input defaultChecked={editing.settings?.verified_identity_fields?.includes("phone")} name="verified_phone" type="checkbox" />来源已可靠验证手机号</label>
      <label className="check"><input defaultChecked={editing.settings?.verified_identity_fields?.includes("email")} name="verified_email" type="checkbox" />来源已可靠验证邮箱</label>
      <label>每分钟速率上限<input defaultValue={editing.rate_limit_per_minute || 60} max="10000" min="1" name="rateLimit" required type="number" /></label>
      <label>Payload 上限（bytes）<input defaultValue={editing.max_payload_bytes || 262144} max="1048576" min="1024" name="maxPayload" required type="number" /></label>
      <button className="button button--primary" type="submit">验证配置并安全保存</button>
    </form>}
  </SettingsPage>;
}
