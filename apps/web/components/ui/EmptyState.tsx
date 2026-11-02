import type { ReactNode } from "react";

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="v2-empty">
      <b className="v2-empty-title">{title}</b>
      {children ? <span className="v2-empty-text">{children}</span> : null}
      {action ? <div className="v2-actions">{action}</div> : null}
    </div>
  );
}
