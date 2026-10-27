/**
 * Page-level pieces of Session C's screens that `components/ui/` (Session B, U1) does not have: the page
 * wrapper and header, filter pills, a panel subtitle and foot, error and loading blocks. The primitives
 * themselves come from `@/components/ui`.
 */
import type { ReactNode } from "react";

import { MonoLabel, Panel as UiPanel, SampleTag } from "@/components/ui";

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
  return (
    <header className="scr-head">
      <div className="scr-head-text">
        <span className="scr-eyebrow">
          {numeral ? <span className="v2-numeral">{`${numeral} · ${eyebrow}`.toUpperCase()}</span> : <MonoLabel muted>{eyebrow}</MonoLabel>}
          {sample && <SampleTag />}
        </span>
        <h1 className="v2-title scr-title">{title}</h1>
        {sub && <p className="scr-head-sub">{sub}</p>}
      </div>
      {actions && <div className="scr-head-actions">{actions}</div>}
    </header>
  );
}

/**
 * B's `Panel` with what the frames add on some panels: a line under the title (`sub`) and a foot. Asked of B in
 * the sessions file's Requests; until then the extras render as the panel's first and last children.
 */
export function Panel({
  id,
  title,
  sub,
  sample,
  actions,
  foot,
  white,
  className,
  children,
}: {
  id: string;
  title: ReactNode;
  sub?: ReactNode;
  sample?: boolean;
  actions?: ReactNode;
  foot?: ReactNode;
  /** Card white instead of paper2 (Voice, Skills, the thread detail). */
  white?: boolean;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <UiPanel id={id} title={title} sample={sample} actions={actions} className={cx(white && "scr-white", className)}>
      {sub ? <p className="scr-panel-sub">{sub}</p> : null}
      {children}
      {foot ? <div className="v2-panel-foot v2-muted">{foot}</div> : null}
    </UiPanel>
  );
}

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
    <div className="scr-skeleton" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows + 1 }, (_, i) => (
        <span key={i} />
      ))}
    </div>
  );
}
