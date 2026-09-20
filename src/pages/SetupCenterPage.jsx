import { Link, Navigate } from "react-router-dom";
import { useAuth } from "../auth/context";
import { ErrorState, LoadingState, PageHeader, StatusBadge } from "../components/AsyncState";
import { ProgressBar, SetupChecklistItem } from "../components/WorkspaceUI";
import { formatDate } from "../lib/format";
import { sourceReadiness } from "../lib/setupReadiness";
import { supabase } from "../lib/supabase";
import { useSupabaseQuery } from "../lib/useSupabaseQuery";

export function SetupCenterPage() {
  const auth = useAuth();
  const query = useSupabaseQuery(async () => {
    const [members, sources, inboundEvents, channels, runs, scores, profiles, assignment] = await Promise.all([
      supabase.from("organization_members").select("id,role,status"),
      supabase.from("lead_source_connections").select("id,name,provider,status,validated_at"),
      supabase.from("inbound_events").select("id,source_connection_id,status,lead_id,processed_at")
        .eq("status", "processed").not("lead_id", "is", null)
        .order("processed_at", { ascending: false }).limit(20),
      supabase.from("channel_connections").select("id,name,provider,status,validated_at"),
      supabase.from("automation_runs").select("id,status,workflow_key,completed_at").eq("status", "succeeded").order("completed_at", { ascending: false }).limit(1),
      supabase.from("lead_scores").select("id,ai_provider,ai_model,scored_at").not("ai_provider", "is", null).order("scored_at", { ascending: false }).limit(1),
      supabase.from("organization_scoring_profiles").select("id,name,status,profile_version").eq("status", "active").limit(1),
      supabase.from("organization_assignment_settings").select("id,strategy,auto_assignment_enabled,first_response_sla_minutes").maybeSingle(),
    ]);
    const failed = [members, sources, inboundEvents, channels, runs, scores, profiles, assignment].find((result) => result.error);
    return { data: failed?.error ? null : { members: members.data ?? [], sources: sources.data ?? [], inboundEvents: inboundEvents.data ?? [], channels: channels.data ?? [], runs: runs.data ?? [], scores: scores.data ?? [], profiles: profiles.data ?? [], assignment: assignment.data }, error: failed?.error ?? null };
  }, []);

  if (!["owner", "admin"].includes(auth.membership.role)) return <Navigate replace to="/forbidden" />;
  if (query.loading) return <LoadingState label="正在检查系统就绪状态…" />;
  if (query.error) return <ErrorState message={query.error} onRetry={query.refresh} />;

  const activeSales = query.data.members.filter((member) => member.status === "active" && member.role === "sales").length;
  const sourceState = sourceReadiness(query.data.sources, query.data.inboundEvents);
  const source = sourceState.verifiedSource ?? sourceState.configuredSource;
  const manual = query.data.channels.find((connection) => connection.provider === "manual" && connection.status === "active");
  const feishu = query.data.channels.find((connection) => connection.provider === "feishu_internal" && connection.status === "active");
  const scoreProfile = query.data.profiles[0];
  const automationRun = query.data.runs[0];
  const aiScore = query.data.scores[0];
  const coreItems = [true, Boolean(query.data.assignment), Boolean(scoreProfile), activeSales > 0, sourceState.ready, Boolean(automationRun), Boolean(aiScore), Boolean(manual)];
  const complete = coreItems.filter(Boolean).length;

  return <section className="workspace-page setup-center">
    <PageHeader eyebrow="企业上线向导" title="把系统配置到可以真正工作" description="这里用业务语言检查完整链路。只有实际产生成功记录的外部能力才显示为已验证。" actions={<><Link className="button button--primary" to="/leads/new?demo=1">开始无飞书演示</Link><button className="button button--secondary" onClick={query.refresh} type="button">重新检查</button></>} />
    <section className="setup-summary"><div><span>当前企业</span><h2>{auth.organization.name}</h2><p>核心步骤完成 {complete} / {coreItems.length}</p></div><ProgressBar label="上线准备进度" max={coreItems.length} value={complete} /><StatusBadge tone={complete === coreItems.length ? "success" : "info"}>{complete === coreItems.length ? "核心链路已验证" : "仍需配置"}</StatusBadge></section>

    <div className="setup-groups">
      <section className="panel"><div className="setup-group__header"><span>01</span><div><h2>组织和销售规则</h2><p>先确定谁负责销售、系统如何分配以及什么客户值得优先处理。</p></div></div>
        <SetupChecklistItem complete description="当前页面已使用 Publishable Key 通过 RLS 读取企业数据。" title="Supabase 与企业空间" />
        <SetupChecklistItem action={<Link to="/settings/members">管理成员</Link>} complete={activeSales > 0} description={activeSales > 0 ? `已有 ${activeSales} 名在职 Sales。` : "当前只有管理账号，至少添加一名实际跟进客户的 Sales。"} title="销售成员" />
        <SetupChecklistItem action={<Link to="/settings/assignment">检查规则</Link>} complete={Boolean(query.data.assignment)} description={query.data.assignment ? `${query.data.assignment.strategy} · 首次响应 ${query.data.assignment.first_response_sla_minutes} 分钟` : "尚未建立分配与 SLA 规则。"} title="分配与首次响应规则" />
        <SetupChecklistItem action={<Link to="/settings/scoring">核对画像</Link>} complete={Boolean(scoreProfile)} description={scoreProfile ? `${scoreProfile.name} · 版本 ${scoreProfile.profile_version}` : "尚未建立预算、行业、地区和买方角色画像。"} title="目标客户画像" />
      </section>

      <section className="panel"><div className="setup-group__header"><span>02</span><div><h2>线索和人工触达</h2><p>保证线索能安全进入，并且每次客户联系都记录真实渠道和结果。</p></div></div>
        <SetupChecklistItem
          action={sourceState.ready
            ? <Link to={`/leads/${sourceState.successfulEvent.lead_id}`}>查看验收线索</Link>
            : source
              ? <Link to="/leads/new">创建测试线索</Link>
              : <Link to="/settings/integrations">配置来源</Link>}
          complete={sourceState.ready}
          description={sourceState.ready
            ? `${source.name} · 最近成功入站 ${formatDate(sourceState.successfulEvent.processed_at)}`
            : source
              ? `${source.name} 已配置，但还没有真实成功创建线索。`
              : "尚未启用 Tally、Generic Webhook 或 Internal Manual 来源。"}
          title="线索入口验收"
        />
        <SetupChecklistItem complete={Boolean(manual)} description={manual ? "人工发送记录能力已启用。" : "Manual Provider 尚未启用，无法记录真实客户触达。"} title="人工客户触达" />
        <SetupChecklistItem action={<Link to="/settings/channels">配置飞书</Link>} complete={Boolean(feishu)} description={feishu ? `${feishu.name} 已验证。` : "用于个人任务卡片、群日报和异常通知，不影响核心人工跟进。"} optional title="飞书内部通知" />
      </section>

      <section className="panel"><div className="setup-group__header"><span>03</span><div><h2>自动化与 AI 验证</h2><p>配置不等于可用；这里必须看到真实成功记录才算通过。</p></div></div>
        <SetupChecklistItem action={<Link to="/operations">查看运行</Link>} complete={Boolean(automationRun)} description={automationRun ? `最近成功：${automationRun.workflow_key}` : "尚未检测到 n8n 成功运行记录。需要部署 n8n、配置 Credentials 并保持 workflow inactive，直到联调。"} title="n8n 自动化" />
        <SetupChecklistItem action={<Link to="/operations">查看自动化</Link>} complete={Boolean(aiScore)} description={aiScore ? `已验证 ${aiScore.ai_provider}/${aiScore.ai_model}` : "尚未检测到包含 provider/model 的真实 AI 评分。请先在 n8n 配置客户自己的 OpenAI-compatible 凭证并执行连接验证。"} title="AI 模型连接" />
      </section>
    </div>

    <div className="notice"><strong>下一步如何验收</strong><p>点击“开始无飞书演示”创建一条虚拟线索。它应当完成评分、分配和草稿；内部通知本轮可跳过，任何客户消息仍必须人工确认。</p></div>
  </section>;
}
