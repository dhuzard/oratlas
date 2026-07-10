import { type ReactNode } from "react";

export function Card({
  title,
  children,
  as: Tag = "section",
  className = "",
}: {
  title?: ReactNode;
  children: ReactNode;
  as?: "section" | "article" | "div";
  className?: string;
}) {
  return (
    <Tag className={`card ${className}`}>
      {title ? <h2 className="card-title">{title}</h2> : null}
      {children}
    </Tag>
  );
}

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: string }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function CompatibilityBadge({ level }: { level: string }) {
  const tone =
    level === "verified-template"
      ? "success"
      : level === "compatible"
        ? "success"
        : level === "partially-compatible"
          ? "warning"
          : level === "inspection-failed"
            ? "error"
            : "neutral";
  return <Badge tone={tone}>{level.replace(/-/g, " ")}</Badge>;
}

export function StatusPill({ status }: { status: string }) {
  return <span className={`status-pill status-${status}`}>{status.replace(/-/g, " ")}</span>;
}

export function DefinitionList({ items }: { items: Array<{ term: string; value: ReactNode }> }) {
  return (
    <dl className="def-list">
      {items.map((item) => (
        <div className="def-row" key={item.term}>
          <dt>{item.term}</dt>
          <dd>{item.value || <span className="muted">—</span>}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Notice({
  tone = "info",
  title,
  children,
}: {
  tone?: "info" | "warning" | "error" | "success";
  title?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className={`notice notice-${tone}`} role={tone === "error" ? "alert" : "note"}>
      {title ? <strong className="notice-title">{title}</strong> : null}
      <div>{children}</div>
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="empty-state">{children}</div>;
}
