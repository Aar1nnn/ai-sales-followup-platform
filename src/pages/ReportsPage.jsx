import { ErrorState, LoadingState, PageHeader } from "../components/AsyncState";
import { supabase } from "../lib/supabase";
import { useSupabaseQuery } from "../lib/useSupabaseQuery";

export function ReportsPage() {
  const query = useSupabaseQuery(async () => {
    const [leads, tasks, outcomes, won] = await Promise.all([
      supabase.from("leads").select("status"), supabase.from("follow_up_tasks").select("status"),
      supabase.from("messages").select("outcome"), supabase.from("opportunities").select("amount,currency").eq("status", "won"),
    ]);
    const failed = [leads, tasks, outcomes, won].find((value) => value.error);
    return failed?.error ? { data: null, error: failed.error } : { data: { leads: leads.data ?? [], tasks: tasks.data ?? [], outcomes: outcomes.data ?? [], won: won.data ?? [] }, error: null };
  }, []);
  return <section><PageHeader eyebrow="组织内可见数据" title="报表" description="所有指标继续受 RLS 限制；Sales 只统计自己可访问的业务。" />{query.loading && <LoadingState />}{query.error && <ErrorState message={query.error} onRetry={query.refresh} />}{query.data && <div className="metric-grid"><article className="metric"><span>新线索</span><strong>{query.data.leads.filter((row) => row.status === "new").length}</strong></article><article className="metric"><span>待完成任务</span><strong>{query.data.tasks.filter((row) => ["open", "snoozed"].includes(row.status)).length}</strong></article><article className="metric"><span>感兴趣回复</span><strong>{query.data.outcomes.filter((row) => row.outcome === "interested").length}</strong></article><article className="metric"><span>成交商机</span><strong>{query.data.won.length}</strong></article></div>}</section>;
}
