import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useAuth } from "../auth/context";
import { EmptyState, ErrorState, LoadingState, PageHeader, StatusBadge } from "../components/AsyncState";
import { SectionHeading } from "../components/WorkspaceUI";
import { executeCommand } from "../lib/commands";
import { toUserMessage } from "../lib/errors";
import { formatDate, toLocalDateTimeInputValue } from "../lib/format";
import { supabase } from "../lib/supabase";
import { useSupabaseQuery } from "../lib/useSupabaseQuery";
import { dueLabel, statusLabel, statusTone } from "../lib/workspace";

function ResourceTable({ rows, columns, linkPrefix }) {
  if (!rows?.length) return <EmptyState message="当前权限范围内暂无记录。" />;
  return <div className="table-card"><table><thead><tr>{columns.map((column) => <th key={column.key}>{column.label}</th>)}</tr></thead><tbody>{rows.map((row) => <tr key={row.id}>{columns.map((column, index) => <td key={column.key}>{index === 0 && linkPrefix ? <Link to={`${linkPrefix}/${row.id}`}>{column.render ? column.render(row) : row[column.key] || "—"}</Link> : column.render ? column.render(row) : row[column.key] || "—"}</td>)}</tr>)}</tbody></table></div>;
}

function ListPage({ title, eyebrow, description, query, columns, linkPrefix, actions, emptyAction, searchText = () => "", emptyMessage = "当前权限范围内暂无记录。" }) {
  const result = useSupabaseQuery(query, []);
  const [search, setSearch] = useState("");
  const rows = result.data?.filter((row) => searchText(row).toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())) ?? null;
  return <section><PageHeader eyebrow={eyebrow} title={title} description={description} actions={actions} />{result.loading && <LoadingState />}{result.error && <ErrorState message={result.error} onRetry={result.refresh} />}{result.data && <div className="resource-toolbar"><label className="search-field"><span>搜索</span><input onChange={(event) => setSearch(event.target.value)} placeholder={`搜索${title}…`} type="search" value={search} /></label><span>{rows.length} 条记录</span></div>}{rows && rows.length > 0 && <ResourceTable columns={columns} linkPrefix={linkPrefix} rows={rows} />}{rows && rows.length === 0 && <EmptyState action={search ? <button className="button button--secondary" onClick={() => setSearch("")} type="button">清除搜索</button> : emptyAction ?? <Link className="button button--primary" to="/setup">检查业务配置</Link>} message={search ? "没有符合当前搜索条件的记录。" : emptyMessage} title={search ? "没有搜索结果" : `${title}暂为空`} />}</section>;
}

export function ContactsPage() {
  return <ListPage title="客户" eyebrow="客户档案" description="从这里查找客户；具体需求、任务和消息都保留在客户对应的线索工作台中。" linkPrefix="/contacts" query={() => supabase.from("contacts").select("id,full_name,phone,email,status,identity_pending,updated_at").order("updated_at", { ascending: false })} searchText={(row) => [row.full_name, row.phone, row.email].filter(Boolean).join(" ")} columns={[
    { key: "full_name", label: "姓名" }, { key: "phone", label: "电话" }, { key: "email", label: "邮箱" },
    { key: "status", label: "状态", render: (row) => <StatusBadge>{row.status}</StatusBadge> },
    { key: "identity_pending", label: "身份", render: (row) => row.identity_pending ? "待确认" : "已识别" }, { key: "updated_at", label: "更新", render: (row) => formatDate(row.updated_at) },
  ]} />;
}

export function LeadsPage() {
  return <ListPage title="全部线索" eyebrow="高级业务视图" description="日常工作请使用待处理中心；这里用于检索全部历史线索。" actions={<Link className="button button--primary" to="/leads/new">+ 新建线索</Link>} emptyAction={<Link className="button button--primary" to="/leads/new">新建第一条线索</Link>} linkPrefix="/leads" query={() => supabase.from("leads").select("id,public_id,status,need,owner_member_id,created_at,contacts(full_name,phone)").order("created_at", { ascending: false })} searchText={(row) => [row.public_id, row.need, row.contacts?.full_name, row.contacts?.phone].filter(Boolean).join(" ")} columns={[
    { key: "public_id", label: "编号" }, { key: "contact", label: "客户", render: (row) => row.contacts?.full_name || "—" },
    { key: "need", label: "需求" }, { key: "status", label: "状态", render: (row) => <StatusBadge tone={statusTone(row.status)}>{statusLabel(row.status)}</StatusBadge> },
    { key: "created_at", label: "进入时间", render: (row) => formatDate(row.created_at) },
  ]} />;
}

