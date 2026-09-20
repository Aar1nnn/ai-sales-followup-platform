import { useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../auth/context";
import { EmptyState, ErrorState, LoadingState, PageHeader, StatusBadge } from "../components/AsyncState";
import { AppIcon, SectionHeading } from "../components/WorkspaceUI";
import { executeCommand } from "../lib/commands";
import { toUserMessage } from "../lib/errors";
import { formatDate, toLocalDateTimeInputValue } from "../lib/format";
import { followUpRequiredOutcomes } from "../lib/manualFlow";
import { supabase } from "../lib/supabase";
import { useSupabaseQuery } from "../lib/useSupabaseQuery";
import {
  activityLabel,
  aiModelLabel,
  aiProviderLabel,
  dueLabel,
  formatBudget,
  priorityLabel,
  sourceLabel,
  statusLabel,
  statusTone,
  urgencyLabel,
} from "../lib/workspace";

const outcomes = [
  ["no_reply", "暂未回复"], ["replied", "已经回复"], ["interested", "明确有兴趣"],
  ["not_interested", "暂时没有兴趣"], ["invalid", "无效线索"],
];

function dimensionLabel(key) {
  return ({ need_clarity: "需求清晰度", budget_fit: "预算匹配", decision_authority: "决策权", urgency: "紧迫度", customer_fit: "客户匹配", engagement: "互动意愿" })[key] || "其他评估项";
}

function memberName(member) {
  return member?.profiles?.display_name || "未命名成员";
}

export function LeadDetailPage() {
  const { leadId } = useParams();
  const location = useLocation();
  const auth = useAuth();
  const navigate = useNavigate();
  const [feedback, setFeedback] = useState(null);
  const [working, setWorking] = useState(false);
  const [draftContent, setDraftContent] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [showOutcome, setShowOutcome] = useState(false);
  const [showAssignment, setShowAssignment] = useState(false);
  const [showConversion, setShowConversion] = useState(false);
  const [showInvalid, setShowInvalid] = useState(false);
  const query = useSupabaseQuery(async () => {
    const [lead, scores, activities, tasks, drafts, opportunities, members] = await Promise.all([
      supabase.from("leads").select("id,public_id,status,need,budget_amount,budget_currency,urgency,notes,source,owner_member_id,acknowledged_at,accepted_at,last_contacted_at,invalid_reason,created_at,updated_at,version,contacts(id,full_name,phone,email,wechat),accounts(name)").eq("id", leadId).maybeSingle(),
      supabase.from("lead_scores").select("id,status,normalized_score,raw_known_score,known_weight,coverage,confidence,priority_level,dimension_scores,score_reasons,missing_information,recommended_next_action,ai_provider,ai_model,scored_at").eq("lead_id", leadId).order("scored_at", { ascending: false }).limit(1),
      supabase.from("activities").select("id,activity_type,title,notes,occurred_at,metadata").eq("lead_id", leadId).order("occurred_at", { ascending: false }).limit(100),
      supabase.from("follow_up_tasks").select("id,title,status,due_at,version").eq("lead_id", leadId).order("due_at"),
      supabase.from("message_drafts").select("id,status,content,updated_at,version").eq("lead_id", leadId).order("updated_at", { ascending: false }),
      supabase.from("opportunities").select("id,title,status,version").eq("lead_id", leadId),
      supabase.from("organization_members").select("id,role,status,accepts_assignments,is_away,profiles(display_name)").eq("status", "active").order("created_at"),
    ]);
    const failed = [lead, scores, activities, tasks, drafts, opportunities, members].find((result) => result.error);
    return failed?.error ? { data: null, error: failed.error } : { data: { lead: lead.data, score: scores.data?.[0] ?? null, activities: activities.data ?? [], tasks: tasks.data ?? [], drafts: drafts.data ?? [], opportunities: opportunities.data ?? [], members: members.data ?? [] }, error: null };
  }, [leadId]);

  async function command(commandName, payload = {}, targetType = "lead", targetId = leadId, expectedVersion = query.data?.lead?.version, successMessage = "操作已记录。") {
    setWorking(true); setFeedback(null);
    try {
      const result = await executeCommand({ commandName, organizationId: auth.organization.id, actorUserId: auth.user.id, targetType, targetId, expectedVersion, payload });
      setFeedback({ type: "success", message: successMessage });
      await query.refresh();
      return result;
    } catch (error) {
      setFeedback({ type: "error", message: toUserMessage(error, "线索操作没有完成，请稍后再试。") });
      return null;
    } finally { setWorking(false); }
  }

  if (query.loading) return <LoadingState label="正在整理客户上下文…" />;
  if (query.error) return <ErrorState message={query.error} onRetry={query.refresh} />;
  if (!query.data?.lead) return <EmptyState message="线索不存在或无权访问。" />;
  const { lead, score, activities, tasks, drafts, opportunities, members } = query.data;
  const activeTasks = tasks.filter((task) => ["open", "snoozed"].includes(task.status));
  const owner = members.find((member) => member.id === lead.owner_member_id);
  const salesMembers = members.filter((member) => member.role === "sales" && member.accepts_assignments && !member.is_away);
  const canManageSales = ["owner", "admin", "manager"].includes(auth.membership.role);
  const isClosed = ["converted", "disqualified", "archived"].includes(lead.status);
  const nextTask = [...activeTasks].sort((left, right) => new Date(left.due_at) - new Date(right.due_at))[0];

  async function startWorking() {
    await command("accept_lead", {}, "lead", lead.id, lead.version, "线索已接受，现在可以开始联系客户。");
  }

  async function markContacted() {
    const result = await command("mark_contacted", { contacted_at: new Date().toISOString() }, "lead", lead.id, lead.version, "已记录本次联系时间，请继续填写结果。");
    if (result) setShowOutcome(true);
  }

  async function recordOutcome(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const outcome = form.get("outcome");
    const nextFollowUp = form.get("next_follow_up_at");
    if (followUpRequiredOutcomes.has(outcome) && !nextFollowUp) {
      setFeedback({ type: "error", message: "这个结果必须安排下一次跟进时间。" }); return;
    }
    const result = await command("record_outcome", { outcome, notes: form.get("notes"), next_follow_up_at: nextFollowUp ? new Date(nextFollowUp).toISOString() : null }, "lead", lead.id, lead.version, "联系结果和后续安排已记录。");
    if (result) setShowOutcome(false);
  }

  async function assignLead(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const memberId = form.get("member_id") || null;
    const commandName = lead.owner_member_id ? "reassign_lead" : "assign_lead";
    const result = await command(commandName, { member_id: memberId, reason: form.get("reason") }, "lead", lead.id, lead.version, memberId ? "负责人已更新并记录分配历史。" : "系统已按当前规则选择负责人。");
    if (result) setShowAssignment(false);
  }

  async function convertLead(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const result = await command("convert_lead", { title: form.get("title"), amount: form.get("amount") || null, currency: "CNY", expected_close_date: form.get("expected_close_date") || null }, "lead", lead.id, lead.version, "已人工确认并创建商机，原线索完整保留。");
    const opportunityId = result?.result?.opportunity_id;
    if (opportunityId) navigate(`/opportunities/${opportunityId}`);
  }

  async function invalidateLead(event) {
    event.preventDefault();
    const reason = new FormData(event.currentTarget).get("reason");
    const result = await command("mark_lead_invalid", { reason }, "lead", lead.id, lead.version, "线索已标记为无效，未完成任务已关闭。");
    if (result) setShowInvalid(false);
  }

  return <section className="workspace-page lead-workspace">
    <PageHeader eyebrow={`线索编号：${lead.public_id}`} title={lead.contacts?.full_name || "线索工作台"} description={`${lead.accounts?.name || "个人客户"} · ${sourceLabel(lead.source)} · 录入时间 ${formatDate(lead.created_at)}`} actions={<StatusBadge tone={statusTone(lead.status)}>{statusLabel(lead.status)}</StatusBadge>} />
    {location.state?.createdManually && <div className="feedback" role="status">线索已经创建。请继续确认负责人、记录联系结果并安排下一步。</div>}
    {feedback && <div className={`feedback feedback--${feedback.type}`} role="status">{feedback.message}</div>}

    <div className="lead-context-bar">
      <ContextValue label="负责人" value={owner ? memberName(owner) : "尚未分配"} warning={!owner} />
      <ContextValue label="下一次行动" value={nextTask ? dueLabel(nextTask.due_at) : "尚未安排"} warning={!nextTask && !isClosed} />
      <ContextValue label="最近联系" value={lead.last_contacted_at ? formatDate(lead.last_contacted_at) : "尚未联系"} warning={!lead.last_contacted_at && !isClosed} />
      <ContextValue label="智能评分" value={score?.normalized_score != null ? `${Math.round(score.normalized_score)} 分` : "等待评分"} />
    </div>

    <div className="lead-workspace-grid">
      <main className="lead-workspace__main">
        <article className="panel customer-brief"><SectionHeading eyebrow="客户上下文" title={lead.need || "需求尚待确认"} />
          <div className="contact-actions">{lead.contacts?.phone && <a className="button button--secondary" href={`tel:${lead.contacts.phone}`}>拨打电话</a>}{lead.contacts?.email && <a className="button button--secondary" href={`mailto:${lead.contacts.email}`}>发送邮件</a>}<Link className="button button--ghost" to={`/contacts/${lead.contacts?.id}`}>查看客户档案</Link></div>
          <dl className="brief-grid"><div><dt>电话</dt><dd>{lead.contacts?.phone || "未提供"}</dd></div><div><dt>微信</dt><dd>{lead.contacts?.wechat || "未提供"}</dd></div><div><dt>预算</dt><dd>{formatBudget(lead.budget_amount, lead.budget_currency)}</dd></div><div><dt>紧迫度</dt><dd>{urgencyLabel(lead.urgency)}</dd></div></dl>
          {lead.notes && <div className="customer-notes"><strong>补充说明</strong><p>{lead.notes}</p></div>}
        </article>

        <article className="panel"><SectionHeading description="智能模型只负责整理证据；最终优先级由固定规则和企业画像计算。" eyebrow="决策辅助" title="标准版线索评分" />{!score ? <EmptyState compact message="线索已安全保存，正在等待自动分析。即使智能分析暂时不可用，也可以继续人工跟进。" /> : <ScorePanel score={score} />}</article>

        <article className="panel"><SectionHeading action={<span className="subtle-count">{activities.length} 条记录</span>} description="电话、消息、任务、分配和状态变化按时间保留。" eyebrow="事实记录" title="客户操作时间线" />{activities.length === 0 ? <EmptyState compact message="完成第一次操作后，操作记录会显示在这里。" /> : <ol className="timeline timeline--rich">{activities.map((activity) => <li key={activity.id}><span className="timeline__dot" /><div><div><strong>{activityLabel(activity.activity_type, activity.title)}</strong><time>{formatDate(activity.occurred_at)}</time></div>{activity.notes && <p>{activity.notes}</p>}</div></li>)}</ol>}</article>

        <div className="two-column"><article className="panel"><SectionHeading eyebrow="未来待办" title="跟进计划" />
          <form className="inline-form" onSubmit={async (event) => { event.preventDefault(); const result = await command("schedule_follow_up", { due_at: new Date(dueAt).toISOString(), title: "客户跟进" }, "lead", lead.id, lead.version, "下一次跟进已加入工作队列。"); if (result) setDueAt(""); }}><input aria-label="下一次跟进时间" min={toLocalDateTimeInputValue()} onChange={(event) => setDueAt(event.target.value)} required type="datetime-local" value={dueAt} /><button className="button button--primary" disabled={working} type="submit">安排跟进</button></form>
          <div className="stack-list">{tasks.map((task) => <Link key={task.id} to={`/tasks/${task.id}`}><span><strong>{task.title}</strong><small>{dueLabel(task.due_at)}</small></span><StatusBadge tone={statusTone(task.status)}>{statusLabel(task.status)}</StatusBadge></Link>)}</div>{tasks.length === 0 && <EmptyState compact message="尚未安排跟进时间。" />}
        </article>
          <article className="panel"><SectionHeading eyebrow="人工触达" title="客户消息" />
            <form className="stack-form" onSubmit={async (event) => { event.preventDefault(); const result = await command("create_message_draft", { content: draftContent }, "lead", lead.id, lead.version, "草稿已保存，请继续审核。 "); const draftId = result?.result?.message_draft_id; if (draftId) navigate(`/message-drafts/${draftId}/review`); }}><textarea onChange={(event) => setDraftContent(event.target.value)} placeholder="输入要发给客户的内容，或等待系统自动生成后再审核" required rows="5" value={draftContent} /><button className="button button--primary" disabled={working} type="submit">创建并审核草稿</button></form>
            <div className="stack-list">{drafts.map((draft) => <Link key={draft.id} to={`/message-drafts/${draft.id}/review`}><span><strong>{draft.content.slice(0, 42)}</strong><small>{formatDate(draft.updated_at)}</small></span><StatusBadge tone={statusTone(draft.status)}>{statusLabel(draft.status)}</StatusBadge></Link>)}</div>
          </article></div>
      </main>

      <aside className="lead-action-rail">
        <article className="panel next-action-card"><span className="next-action-card__icon"><AppIcon name={isClosed ? "check" : "arrow"} /></span><span className="eyebrow">当前建议动作</span><h2>{isClosed ? "这条线索已结束当前流程" : !lead.owner_member_id ? "先确定谁来负责" : lead.status === "new" ? "接受线索并开始处理" : "完成本次客户联系"}</h2><p>{isClosed ? "历史信息仍然保留，可从关联商机继续推进。" : !lead.owner_member_id ? "负责人确定后，系统才能明确任务和草稿归属。" : lead.status === "new" ? "接受后会记录负责人和开始时间。" : "联系完成后记录结果，系统会要求必要的下次跟进。"}</p>
          {!isClosed && !lead.owner_member_id && canManageSales && <button className="button button--primary button--block" onClick={() => setShowAssignment(true)} type="button">分配负责人</button>}
          {!isClosed && !lead.owner_member_id && auth.membership.role === "sales" && <button className="button button--primary button--block" disabled={working} onClick={startWorking} type="button">接手并开始处理</button>}
          {!isClosed && lead.status === "new" && lead.owner_member_id && <button className="button button--primary button--block" disabled={working} onClick={startWorking} type="button">接受并开始处理</button>}
          {!isClosed && lead.status !== "new" && <button className="button button--primary button--block" disabled={working} onClick={markContacted} type="button">已完成联系，记录结果</button>}
          {opportunities[0] && <Link className="button button--secondary button--block" to={`/opportunities/${opportunities[0].id}`}>继续推进商机</Link>}
        </article>

        {!isClosed && <article className="panel action-menu"><h2>其他操作</h2>
          {canManageSales && <button onClick={() => setShowAssignment((value) => !value)} type="button">{lead.owner_member_id ? "更换负责人" : "按分配规则处理"}<span>→</span></button>}
          {!lead.acknowledged_at && <button disabled={working} onClick={() => command("acknowledge_lead", {}, "lead", lead.id, lead.version, "已确认收到线索。") } type="button">仅确认收到<span>→</span></button>}
          {opportunities.length === 0 && <button onClick={() => setShowConversion((value) => !value)} type="button">人工转为商机<span>→</span></button>}
          <button className="text-danger" onClick={() => setShowInvalid((value) => !value)} type="button">标记无效线索<span>→</span></button>
        </article>}

        {showAssignment && canManageSales && <article className="panel rail-form"><h2>{lead.owner_member_id ? "更换负责人" : "分配负责人"}</h2><form className="stack-form" onSubmit={assignLead}><label>销售成员<select defaultValue="" name="member_id"><option value="">由系统按当前规则选择</option>{salesMembers.map((member) => <option key={member.id} value={member.id}>{memberName(member)}</option>)}</select></label><label>分配说明<input name="reason" placeholder="例如：客户行业由该成员负责" /></label><button className="button button--primary" disabled={working} type="submit">确认分配</button></form></article>}

        {showOutcome && <article className="panel rail-form"><h2>记录本次联系结果</h2><OutcomeForm onSubmit={recordOutcome} working={working} /></article>}

        {showConversion && opportunities.length === 0 && <article className="panel rail-form"><h2>人工确认商机</h2><form className="stack-form" onSubmit={convertLead}><label>商机名称<input defaultValue={`${lead.contacts?.full_name || "客户"} - ${lead.need || "新商机"}`} name="title" required /></label><label>预计金额<input min="0" name="amount" placeholder="可稍后补充" type="number" /></label><label>预计成交日期<input name="expected_close_date" type="date" /></label><button className="button button--primary" disabled={working} type="submit">确认创建商机</button></form><p className="muted">这是人工判断。智能评分不会自动创建商机。</p></article>}

        {showInvalid && <article className="panel rail-form rail-form--danger"><h2>确认标记无效</h2><form className="stack-form" onSubmit={invalidateLead}><label>无效原因<textarea name="reason" placeholder="例如：联系方式无效、重复测试数据" required rows="3" /></label><button className="button button--danger" disabled={working} type="submit">标记无效并关闭任务</button></form></article>}
      </aside>
    </div>
  </section>;
}

function ContextValue({ label, value, warning }) {
  return <div className={warning ? "context-value context-value--warning" : "context-value"}><span>{label}</span><strong>{value}</strong></div>;
}

function ScorePanel({ score }) {
  const dimensions = useMemo(() => Object.entries(score.dimension_scores || {}), [score.dimension_scores]);
  return <><div className="score-summary"><strong>{score.normalized_score ?? "—"}</strong><span>信息覆盖 {Math.round(score.coverage * 100)}% · 判断可信度 {Math.round(score.confidence * 100)}%</span><StatusBadge tone={score.priority_level === "high" ? "success" : "neutral"}>{priorityLabel(score.priority_level)}</StatusBadge></div><div className="dimensions">{dimensions.map(([key, value]) => <div key={key}><span>{dimensionLabel(key)}</span><strong>{value.status === "unknown" ? "未知" : value.score}</strong><small>{value.evidence || "未提供证据"}</small></div>)}</div>{score.missing_information?.length > 0 && <p className="muted">仍需确认：{score.missing_information.join("、")}</p>}{score.recommended_next_action && <div className="ai-recommendation"><AppIcon name="spark" /><p>{score.recommended_next_action}</p></div>}<small className="muted">评分模型：{aiProviderLabel(score.ai_provider)} · {aiModelLabel(score.ai_model)} · 评分时间 {formatDate(score.scored_at)}</small></>;
}

function OutcomeForm({ onSubmit, working }) {
  const [outcome, setOutcome] = useState("");
  const requiresFollowUp = followUpRequiredOutcomes.has(outcome);
  return <form className="stack-form" onSubmit={onSubmit}><label>客户结果<select name="outcome" onChange={(event) => setOutcome(event.target.value)} required value={outcome}><option value="">请选择</option>{outcomes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>{requiresFollowUp && <label>下一次跟进时间<input min={toLocalDateTimeInputValue()} name="next_follow_up_at" required type="datetime-local" /></label>}<label>沟通备注<textarea name="notes" placeholder="记录客户反馈、疑问和下一步" required={outcome === "invalid"} rows="3" /></label><button className="button button--primary" disabled={working} type="submit">保存结果和下一步</button></form>;
}
