import type { ReactNode } from "react";

import { PlatformMark, type LogoPlatform } from "./platform-logos";

/**
 * The one page header of the app (redesign 2026-11-28): the title, one muted status line, the platforms the page reads,
 * and on the right the page's single primary action with any secondary ones. No banner, no icon tile, no section
 * colour. Styles: `.ui-ph*` in `styles/ui-system.css`. On a phone it is one line, the title and the primary action;
 * secondary buttons that have a visible label give way, icon-only ones (`.ui-btn--icon`) stay.
 */
export type PageHeaderProps = {
  /** The page's name, the only h1 on the page. */
  title: ReactNode;
  /** One short muted line: "Scanned 22 h ago · 13 checked". Keep it to one sentence. */
  status?: ReactNode;
  /** The platforms this page reads or posts to, drawn as their marks after the title. Each label is read aloud. */
  platforms?: { id: LogoPlatform; label: string }[];
  /** The page's one primary action, usually `<button className="ui-btn ui-btn--primary">`. */
  primary?: ReactNode;
  /** Secondary actions, drawn before the primary one: `ui-btn--ghost` buttons, or `ui-btn--icon` ones with a label. */
  actions?: ReactNode;
  /** A row under the header, such as `.ui-tabs` or filters. */
  children?: ReactNode;
  /** `h2` when the page already has an h1 (a drawer or a pane). */
  level?: "h1" | "h2";
  id?: string;
  className?: string;
  "data-testid"?: string;
};

export function PageHeader({ title, status, platforms, primary, actions, children, level = "h1", id, className, "data-testid": testId }: PageHeaderProps) {
  const Title = level;
  // A <div>, not <header>: outside a landmark a <header> is a second "banner", and the top bar must stay the only one.
  return (
    <div className={className ? `ui-ph ${className}` : "ui-ph"} data-testid={testId}>
      <div className="ui-ph__row">
        <div className="ui-ph__main">
          <div className="ui-ph__titleline">
            <Title className="ui-ph__title" id={id}>
              {title}
            </Title>
            {platforms?.length ? (
              <span className="ui-ph__platforms">
                {platforms.map((p) => (
                  <span key={p.id} role="img" aria-label={p.label} title={p.label} style={{ display: "inline-flex" }}>
                    <PlatformMark platform={p.id} size={14} />
                  </span>
                ))}
              </span>
            ) : null}
          </div>
          {status ? <p className="ui-ph__status">{status}</p> : null}
        </div>
        {actions || primary ? (
          <div className="ui-ph__actions">
            {actions ? <span className="ui-ph__secondary ui-row">{actions}</span> : null}
            {primary}
          </div>
        ) : null}
      </div>
      {children ? <div className="ui-ph__below">{children}</div> : null}
    </div>
  );
}
