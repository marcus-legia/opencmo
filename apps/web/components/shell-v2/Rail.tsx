"use client";

import Link from "next/link";

import { Logo } from "./Logo";
import { NAV_DEPARTMENTS, NAV_MAIN, NAV_MAKE, NAV_SETTINGS, isCurrent, type DepartmentName, type NavEntry } from "./nav";

export type RailProps = {
  segment: string | null;
  entries: (entries: NavEntry[]) => NavEntry[];
  pending: number | null;
  stuck: DepartmentName[];
  /** Uploads being processed: shown on Studio, where they land. */
  processing: number;
  credits: number | null;
  email: string | null;
};

function RailLink({ entry, segment, children }: { entry: NavEntry; segment: string | null; children?: React.ReactNode }) {
  return (
    <Link href={entry.href} className="v2-rail-item" aria-current={isCurrent(entry, segment) ? "page" : undefined}>
      <span className="v2-rail-label">{entry.label}</span>
      {children}
    </Link>
  );
}

export function Rail({ segment, entries, pending, stuck, processing, credits, email }: RailProps) {
  const departments = entries(NAV_DEPARTMENTS);
  return (
    <nav aria-label="Main" className="v2-rail">
      <Link href="/app" className="v2-rail-brand">
        <Logo />
        <span>OpenCMO</span>
      </Link>

      <div className="v2-rail-group">
        {entries(NAV_MAIN).map((entry) => (
          <RailLink key={entry.href} entry={entry} segment={segment}>
            {entry.screen === "dashboard" && pending ? (
              <span className="v2-rail-count" aria-label={`${pending} waiting on you`}>
                {pending}
              </span>
            ) : null}
          </RailLink>
        ))}
      </div>

      {departments.length > 0 ? (
        <div className="v2-rail-group">
          <span className="v2-rail-heading">Departments</span>
          {departments.map((entry) => (
            <RailLink key={entry.href} entry={entry} segment={segment}>
              {entry.department && stuck.includes(entry.department) ? <span className="v2-rail-stuck" role="img" aria-label="Needs attention" /> : null}
              {entry.department === "studio" && processing > 0 ? (
                <span className="v2-rail-processing" aria-label={`${processing} processing`}>
                  {processing}
                </span>
              ) : null}
            </RailLink>
          ))}
        </div>
      ) : null}

      <div className="v2-rail-group">
        <span className="v2-rail-heading">Make</span>
        {NAV_MAKE.map((entry) => (
          <RailLink key={entry.href} entry={entry} segment={segment} />
        ))}
      </div>

      <div className="v2-rail-group v2-rail-foot">
        <RailLink entry={NAV_SETTINGS} segment={segment} />
        <Link href="/app/billing" className="v2-rail-credits" aria-label={credits === null ? "Credits" : `${credits} credits left`}>
          <span className="v2-mono is-small is-muted">Credits</span>
          <span className="v2-rail-credits-value">{credits ?? "–"}</span>
        </Link>
        <details className="v2-rail-account">
          <summary>
            <span className="v2-rail-email">{email ?? "Signed in"}</span>
          </summary>
          <form action="/auth/signout" method="post">
            <button type="submit" className="v2-button is-quiet is-compact">Sign out</button>
          </form>
        </details>
      </div>
    </nav>
  );
}
