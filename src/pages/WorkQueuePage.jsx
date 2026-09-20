import { Link, useSearchParams } from "react-router-dom";
import { EmptyState, ErrorState, LoadingState, PageHeader } from "../components/AsyncState";
import { QueueCard } from "../components/WorkspaceUI";
import { readWorkQueue } from "../lib/readWorkQueue";
import { useSupabaseQuery } from "../lib/useSupabaseQuery";
import { buildWorkQueue, filterWorkQueue } from "../lib/workspace";

const views = [
  ["all", "全部"], ["leads", "线索"], ["tasks", "今天与逾期"], ["drafts", "消息草稿"],
];

export function WorkQueuePage() {
  const [params, setParams] = useSearchParams();
  const activeView = views.some(([value]) => value === params.get("view")) ? params.get("view") : "all";
  const query = useSupabaseQuery(readWorkQueue, []);
  if (query.loading) return <LoadingState label="正在整理待处理事项…" />;
  if (query.error) return <ErrorState message={query.error} onRetry={query.refresh} />;
  const items = buildWorkQueue(query.data);
  const filtered = filterWorkQueue(items, activeView);
  const counts = Object.fromEntries(views.map(([value]) => [value, filterWorkQueue(items, value).length]));
  return <section className="workspace-page">
    <PageHeader eyebrow="统一工作队列" title="待处理中心" description="线索、任务和消息草稿已经按紧急程度放在同一个队列里，不需要再逐张表查找。" actions={<button className="button button--secondary" onClick={query.refresh} type="button">刷新队列</button>} />
    <div aria-label="待处理类型" className="filter-tabs" role="tablist">{views.map(([value, label]) => <button aria-selected={activeView === value} className={activeView === value ? "active" : ""} key={value} onClick={() => setParams(value === "all" ? {} : { view: value })} role="tab" type="button">{label}<span>{counts[value]}</span></button>)}</div>
    <div className="queue-list queue-list--roomy">{filtered.map((item) => <QueueCard item={item} key={item.id} />)}</div>
    {filtered.length === 0 && <EmptyState action={activeView === "all" ? <Link className="button button--primary" to="/setup">检查系统接入</Link> : <button className="button button--secondary" onClick={() => setParams({})} type="button">查看全部</button>} message={activeView === "all" ? "没有逾期、今天到期、新线索或待处理草稿。" : "这个分类当前没有待处理事项。"} title="当前队列为空" />}
    <p className="queue-footnote">未来任务仍可在客户或线索工作台中查看；这里只显示现在需要行动的事项。</p>
  </section>;
}
