export function LoadingState({ label = "正在读取数据…" }) {
  return <div className="state-card" aria-live="polite"><span className="spinner" />{label}</div>;
}

export function ErrorState({ message, onRetry }) {
  return <div className="state-card state-card--error" role="alert"><strong>读取失败</strong><span>{message}</span>{onRetry && <button className="button button--secondary" onClick={onRetry} type="button">重试</button>}</div>;
}

export function EmptyState({ message = "暂无数据", title, action, compact = false }) {
  return <div className={`state-card state-card--empty${compact ? " state-card--compact" : ""}`}><div>{title && <strong>{title}</strong>}<span>{message}</span></div>{action}</div>;
}

export function PageHeader({ eyebrow, title, description, actions }) {
  return <header className="page-header"><div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1>{description && <p>{description}</p>}</div>{actions && <div className="page-actions">{actions}</div>}</header>;
}

export function StatusBadge({ children, tone = "neutral" }) {
  return <span className={`badge badge--${tone}`}>{children || "—"}</span>;
}
