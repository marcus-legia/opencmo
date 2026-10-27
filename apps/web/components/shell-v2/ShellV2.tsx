"use client";

/**
 * The v2 shell (NEXT_PUBLIC_OPENCMO_UI=v2): rail on desktop, tab bar on a phone.
 *
 * Same contract as `WebShell`: rendered by `app/app/layout.tsx`, so it lives across navigation and keeps one Realtime
 * channel for jobs, one toast and the account numbers. Pages call `useShellAccount()` under either shell. The editor
 * keeps today's shell and look; restyling it is a separate decision.
 */

import { useRouter, useSelectedLayoutSegment } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

import { api } from "@/components/clipping/api";
import { useActiveJobs } from "@/components/clipping/ActiveJobs";
import { Toast } from "@/components/clipping/ui";
import { ShellAccountContext, WebShell, type AccountSummary } from "@/components/clipping/web/WebShell";

import { isShown, type DepartmentName, type NavEntry } from "./nav";
import { Rail } from "./Rail";
import { ShellStateContext, type ShellState } from "./ShellState";
import { TabBar } from "./TabBar";
import { useScreensLive } from "./useScreensLive";

type Props = {
  credits?: number | null;
  plan?: string | null;
  email?: string | null;
  userId?: string | null;
  pending?: number | null;
  /** Production: hide every screen whose data is not live. */
  hideSample: boolean;
  children: ReactNode;
};

/** Segments that keep today's shell: the editor needs the whole width and keeps its current look. */
const CLASSIC: ReadonlySet<string> = new Set(["editor", "video"]);

export function ShellV2(props: Props) {
  const segment = useSelectedLayoutSegment();
  if (segment !== null && CLASSIC.has(segment)) {
    const { hideSample: _hideSample, ...account } = props;
    return <WebShell {...account} />;
  }
  return <V2Frame {...props} segment={segment} />;
}

function V2Frame({ credits, plan, email, userId, pending, hideSample, children, segment }: Props & { segment: string | null }) {
  const router = useRouter();
  const [account, setAccount] = useState({ credits: credits ?? null, plan: plan ?? null, pending: pending ?? null });
  // The Dashboard's queue, once it has reported one: it wins over the server count so every number on screen agrees.
  const [queue, setQueue] = useState<{ pending: number; stuck: DepartmentName[] } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const reading = useRef(false);

  const refreshAccount = useCallback(() => {
    if (reading.current) return;
    reading.current = true;
    void api<AccountSummary>("/account")
      .then((summary) => setAccount({ credits: summary.credits, plan: summary.plan, pending: summary.cmo_pending }))
      .catch(() => {
        // A hint in the frame only: keep the old numbers rather than cover the page's own errors.
      })
      .finally(() => {
        reading.current = false;
      });
  }, []);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") refreshAccount();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [refreshAccount]);

  // A client navigation from the editor (classic shell) lands here without the boot script running again.
  useEffect(() => {
    document.documentElement.dataset.ui = "v2";
  }, []);

  const { active, toast: jobToast, clearToast } = useActiveJobs(userId ?? null, refreshAccount);
  const live = useScreensLive();
  const entries = useCallback((list: NavEntry[]) => list.filter((entry) => isShown(entry, hideSample, live)), [hideSample, live]);

  const reportQueue = useCallback((count: number, stuck: DepartmentName[]) => {
    setQueue((was) => (was && was.pending === count && was.stuck.join() === stuck.join() ? was : { pending: count, stuck }));
  }, []);
  const state = useMemo<ShellState>(
    () => ({ pending: queue?.pending ?? account.pending, stuck: queue?.stuck ?? [], reportQueue, toast: setMessage }),
    [queue, account.pending, reportQueue],
  );

  const shown = message ?? jobToast?.text ?? null;
  const jobAction = useMemo(
    () => (!message && jobToast ? { label: "Open", onClick: () => router.push(`/app/projects/${jobToast.projectId}`) } : undefined),
    [message, jobToast, router],
  );

  return (
    <ShellAccountContext.Provider value={{ credits: account.credits, plan: account.plan, userId: userId ?? null, refreshAccount }}>
      <ShellStateContext.Provider value={state}>
        <div className="v2 v2-shell">
          <Rail
            segment={segment}
            entries={entries}
            pending={state.pending}
            stuck={state.stuck}
            processing={active.length}
            credits={account.credits}
            email={email ?? null}
          />
          <main className="v2-main">{children}</main>
          <TabBar segment={segment} entries={entries} pending={state.pending} credits={account.credits} />
        </div>
        <Toast
          message={shown}
          onDone={() => (message ? setMessage(null) : clearToast())}
          action={jobAction}
          tone={message ? "info" : jobToast?.tone}
        />
      </ShellStateContext.Provider>
    </ShellAccountContext.Provider>
  );
}
