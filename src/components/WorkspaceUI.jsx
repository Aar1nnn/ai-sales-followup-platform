import { Link } from "react-router-dom";
import { StatusBadge } from "./AsyncState";
import { statusLabel, statusTone } from "../lib/workspace";

const iconPaths = {
  today: <><path d="M5 5.5h14v13H5z" /><path d="M8 3v5M16 3v5M5 10h14" /></>,
  inbox: <><path d="M4 5h16v14H4z" /><path d="M4 14h4l2 3h4l2-3h4" /></>,
  customers: <><circle cx="9" cy="8" r="3" /><path d="M3.5 19c.5-4 2.5-6 5.5-6s5 2 5.5 6M16 7h5M18.5 4.5v5" /></>,
  pipeline: <><path d="M4 6h5v12H4zM10 9h5v9h-5zM16 4h4v14h-4z" /></>,
  reports: <><path d="M5 19V9M12 19V5M19 19v-7" /><path d="M3 19h18" /></>,
  setup: <><circle cx="12" cy="12" r="3" /><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1" /></>,
  automation: <><path d="M4 7h11M15 7l-3-3M15 7l-3 3M20 17H9M9 17l3-3M9 17l3 3" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1" /></>,
  arrow: <><path d="M5 12h14M14 7l5 5-5 5" /></>,
  check: <path d="m5 12 4 4L19 6" />,
  alert: <><path d="M12 4 3.5 19h17z" /><path d="M12 9v4M12 16h.01" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  spark: <><path d="m12 3 1.4 4.6L18 9l-4.6 1.4L12 15l-1.4-4.6L6 9l4.6-1.4z" /><path d="m18 15 .7 2.3L21 18l-2.3.7L18 21l-.7-2.3L15 18l2.3-.7z" /></>,
};

export function AppIcon({ name, size = 20 }) {
  return <svg aria-hidden="true" className="app-icon" fill="none" height={size} stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24" width={size}>{iconPaths[name] || iconPaths.arrow}</svg>;
}

export function SectionHeading({ eyebrow, title, description, action }) {
  return <div className="section-heading"><div>{eyebrow && <span className="eyebrow">{eyebrow}</span>}<h2>{title}</h2>{description && <p>{description}</p>}</div>{action}</div>;
}

export function QueueCard({ item, compact = false }) {
  return <article className={`queue-card${compact ? " queue-card--compact" : ""}`}>
    <div className={`queue-card__marker queue-card__marker--${item.kind}`}><AppIcon name={item.kind === "task" ? "clock" : item.kind === "draft" ? "spark" : item.kind === "unassigned" ? "alert" : "customers"} /></div>
    <div className="queue-card__body"><div className="queue-card__top"><span className="queue-card__customer">{item.customer}</span><StatusBadge tone={statusTone(item.status)}>{statusLabel(item.status)}</StatusBadge></div><h3>{item.title}</h3><p>{item.reason}</p><span className="queue-card__meta">{item.meta}</span></div>
    <Link className="button button--secondary queue-card__action" to={item.href}>{item.actionLabel}<AppIcon name="arrow" size={16} /></Link>
  </article>;
}

export function SetupChecklistItem({ complete, optional = false, title, description, action }) {
  return <article className={`setup-item${complete ? " setup-item--complete" : ""}`}>
    <span className="setup-item__state"><AppIcon name={complete ? "check" : "clock"} size={18} /></span>
    <div><div className="setup-item__title"><strong>{title}</strong>{optional && <span>可选</span>}</div><p>{description}</p></div>
    {action}
  </article>;
}

export function ProgressBar({ value, max, label }) {
  const percentage = max ? Math.round((value / max) * 100) : 0;
  return <div className="progress-block"><div className="progress-block__label"><span>{label}</span><strong>{percentage}%</strong></div><div aria-label={label} aria-valuemax={max} aria-valuemin="0" aria-valuenow={value} className="progress-track" role="progressbar"><span style={{ width: `${percentage}%` }} /></div></div>;
}
