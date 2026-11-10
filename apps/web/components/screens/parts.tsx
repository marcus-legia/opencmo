/**
 * Page-level pieces of Session C's screens that `components/ui/` (Session B, U1) does not have: the page
 * wrapper and header, filter pills, error and loading blocks. The primitives
 * themselves come from `@/components/ui`.
 */
import type { ReactNode } from "react";

import { Icon, type IconName } from "@/components/icons";
import { MonoLabel, SampleTag } from "@/components/ui";

import "./screens.css";

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

/** Page root inside the v2 shell: B's page padding, plus the `scr` scope of this folder's layout rules. */
export function Screen({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={cx("v2-page scr", className)} data-testid={`v2-${label.toLowerCase()}`}>
      {children}
    </div>
  );
}

export function PageHeader({
  eyebrow,
  numeral,
  title,
  sub,
  sample,
  actions,
}: {
  eyebrow: string;
  /** Department numeral (I–VI), drawn in brand-deep before the eyebrow. */
  numeral?: string;
  title: ReactNode;
  sub?: ReactNode;
  sample?: boolean;
  actions?: ReactNode;
}) {
  const icon = HEAD_ICON[eyebrow.toLowerCase()];
  return (
    <header className="scr-head td-head">
      {icon ? (
        <span className="td-head-tile" aria-hidden="true">
          <Icon name={icon} size={20} />
        </span>
      ) : null}
      <div className="scr-head-text">
        {/* The eyebrow only when it adds something: a page titled with the agent's name does not repeat it. */}
        {title !== eyebrow || sample ? (
          <span className="scr-eyebrow">
            {title === eyebrow ? null : numeral ? <span className="v2-numeral">{`${numeral} · ${eyebrow}`}</span> : <MonoLabel muted>{eyebrow}</MonoLabel>}
            {sample && <SampleTag />}
          </span>
        ) : null}
        <h1 className="v2-title scr-title">{title}</h1>
        {sub && <p className="scr-head-sub">{sub}</p>}
      </div>
      {actions && <div className="scr-head-actions">{actions}</div>}
    </header>
  );
}

/** The agent's tile on its page (canvas AgentSales.dc.html): the same Lucide icon as the rail. */
const HEAD_ICON: Record<string, IconName> = {
  writer: "pencil",
  studio: "film",
  schedule: "calendar",
  sales: "message-circle",
  library: "file-text",
  research: "search",
  analytics: "chart-column",
  brain: "sparkles",
  settings: "settings",
};

/** B's `Panel` now carries `sub`, `foot` and `white` itself; pages keep importing it from here. */
export { Panel } from "@/components/ui";

/** Filter chips that act as a one-of choice (platforms, insight types). */
export function Pills<T extends string>({
  label,
  options,
  value,
  onChange,
  plain,
}: {
  label: string;
  options: { id: T; label: ReactNode }[];
  value: T;
  onChange: (id: T) => void;
  plain?: boolean;
}) {
  return (
    <div role="group" aria-label={label} className="scr-pills">
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          className={cx("scr-pill", plain && "is-plain")}
          aria-pressed={option.id === value}
          onClick={() => onChange(option.id)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="scr-error">
      {children}
    </p>
  );
}

/** Loading state of a page: grey blocks, no spinner. */
export function SkeletonBlocks({ rows = 3 }: { rows?: number }) {
  return (
    <div className="scr-skeleton" role="status" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows + 1 }, (_, i) => (
        <span key={i} />
      ))}
    </div>
  );
}
