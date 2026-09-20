import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useAuth } from "../auth/context";
import { EmptyState, ErrorState, LoadingState, PageHeader, StatusBadge } from "../components/AsyncState";
import { AppIcon, SectionHeading } from "../components/WorkspaceUI";
import { executeCommand } from "../lib/commands";
import { toUserMessage } from "../lib/errors";
import { formatDate, toLocalDateTimeInputValue } from "../lib/format";
import { followUpRequiredOutcomes, manualDraftStep, validateManualSend } from "../lib/manualFlow";
import { supabase } from "../lib/supabase";
import { useSupabaseQuery } from "../lib/useSupabaseQuery";
import { statusLabel, statusTone } from "../lib/workspace";

const channels = [["personal_wechat", "个人微信"], ["wecom_manual", "企业微信（人工）"], ["phone", "电话"], ["sms_manual", "短信（人工）"], ["email_manual", "邮件（人工）"], ["other", "其他"]];
const outcomes = [["no_reply", "暂未回复"], ["replied", "已经回复"], ["interested", "明确有兴趣"], ["not_interested", "暂时没有兴趣"], ["converted", "已完成转化"], ["invalid", "无效线索"]];
const stepLabels = ["审核内容", "批准草稿", "外部联系", "记录结果", "完成"];

function DraftReviewContent({ auth, draft, tasks, refresh }) {
  const [values, setValues] = useState({ content: draft.content, actual_channel: "", outcome: "", notes: "", next_follow_up_at: "", task_id: tasks[0]?.id || "" });
  const [feedback, setFeedback] = useState(null);
  const [working, setWorking] = useState(false);
  const [rejectionReason, setRejectionReason] = useState("");
  const [showReject, setShowReject] = useState(false);
  const [externalContactConfirmed, setExternalContactConfirmed] = useState(false);
  const step = manualDraftStep(draft.status, externalContactConfirmed);
  const requiresFollowUp = followUpRequiredOutcomes.has(values.outcome);

  async function run(commandName, payload, successMessage) {
    setWorking(true); setFeedback(null);
    try {
      await executeCommand({ commandName, organizationId: auth.organization.id, actorUserId: auth.user.id, targetType: "message_draft", targetId: draft.id, expectedVersion: draft.version, payload });
      setFeedback({ type: "success", message: successMessage || "操作已成功记录。" }); await refresh(); return true;
    } catch (error) { setFeedback({ type: "error", message: toUserMessage(error, "草稿操作没有完成，请稍后再试。") }); return false; }
    finally { setWorking(false); }
  }

  async function copyDraft() {
    try { await navigator.clipboard.writeText(values.content); setFeedback({ type: "success", message: "内容已复制。请在真实客户渠道中完成发送，系统尚未记录为已发送。" }); }
    catch { setFeedback({ type: "error", message: "浏览器未允许复制，请手动选择文本。" }); }
  }

  async function markSent(event) {
    event.preventDefault();
    const errors = validateManualSend(values);
    if (Object.keys(errors).length) { setFeedback({ type: "error", message: Object.values(errors).join(" ") }); return; }
    await run("mark_manual_message_sent", { ...values, sent_at: new Date().toISOString(), next_follow_up_at: values.next_follow_up_at ? new Date(values.next_follow_up_at).toISOString() : null, task_id: values.task_id || null }, "真实发送、客户结果和下一步已经原子记录。");
  }

  return <section className="workspace-page manual-flow"><PageHeader eyebrow="人工客户触达" title={draft.contacts?.full_name || "审核消息草稿"} description={`${draft.leads?.public_id || ""} · 更新于 ${formatDate(draft.updated_at)}`} actions={<StatusBadge tone={statusTone(draft.status)}>{statusLabel(draft.status)}</StatusBadge>} />
    <ManualStepper current={step} />
    {feedback && <div className={`feedback feedback--${feedback.type}`} role="status">{feedback.message}</div>}

    {step <= 2 && <div className="manual-stage-grid"><article className="panel"><SectionHeading description="先确认内容准确、合规，并符合客户当前上下文。" eyebrow={`步骤 ${stepLabels.indexOf("审核内容") + 1}`} title="审核和编辑内容" />
      {draft.status === "rejected" && <div className="notice notice--warning"><strong>草稿已被退回</strong><p>{draft.rejection_reason || "请修改内容后重新提交。"}</p></div>}
      <textarea className="draft-editor" onChange={(event) => setValues((current) => ({ ...current, content: event.target.value }))} rows="15" value={values.content} />
      <div className="action-bar"><button className="button button--primary" disabled={working || values.content.trim() === draft.content.trim()} onClick={() => run("update_message_draft", { content: values.content }, "修改已保存，可以继续确认内容。") } type="button">保存修改</button><button className="button button--secondary" disabled={working} onClick={() => run("regenerate_message_draft", {}, "已提交 AI 重新生成任务；新内容仍需人工审核。") } type="button"><AppIcon name="spark" size={16} />AI 重新生成</button></div>
      <p className="muted">AI 重新生成是异步动作。无论内容来自 AI 还是人工，进入客户渠道前都必须由人确认。</p>
    </article>
      <aside className="panel approval-panel"><SectionHeading description="批准只代表内容可以使用，不代表已经联系客户。" eyebrow="步骤 2" title="批准当前内容" />
        <div className="approval-preview"><span>发送对象</span><strong>{draft.contacts?.full_name || "客户"}</strong><span>字符数</span><strong>{values.content.trim().length}</strong></div>
        <button className="button button--primary button--block" disabled={working || !values.content.trim() || values.content !== draft.content} onClick={() => run("approve_message_draft", {}, "内容已批准。下一步请在真实渠道联系客户。") } type="button">批准并进入外部联系</button>
        <button className="button button--ghost button--block" onClick={() => setShowReject((value) => !value)} type="button">退回修改</button>
        {showReject && <div className="reject-box"><label>退回原因<textarea onChange={(event) => setRejectionReason(event.target.value)} placeholder="说明需要修改的地方" rows="3" value={rejectionReason} /></label><button className="button button--danger button--block" disabled={working || !rejectionReason.trim()} onClick={() => run("reject_message_draft", { reason: rejectionReason }, "草稿已退回并记录原因。") } type="button">确认退回</button></div>}
        {values.content !== draft.content && <p className="inline-hint">请先保存左侧修改，再批准内容。</p>}
      </aside></div>}

    {step === 3 && <article className="panel external-send-card"><span className="external-send-card__icon"><AppIcon name="arrow" /></span><span className="eyebrow">步骤 3 · 外部联系</span><h2>现在去真实渠道联系客户</h2><p>系统不会自动发送，也不会把“复制”当成发送成功。你可以复制内容后打开个人微信、企业微信、短信或邮件，也可以直接打电话。</p><div className="approved-message"><span>已批准内容</span><p>{values.content}</p></div><div className="action-bar action-bar--center"><button className="button button--secondary" onClick={copyDraft} type="button">复制批准内容</button><button className="button button--primary" onClick={() => setExternalContactConfirmed(true)} type="button">我已完成实际联系，继续记录</button></div><p className="muted">如果使用电话，无需复制；完成通话后直接继续记录即可。</p></article>}

    {step === 4 && <div className="manual-result-grid"><article className="panel"><SectionHeading description="这一步会写入真实消息/联系事实、完成当前任务并创建必要的下一次跟进。" eyebrow="步骤 4" title="记录真实联系结果" /><form className="stack-form" onSubmit={markSent}><label>实际联系渠道<select onChange={(event) => setValues((current) => ({ ...current, actual_channel: event.target.value }))} required value={values.actual_channel}><option value="">请选择</option>{channels.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>本次客户结果<select onChange={(event) => setValues((current) => ({ ...current, outcome: event.target.value }))} required value={values.outcome}><option value="">请选择</option>{outcomes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>本次对应任务<select onChange={(event) => setValues((current) => ({ ...current, task_id: event.target.value }))} value={values.task_id}><option value="">不指定</option>{tasks.map((task) => <option key={task.id} value={task.id}>{task.title} · {formatDate(task.due_at)}</option>)}</select></label>{requiresFollowUp && <label>下一次跟进时间<input min={toLocalDateTimeInputValue()} onChange={(event) => setValues((current) => ({ ...current, next_follow_up_at: event.target.value }))} required type="datetime-local" value={values.next_follow_up_at} /></label>}<label>沟通备注<textarea onChange={(event) => setValues((current) => ({ ...current, notes: event.target.value }))} placeholder="客户说了什么、有哪些疑问、下一步是什么" rows="4" value={values.notes} /></label><button className="button button--primary" disabled={working} type="submit">确认真实联系并保存下一步</button></form></article>
      <aside className="panel send-summary"><SectionHeading eyebrow="即将记录" title="请最后核对" /><dl className="detail-list"><div><dt>客户</dt><dd>{draft.contacts?.full_name}</dd></div><div><dt>渠道</dt><dd>{channels.find(([value]) => value === values.actual_channel)?.[1] || "尚未选择"}</dd></div><div><dt>结果</dt><dd>{outcomes.find(([value]) => value === values.outcome)?.[1] || "尚未选择"}</dd></div><div><dt>下一次跟进</dt><dd>{values.next_follow_up_at ? formatDate(values.next_follow_up_at) : requiresFollowUp ? "必须安排" : "无需强制"}</dd></div></dl><button className="button button--ghost button--block" onClick={() => setExternalContactConfirmed(false)} type="button">返回检查批准内容</button><p className="muted">“暂未回复 / 已经回复 / 明确有兴趣”必须创建下一次跟进；终止结果会关闭未完成任务，但不会自动创建商机。</p></aside></div>}

    {step === 5 && <article className="panel completion-card"><span><AppIcon name="check" /></span><h2>本次客户联系已完整记录</h2><p>真实渠道、内容快照、发送人、发送时间、结果和后续任务已经写入审计闭环。</p><div className="action-bar action-bar--center"><Link className="button button--primary" to={draft.lead_id ? `/leads/${draft.lead_id}` : "/inbox"}>返回线索工作台</Link><Link className="button button--secondary" to="/inbox">处理下一项</Link></div></article>}
  </section>;
}

function ManualStepper({ current }) {
  return <ol aria-label="人工消息处理步骤" className="manual-stepper">{stepLabels.map((label, index) => { const step = index + 1; const state = step < current ? "complete" : step === current ? "current" : "future"; return <li className={`manual-step manual-step--${state}`} key={label}><span>{state === "complete" ? <AppIcon name="check" size={16} /> : step}</span><strong>{label}</strong></li>; })}</ol>;
}

export function DraftReviewPage() {
  const { draftId } = useParams();
  const auth = useAuth();
  const query = useSupabaseQuery(async () => {
    const draft = await supabase.from("message_drafts").select("id,content,status,provider,lead_id,contact_id,opportunity_id,owner_member_id,ai_provider,ai_model,prompt_version,rejection_reason,updated_at,version,contacts(full_name),leads(public_id)").eq("id", draftId).maybeSingle();
    if (draft.error || !draft.data) return draft;
    const tasks = await supabase.from("follow_up_tasks").select("id,title,due_at,status").eq("lead_id", draft.data.lead_id).in("status", ["open", "snoozed"]).order("due_at");
    return tasks.error ? tasks : { data: { draft: draft.data, tasks: tasks.data ?? [] }, error: null };
  }, [draftId]);
  if (query.loading) return <LoadingState />;
  if (query.error) return <ErrorState message={query.error} onRetry={query.refresh} />;
  if (!query.data?.draft) return <EmptyState message="草稿不存在或无权访问。" />;
  return <DraftReviewContent auth={auth} draft={query.data.draft} key={query.data.draft.version} refresh={query.refresh} tasks={query.data.tasks} />;
}
