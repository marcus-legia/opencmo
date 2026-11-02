import Link from "next/link";
import type { ReactNode } from "react";

import { SampleTag } from "./SampleTag";

/**
 * A titled surface: header (title, optional sample tag, link or actions), an optional line under the title, a body
 * that owns its padding, and an optional foot.
 */
export function Panel({
  id,
  title,
  sub,
  mark,
  live,
  sample,
  link,
  actions,
  foot,
  white,
  children,
  className,
}: {
  id: string;
  title: ReactNode;
  /** One line under the title (the frames' grey subtitle). */
  sub?: ReactNode;
  mark?: boolean;
  live?: boolean;
  sample?: boolean;
  link?: { href: string; label: string };
  actions?: ReactNode;
  foot?: ReactNode;
  /** Card white instead of paper2 (Voice, Skills, a thread detail). */
  white?: boolean;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <section aria-labelledby={id} className={["v2-panel", white && "is-white", className].filter(Boolean).join(" ")}>
      <div className={sub ? "v2-panel-head has-sub" : "v2-panel-head"}>
        <h2 id={id} className="v2-panel-title">
          {mark ? <span className={`v2-mark${live ? " is-live" : ""}`} aria-hidden="true" /> : null}
          {title}
          {sample ? <SampleTag /> : null}
        </h2>
        {link ? (
          <Link className="v2-panel-link" href={link.href}>
            {link.label} →
          </Link>
        ) : null}
        {actions}
      </div>
      {sub ? <p className="v2-panel-sub">{sub}</p> : null}
      {children}
      {foot ? <div className="v2-panel-foot v2-muted">{foot}</div> : null}
    </section>
  );
}
