import { Link, NavLink, Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../auth/context";
import { AppIcon } from "../components/WorkspaceUI";
import { supabase } from "../lib/supabase";
import { sanitizeReturnTo } from "../lib/returnTo";
import { businessNavigation } from "../lib/navigation";
import { useSupabaseQuery } from "../lib/useSupabaseQuery";

const roleLabels = { owner: "企业负责人", admin: "系统管理员", manager: "销售经理", sales: "销售顾问" };

const workNavigation = [
  { to: "/dashboard", label: "今日工作", icon: "today" },
  { to: "/inbox", label: "待处理", icon: "inbox", pending: true },
];

const adminNavigation = [
  { to: "/setup", label: "上线中心", icon: "setup" },
  { to: "/operations", label: "自动化中心", icon: "automation" },
  { to: "/settings/assignment", label: "系统设置", icon: "settings" },
];

const routeTitles = [
  ["/leads/new", "新建线索"],
  ["/message-drafts/", "人工消息"],
  ["/opportunities/", "商机详情"],
  ["/contacts/", "客户详情"],
  ["/leads/", "线索工作台"],
  ["/tasks/", "跟进任务"],
  ["/settings", "系统设置"],
  ["/operations", "自动化中心"],
  ["/setup", "上线中心"],
  ["/reports", "数据分析"],
  ["/opportunities", "销售管道"],
  ["/contacts", "客户"],
  ["/inbox", "待处理"],
  ["/dashboard", "今日工作"],
];

function PendingNavCount() {
  const query = useSupabaseQuery(async () => {
    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);
    const [leads, tasks, drafts] = await Promise.all([
      supabase.from("leads").select("id", { count: "exact", head: true }).eq("status", "new"),
      supabase.from("follow_up_tasks").select("id", { count: "exact", head: true }).in("status", ["open", "snoozed"]).lte("due_at", endOfToday.toISOString()),
      supabase.from("message_drafts").select("id", { count: "exact", head: true }).in("status", ["draft", "pending_approval", "approved", "rejected"]),
    ]);
    const error = leads.error || tasks.error || drafts.error;
    return { data: error ? null : (leads.count ?? 0) + (tasks.count ?? 0) + (drafts.count ?? 0), error };
  }, []);
  if (!query.data) return null;
  return <span aria-label={`${query.data} 项待处理`} className="nav-count">{query.data > 99 ? "99+" : query.data}</span>;
}

function NavigationGroup({ label, items }) {
  return <div className="nav-group"><span className="nav-group__label">{label}</span>{items.map((item) => <NavLink className={({ isActive }) => isActive ? "active" : ""} end={item.to === "/dashboard"} key={item.to} to={item.to}><AppIcon name={item.icon} /><span>{item.label}</span>{item.pending && <PendingNavCount />}</NavLink>)}</div>;
}

export function PublicLayout() {
  return <main className="public-layout"><div className="brand brand--public"><span>AI</span> 客户营销跟进系统</div><Outlet /></main>;
}

export function AuthenticatedAppLayout() {
  const auth = useAuth();
  const location = useLocation();
  if (auth.loading) return <div className="full-state">正在验证登录状态…</div>;
  if (!auth.session) {
    const returnTo = sanitizeReturnTo(`${location.pathname}${location.search}`);
    return <Navigate replace to={`/login?returnTo=${encodeURIComponent(returnTo)}`} />;
  }
  if (auth.requiresPasswordSetup) return <Navigate replace to="/set-password" />;
  if (!auth.membership || !auth.organization) return <Navigate replace to="/forbidden" />;
  return <AppChrome auth={auth} location={location} />;
}

function AppChrome({ auth, location }) {
  const isAdministrator = ["owner", "admin"].includes(auth.membership.role);
  const title = routeTitles.find(([prefix]) => location.pathname.startsWith(prefix))?.[1] || "销售工作台";
  const displayName = auth.membership.profiles?.display_name || auth.user.email?.split("@")[0] || "当前用户";
  return <div className="app-shell">
    <aside className="sidebar">
      <Link className="brand" to="/dashboard"><span>AI</span><div><strong>销售跟进</strong><small>客户行动工作台</small></div></Link>
      <nav><NavigationGroup items={workNavigation} label="工作" /><NavigationGroup items={businessNavigation} label="业务" />{isAdministrator && <NavigationGroup items={adminNavigation} label="管理" />}</nav>
      <div className="sidebar-footer"><div className="avatar">{displayName.slice(0, 1).toUpperCase()}</div><div><strong>{displayName}</strong><span>{roleLabels[auth.membership.role] || auth.membership.role}</span></div><button aria-label="退出登录" onClick={() => void supabase.auth.signOut()} type="button">退出</button></div>
    </aside>
    <div className="app-main"><header className="topbar"><div><span>当前位置</span><strong>{title}</strong></div><div className="topbar__actions"><Link className="topbar-link" to="/contacts">查找客户</Link><Link className="button button--primary" to="/inbox">查看待处理</Link></div></header><main className="app-content"><Outlet /></main></div>
  </div>;
}

const settingsLinks = [
  ["members", "成员与角色"], ["assignment", "分配与 SLA"], ["scoring", "客户画像"], ["channels", "内部通知"], ["integrations", "线索来源"],
];

export function SettingsLayout() {
  return <div><div className="settings-tabs">{settingsLinks.map(([path, label]) => <NavLink key={path} to={`/settings/${path}`}>{label}</NavLink>)}</div><Outlet /></div>;
}
