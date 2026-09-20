import { useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../auth/context";
import { EmptyState, ErrorState, LoadingState, PageHeader, StatusBadge } from "../components/AsyncState";
import { canAdministerOrganization } from "../lib/adminAccess";
import { executeCommand } from "../lib/commands";
import { toUserMessage } from "../lib/errors";
import { formatDate } from "../lib/format";
import { supabase } from "../lib/supabase";
import { useSupabaseQuery } from "../lib/useSupabaseQuery";
import { statusLabel, statusTone } from "../lib/workspace";

async function readOperations() {
  const [events, runs] = await Promise.all([
    supabase.from("outbox_events").select(
      "id,aggregate_type,aggregate_id,event_type,status,attempts,max_attempts,available_at,last_error_code,last_error_message,payload,created_at,updated_at,version",
    ).order("created_at", { ascending: false }).limit(100),
    supabase.from("automation_runs").select(
      "id,workflow_key,external_execution_id,outbox_event_id,status,attempt,started_at,completed_at,error_code,error_message,metrics",
    ).order("started_at", { ascending: false }).limit(100),
  ]);
  const error = events.error || runs.error;
  return { data: error ? null : { events: events.data ?? [], runs: runs.data ?? [] }, error };
}

export function OperationsPage() {
  const auth = useAuth();
  const query = useSupabaseQuery(readOperations, []);
  const [feedback, setFeedback] = useState(null);
  const [retrying, setRetrying] = useState(null);
  const metrics = useMemo(() => ({
    pending: query.data?.events.filter((event) => event.status === "pending").length ?? 0,
    processing: query.data?.events.filter((event) => event.status === "processing").length ?? 0,
    deadLetter: query.data?.events.filter((event) => event.status === "dead_letter").length ?? 0,
    failedRuns: query.data?.runs.filter((run) => ["failed", "dead_letter"].includes(run.status)).length ?? 0,
  }), [query.data]);

  if (!canAdministerOrganization(auth.membership.role)) return <Navigate replace to="/forbidden" />;

  async function retry(event) {
    setRetrying(event.id);
    setFeedback(null);
    try {
      await executeCommand({
        commandName: "retry_outbox_event",
        organizationId: auth.organization.id,
        actorUserId: auth.user.id,
        targetType: "outbox_event",
        targetId: event.id,
        expectedVersion: event.version,
        payload: {},
      });
      setFeedback({ type: "success", message: "事件已重置为 pending，将由 Dispatcher 重新领取。" });
      await query.refresh();
    } catch (error) {
      setFeedback({ type: "error", message: toUserMessage(error, "自动化操作没有完成，请稍后再试。") });
    } finally {
      setRetrying(null);
    }
  }

  return <section>
    <PageHeader eyebrow="系统运维" title="自动化运行与异常" description="查看 Outbox 和 n8n 运行结果。重试只重置 dead-letter 事件，不会由浏览器直接修改业务状态。" actions={<button className="button button--secondary" onClick={query.refresh} type="button">刷新</button>} />
    {feedback && <div className={`feedback feedback--${feedback.type}`}>{feedback.message}</div>}
    <div className="metric-grid operations-metrics"><article className="metric"><span>等待派发</span><strong>{metrics.pending}</strong></article><article className="metric"><span>处理中</span><strong>{metrics.processing}</strong></article><article className="metric metric--danger"><span>需人工处理</span><strong>{metrics.deadLetter}</strong></article><article className="metric"><span>失败运行</span><strong>{metrics.failedRuns}</strong></article></div>
    {query.loading && <LoadingState />}
    {query.error && <ErrorState message={query.error} onRetry={query.refresh} />}
    {query.data && <>
      <section className="subsection"><h2>Outbox 事件</h2>{query.data.events.length === 0
        ? <EmptyState message="暂无 Outbox 事件。" />
        : <div className="table-card"><table><thead><tr><th>事件</th><th>状态</th><th>尝试</th><th>可用时间</th><th>最后错误</th><th>操作</th></tr></thead><tbody>{query.data.events.map((event) => <tr key={event.id}><td><strong>{event.event_type}</strong><br /><span className="muted">{event.aggregate_type} · {event.id}</span><details><summary>查看业务载荷（仅管理员）</summary><pre className="payload-preview">{JSON.stringify(event.payload, null, 2)}</pre></details></td><td><StatusBadge tone={statusTone(event.status)}>{statusLabel(event.status)}</StatusBadge></td><td>{event.attempts} / {event.max_attempts}</td><td>{formatDate(event.available_at)}</td><td>{event.last_error_code || "—"}<br /><span className="muted">{event.last_error_message || ""}</span></td><td>{event.status === "dead_letter" && <button className="button button--secondary" disabled={retrying === event.id} onClick={() => retry(event)} type="button">重试</button>}</td></tr>)}</tbody></table></div>}</section>
      <section className="subsection"><h2>自动化运行记录</h2>{query.data.runs.length === 0
        ? <EmptyState message="暂无自动化运行记录。" />
        : <div className="table-card"><table><thead><tr><th>工作流</th><th>状态</th><th>尝试</th><th>时间</th><th>错误</th></tr></thead><tbody>{query.data.runs.map((run) => <tr key={run.id}><td><strong>{run.workflow_key}</strong><br /><span className="muted">{run.external_execution_id || run.id}</span></td><td><StatusBadge tone={statusTone(run.status)}>{statusLabel(run.status)}</StatusBadge></td><td>{run.attempt}</td><td>{formatDate(run.started_at)}</td><td>{run.error_code || "—"}<br /><span className="muted">{run.error_message || ""}</span></td></tr>)}</tbody></table></div>}</section>
    </>}
  </section>;
}
