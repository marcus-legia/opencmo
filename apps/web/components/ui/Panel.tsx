import Link from "next/link";
import type { ReactNode } from "react";

import { SampleTag } from "./SampleTag";

/** A titled surface: header (title, optional sample tag, link or actions) and a body that owns its padding. */
export function Panel({
  id,
  title,
  mark,
  live,
  sample,
  link,
  actions,
  children,
  className,
}: {
  id: string;
  title: ReactNode;
  mark?: boolean;
  live?: boolean;
  sample?: boolean;
  link?: { href: string; label: string };
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section aria-labelledby={id} className={["v2-panel", className].filter(Boolean).join(" ")}>
      <div className="v2-panel-head">
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
      {children}
    </section>
  );
}