export function OpportunitiesPage() {
  return <ListPage title="销售管道" eyebrow="人工确认的商机" description="进入商机后可推进阶段或标记成交；AI 不会自动把线索变成商机。" linkPrefix="/opportunities" query={() => supabase.from("opportunities").select("id,title,status,amount,currency,expected_close_date,pipeline_stages(name),contacts(full_name)").order("updated_at", { ascending: false })} searchText={(row) => [row.title, row.contacts?.full_name, row.pipeline_stages?.name].filter(Boolean).join(" ")} columns={[
    { key: "title", label: "商机" }, { key: "contact", label: "客户", render: (row) => row.contacts?.full_name || "—" },
    { key: "stage", label: "阶段", render: (row) => row.pipeline_stages?.name || "—" }, { key: "amount", label: "金额", render: (row) => row.amount ? `${row.currency} ${row.amount}` : "—" },
    { key: "status", label: "状态", render: (row) => <StatusBadge tone={statusTone(row.status)}>{statusLabel(row.status)}</StatusBadge> },
  ]} />;
}

export function TasksPage() {
  return <ListPage title="全部跟进任务" eyebrow="高级业务视图" description="今天到期和已逾期任务会自动进入待处理中心。这里用于检索全部未来任务。" linkPrefix="/tasks" query={() => supabase.from("follow_up_tasks").select("id,title,status,due_at,lead_id,contacts(full_name),leads(public_id)").order("due_at")} searchText={(row) => [row.title, row.contacts?.full_name, row.leads?.public_id].filter(Boolean).join(" ")} columns={[
    { key: "title", label: "任务" }, { key: "customer", label: "客户", render: (row) => row.contacts?.full_name || "—" },
    { key: "lead", label: "线索", render: (row) => row.leads?.public_id || "—" }, { key: "due_at", label: "截止", render: (row) => formatDate(row.due_at) },
    { key: "status", label: "状态", render: (row) => <StatusBadge tone={statusTone(row.status)}>{statusLabel(row.status)}</StatusBadge> },
  ]} />;
}

function DetailPage({ table, idName, select, title, render }) {
  const params = useParams();
  const id = params[idName];
  const result = useSupabaseQuery(() => supabase.from(table).select(select).eq("id", id).maybeSingle(), [id]);
  return <section><PageHeader eyebrow="记录详情" title={title} />{result.loading && <LoadingState />}{result.error && <ErrorState message={result.error} onRetry={result.refresh} />}{!result.loading && !result.error && !result.data && <EmptyState message="记录不存在或当前账号无权访问。" />}{result.data && render(result.data, result.refresh)}</section>;
}

function DefinitionList({ items }) { return <dl className="detail-list">{items.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value || "—"}</dd></div>)}</dl>; }

export function ContactDetailPage() {
  return <DetailPage table="contacts" idName="contactId" select="id,full_name,phone,email,wechat,status,identity_pending,notes,created_at,updated_at,version,accounts(name)" title="客户详情" render={(row) => <div className="panel"><h2>{row.full_name}</h2><DefinitionList items={[["企业", row.accounts?.name], ["电话", row.phone], ["邮箱", row.email], ["微信", row.wechat], ["状态", row.status], ["身份确认", row.identity_pending ? "待人工确认" : "已确认"], ["备注", row.notes], ["更新时间", formatDate(row.updated_at)]]} /></div>} />;
}

export function OpportunityDetailPage() {
  const { opportunityId } = useParams();
  const auth = useAuth();
  const [feedback, setFeedback] = useState(null);
  const [working, setWorking] = useState(false);
  const [showWonConfirm, setShowWonConfirm] = useState(false);
  const query = useSupabaseQuery(async () => {
    const [opportunity, stages] = await Promise.all([
      supabase.from("opportunities").select("id,title,status,amount,currency,expected_close_date,won_at,updated_at,version,pipeline_stage_id,pipeline_stages(name),contacts(full_name),leads(id,public_id)").eq("id", opportunityId).maybeSingle(),
      supabase.from("pipeline_stages").select("id,name,position,is_closed,is_won").order("position"),
    ]);
    const error = opportunity.error || stages.error;
    return { data: error ? null : { opportunity: opportunity.data, stages: stages.data ?? [] }, error };
  }, [opportunityId]);

  async function command(commandName, payload = {}) {
    setWorking(true); setFeedback(null);
    try {
      await executeCommand({ commandName, organizationId: auth.organization.id, actorUserId: auth.user.id, targetType: "opportunity", targetId: opportunityId, expectedVersion: query.data.opportunity.version, payload });
      setFeedback({ type: "success", message: commandName === "mark_opportunity_won" ? "商机已标记成交，相关未完成任务已关闭。" : "商机阶段已更新。" });
      await query.refresh();
      setShowWonConfirm(false);
  } catch (error) { setFeedback({ type: "error", message: toUserMessage(error, "商机操作没有完成，请稍后再试。") }); }
    finally { setWorking(false); }
  }

  if (query.loading) return <LoadingState />;
  if (query.error) return <ErrorState message={query.error} onRetry={query.refresh} />;
  if (!query.data?.opportunity) return <EmptyState message="商机不存在或当前账号无权访问。" />;
  const row = query.data.opportunity;
  const activeStages = query.data.stages.filter((stage) => !stage.is_closed && !stage.is_won);
  return <section className="workspace-page"><PageHeader eyebrow="销售管道" title={row.title} description={`${row.contacts?.full_name || "客户"} · 更新于 ${formatDate(row.updated_at)}`} actions={<StatusBadge tone={statusTone(row.status)}>{statusLabel(row.status)}</StatusBadge>} />
    {feedback && <div className={`feedback feedback--${feedback.type}`}>{feedback.message}</div>}
    <div className="detail-action-grid"><article className="panel"><SectionHeading eyebrow="商机信息" title="当前交易上下文" /><DefinitionList items={[["客户", row.contacts?.full_name], ["来源线索", row.leads?.public_id], ["当前阶段", row.pipeline_stages?.name], ["金额", row.amount ? `${row.currency} ${row.amount}` : null], ["预计成交", row.expected_close_date], ["成交时间", formatDate(row.won_at)]]} />{row.leads?.id && <Link className="button button--ghost" to={`/leads/${row.leads.id}`}>返回线索工作台</Link>}</article>
      <aside className="panel action-panel"><SectionHeading eyebrow="推进动作" title={row.status === "open" ? "更新商机进展" : "商机已结束"} />{row.status === "open" ? <><label>移动到阶段<select disabled={working} onChange={(event) => event.target.value !== row.pipeline_stage_id && command("change_opportunity_stage", { pipeline_stage_id: event.target.value })} value={row.pipeline_stage_id}>{activeStages.map((stage) => <option key={stage.id} value={stage.id}>{stage.name}</option>)}</select></label><button className="button button--primary button--block" onClick={() => setShowWonConfirm(true)} type="button">标记为已成交</button>{showWonConfirm && <div className="confirm-box"><strong>确认已经成交？</strong><p>该操作会写入成交时间，并关闭这个商机关联的未完成任务。</p><div className="action-bar"><button className="button button--danger" disabled={working} onClick={() => command("mark_opportunity_won")} type="button">确认成交</button><button className="button button--secondary" onClick={() => setShowWonConfirm(false)} type="button">取消</button></div></div>}</> : <EmptyState compact message="可以继续查看历史记录，但当前没有可执行的推进动作。" />}</aside></div>
  </section>;
}

