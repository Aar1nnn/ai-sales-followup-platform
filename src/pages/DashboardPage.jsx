import { Link } from "react-router-dom";
import { useAuth } from "../auth/context";
import { EmptyState, ErrorState, LoadingState, PageHeader } from "../components/AsyncState";
import { AppIcon, ProgressBar, QueueCard, SectionHeading } from "../components/WorkspaceUI";
import { readWorkQueue } from "../lib/readWorkQueue";
import { supabase } from "../lib/supabase";
import { useSupabaseQuery } from "../lib/useSupabaseQuery";
import { buildWorkQueue } from "../lib/workspace";

const roleCopy = {
  owner: ["企业经营工作台", "先确认系统是否就绪，再处理最影响销售推进的事项。"],
  admin: ["系统与销售工作台", "关注接入状态、异常事项和需要协调的销售工作。"],
  manager: ["团队销售工作台", "优先解决未分配、超时和需要审批的工作。"],
  sales: ["我的今日工作", "系统已经按紧急程度整理好客户，现在从第一项开始。"],
};

export function DashboardPage() {
  const auth = useAuth();
  const query = useSupabaseQuery(async () => {
    const [work, opportunities, sources, automation, aiScores] = await Promise.all([
      readWorkQueue(),
      supabase.from("opportunities").select("id", { count: "exact", head: true }).eq("status", "open"),
      supabase.from("lead_source_connections").select("id", { count: "exact", head: true }).eq("status", "active"),
      supabase.from("automation_runs").select("id", { count: "exact", head: true }).eq("status", "succeeded"),
      supabase.from("lead_scores").select("id", { count: "exact", head: true }).not("ai_provider", "is", null),
    ]);
    const error = work.error || opportunities.error || sources.error || automation.error || aiScores.error;
    return { data: error ? null : { work: work.data, openOpportunities: opportunities.count ?? 0, sourceReady: (sources.count ?? 0) > 0, automationVerified: (automation.count ?? 0) > 0, aiVerified: (aiScores.count ?? 0) > 0 }, error };
  }, []);

  if (query.loading) return <LoadingState label="正在整理今天的工作…" />;
  if (query.error) return <ErrorState message={query.error} onRetry={query.refresh} />;

  const queue = buildWorkQueue(query.data.work);
  const overdue = queue.filter((item) => item.kind === "task" && item.meta.startsWith("已逾期")).length;
  const leads = queue.filter((item) => ["lead", "unassigned"].includes(item.kind)).length;
  const drafts = queue.filter((item) => item.kind === "draft").length;
  const [eyebrow, description] = roleCopy[auth.membership.role] || roleCopy.sales;
  const displayName = auth.membership.profiles?.display_name || auth.user.email?.split("@")[0] || "你好";
  const isAdministrator = ["owner", "admin"].includes(auth.membership.role);
  const readinessValue = [query.data.sourceReady, query.data.automationVerified, query.data.aiVerified].filter(Boolean).length;

  return <section className="workspace-page">
    <PageHeader eyebrow={eyebrow} title={`${displayName}，今天从这里开始`} description={description} actions={<><Link className="button button--secondary" to="/leads/new">+ 新建线索</Link>{queue[0] && <Link className="button button--primary" to={queue[0].href}>处理下一项<AppIcon name="arrow" size={17} /></Link>}</>} />

    <div className="metric-grid metric-grid--workspace">
      <Metric accent="danger" label="逾期跟进" to="/inbox?view=tasks" value={overdue} />
      <Metric accent="info" label="待确认线索" to="/inbox?view=leads" value={leads} />
      <Metric accent="purple" label="待处理草稿" to="/inbox?view=drafts" value={drafts} />
      <Metric label="开放商机" to="/opportunities" value={query.data.openOpportunities} />
    </div>

    {isAdministrator && readinessValue < 3 && <section className="readiness-banner"><div><span className="readiness-banner__icon"><AppIcon name="setup" /></span><div><strong>系统还没有完成业务接入</strong><p>来源、自动化和 AI 需要实际验证后，才能形成完整的自动跟进闭环。</p></div></div><ProgressBar label="核心自动化就绪度" max={3} value={readinessValue} /><Link className="button button--secondary" to="/setup">查看缺失步骤</Link></section>}

    <section className="workspace-section">
      <SectionHeading action={<Link to="/inbox">查看全部待处理 →</Link>} description="按照逾期、未分配、新线索和草稿状态自动排序。" eyebrow="下一步行动" title="最需要你处理的工作" />
      {queue.length === 0 ? <EmptyState action={isAdministrator ? <Link className="button button--primary" to="/setup">完成上线配置</Link> : <Link className="button button--secondary" to="/contacts">查看客户</Link>} message={isAdministrator ? "当前没有销售待办。先完成来源和自动化配置，新的线索才会进入这里。" : "当前没有逾期、今天到期或待确认事项。"} title="今天的队列已清空" /> : <div className="queue-list">{queue.slice(0, 5).map((item) => <QueueCard compact item={item} key={item.id} />)}</div>}
    </section>

    <div className="principle-card"><span><AppIcon name="spark" /></span><div><strong>AI 负责准备，人负责决定</strong><p>评分、证据和草稿只用于辅助。转商机和客户消息发送仍由你明确确认。</p></div></div>
  </section>;
}

function Metric({ label, value, to, accent = "default" }) {
  return <Link className={`metric metric--link metric--${accent}`} to={to}><span>{label}</span><strong>{value}</strong><small>查看相关工作 →</small></Link>;
}
