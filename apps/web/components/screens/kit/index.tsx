/**
 * Local primitives for Session C's pages until Session B's `components/ui/` lands (sessions file,
 * rule 8). Same names and props as the U1 list, so the swap is an import change.
 */
import type { ButtonHTMLAttributes, ReactNode } from "react";

import "./screens.css";

type Classy = { className?: string };

function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

/** Page root: v2 tokens and the frame's padding. */
export function Screen({ label, children, className }: { label: string; children: ReactNode } & Classy) {
  return (
    <div className={cx("scr", className)} aria-label={label} data-screen={label.toLowerCase()}>
      {children}
    </div>
  );
}

export function MonoLabel({
  children,
  small,
  brand,
  as: Tag = "span",
  className,
}: { children: ReactNode; small?: boolean; brand?: boolean; as?: "span" | "h2" | "h3" | "p" } & Classy) {
  return <Tag className={cx("scr-mono", small && "is-small", brand && "is-brand", className)}>{children}</Tag>;
}

/** Shown next to the eyebrow while a screen's `live` flag is false. */
export function SampleTag() {
  return <span className="scr-sample">Sample data</span>;
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
          <MonoLabel brand={!!numeral}>{numeral ? `${numeral} · ${eyebrow}` : eyebrow}</MonoLabel>
          {sample && <SampleTag />}
        </span>
        <h1>{title}</h1>
        {sub && <p className="scr-head-sub">{sub}</p>}
      </div>
      {actions && <div className="scr-head-actions">{actions}</div>}
    </header>
  );
}

export type ButtonVariant = "primary" | "secondary" | "quiet" | "danger" | "dark" | "ghost";

export function Button({
  variant = "secondary",
  small,
  className,
  type = "button",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; small?: boolean }) {
  return <button type={type} className={cx("scr-btn", `is-${variant}`, small && "is-small", className)} {...rest} />;
}

/** A link styled as a button (navigation stays a real link). */
export function LinkButton({
  href,
  variant = "secondary",
  small,
  children,
  external,
}: { href: string; variant?: ButtonVariant; small?: boolean; children: ReactNode; external?: boolean }) {
  return (
    <a
      href={href}
      className={cx("scr-btn", `is-${variant}`, small && "is-small")}
      {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
    >
      {children}
    </a>
  );
}

export type ChipTone = "running" | "waiting" | "stuck" | "posted" | "scheduled" | "idle";

export function Chip({ tone = "idle", children }: { tone?: ChipTone; children: ReactNode }) {
  return <span className={cx("scr-chip", `is-${tone}`)}>{children}</span>;
}

export function Tabs<T extends string>({
  label,
  tabs,
  value,
  onChange,
}: {
  label: string;
  tabs: { id: T; label: string }[];
  value: T;
  onChange: (id: T) => void;
}) {
  return (
    <div role="tablist" aria-label={label} className="scr-tabs">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          id={`tab-${tab.id}`}
          aria-selected={tab.id === value}
          className="scr-tab"
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { id: T; label: string }[];
  value: T;
  onChange: (id: T) => void;
}) {
  return (
    <div role="group" aria-label={label} className="scr-seg">
      {options.map((option) => (
        <button key={option.id} type="button" aria-pressed={option.id === value} onClick={() => onChange(option.id)}>
          {option.label}
        </button>
      ))}
    </div>
  );
}

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

export function Panel({
  title,
  sub,
  aside,
  tone,
  children,
  foot,
  className,
  as: Tag = "section",
}: {
  title?: ReactNode;
  sub?: ReactNode;
  aside?: ReactNode;
  tone?: "white" | "dark";
  children?: ReactNode;
  foot?: ReactNode;
  as?: "section" | "div" | "aside" | "article";
} & Classy) {
  return (
    <Tag className={cx("scr-panel", tone && `is-${tone}`, className)}>
      {(title || aside) && (
        <div className="scr-panel-head">
          <div>
            {title && <MonoLabel as="h2">{title}</MonoLabel>}
            {sub && <span className="scr-small scr-muted">{sub}</span>}
          </div>
          {aside}
        </div>
      )}
      {children}
      {foot && <div className="scr-panel-foot">{foot}</div>}
    </Tag>
  );
}

export function Kpi({
  label,
  value,
  note,
  trend,
}: {
  label: string;
  value: string;
  note?: string;
  trend?: "up" | "down";
}) {
  return (
    <div className="scr-kpi">
      <MonoLabel small>{label}</MonoLabel>
      <b>{value}</b>
      {note && <small className={trend ? `is-${trend}` : undefined}>{note}</small>}
    </div>
  );
}

export function Toggle({
  checked,
  label,
  disabled,
  onChange,
}: {
  checked: boolean;
  label: string;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      className="scr-toggle"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    />
  );
}

export function EmptyState({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="scr-empty">
      <p>{children}</p>
      {action}
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

export { cx };