export function TaskDetailPage() {
  const { taskId } = useParams();
  const auth = useAuth();
  const [snoozedUntil, setSnoozedUntil] = useState("");
  const [feedback, setFeedback] = useState(null);
  const [working, setWorking] = useState(false);
  const query = useSupabaseQuery(() => supabase.from("follow_up_tasks").select("id,title,status,due_at,snoozed_until,completed_at,outcome,notes,version,contacts(full_name),leads(id,public_id,status)").eq("id", taskId).maybeSingle(), [taskId]);
  if (query.loading) return <LoadingState />;
  if (query.error) return <ErrorState message={query.error} onRetry={query.refresh} />;
  if (!query.data) return <EmptyState message="任务不存在或当前账号无权访问。" />;
  const row = query.data;

  async function snooze(event) {
    event.preventDefault(); setWorking(true); setFeedback(null);
    try {
      await executeCommand({ commandName: "snooze_follow_up", organizationId: auth.organization.id, actorUserId: auth.user.id, targetType: "task", targetId: row.id, expectedVersion: row.version, payload: { snoozed_until: new Date(snoozedUntil).toISOString() } });
      setFeedback({ type: "success", message: "提醒时间已延后，工作队列会按新时间重新排序。" }); setSnoozedUntil(""); await query.refresh();
  } catch (error) { setFeedback({ type: "error", message: toUserMessage(error, "跟进任务没有保存成功，请稍后再试。") }); }
    finally { setWorking(false); }
  }

  const actionable = ["open", "snoozed"].includes(row.status);
  return <section className="workspace-page"><PageHeader eyebrow="跟进任务" title={row.title} description={`${row.contacts?.full_name || "客户"} · ${dueLabel(row.due_at)}`} actions={<StatusBadge tone={statusTone(row.status)}>{statusLabel(row.status)}</StatusBadge>} />
    {feedback && <div className={`feedback feedback--${feedback.type}`}>{feedback.message}</div>}
    <div className="detail-action-grid"><article className="panel"><SectionHeading eyebrow="任务上下文" title="这次要完成什么" /><DefinitionList items={[["客户", row.contacts?.full_name], ["线索", row.leads?.public_id], ["截止", formatDate(row.due_at)], ["延后至", formatDate(row.snoozed_until)], ["结果", row.outcome ? statusLabel(row.outcome) : null], ["备注", row.notes]]} />{row.leads?.id && <Link className="button button--primary button--block" to={`/leads/${row.leads.id}?from=task&task=${row.id}`}>进入线索工作台完成跟进</Link>}</article>
      <aside className="panel action-panel"><SectionHeading eyebrow="时间安排" title={actionable ? "需要晚一点处理？" : "任务已经结束"} />{actionable ? <form className="stack-form" onSubmit={snooze}><label>新的提醒时间<input min={toLocalDateTimeInputValue()} onChange={(event) => setSnoozedUntil(event.target.value)} required type="datetime-local" value={snoozedUntil} /></label><button className="button button--secondary" disabled={working} type="submit">延后提醒</button></form> : <EmptyState compact message="已完成或取消的任务不能再次延后。" />}<p className="muted">完成状态必须来自真实联系结果或人工消息发送记录，页面不会伪造任务完成。</p></aside></div>
  </section>;
}
