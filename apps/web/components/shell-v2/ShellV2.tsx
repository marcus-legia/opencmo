"use client";

/**
 * The v2 shell (NEXT_PUBLIC_OPENCMO_UI=v2), built to the "Ferreto Today" canvas (docs/design/today-canvas): no rail and
 * no tab strip. Each screen is one artboard: the root carries `k pg-<artboard>` so the artboard's own CSS
 * (`styles/today.css`) applies, the top bar is that artboard's, and the CMO chat is the right column on the feed and a
 * drawer everywhere else.
 *
 * Same contract as `WebShell`: rendered by `app/app/layout.tsx`, so it lives across navigation and keeps one Realtime
 * channel for jobs, one toast, the account numbers and the chat, which keeps its draft and session across screens: the
 * chat is always mounted at the same place in the tree, only its class changes.
 */

import { useRouter, useSelectedLayoutSegment } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

import { api } from "@/components/clipping/api";
import { FREE_USAGE, type PlanUsage } from "@/lib/billing/usage";
import { useActiveJobs } from "@/components/clipping/ActiveJobs";
import { Toast } from "@/components/clipping/ui";
import { ShellAccountContext, WebShell, type AccountSummary } from "@/components/clipping/web/WebShell";
import { ChatPanel, type ChatSource } from "@/components/cmo/workspace/ChatPanel";
import { studioItemHref } from "@/components/screens/studio/href";
import { useApplyTheme } from "@/components/theme";
import { CHAT, useTodayColumns } from "@/components/today/columns";
import { WorkspaceSide } from "@/components/today/WorkspaceSide";
import { LogsDrawer } from "@/components/today/LogsDrawer";
import { TopBar, type TopVariant } from "@/components/today/TopBar";
import { WorkspaceProvider } from "@/components/today/workspace";

import type { DepartmentName } from "./nav";
import { Sash } from "./Sash";
import { ShellStateContext, type ShellState } from "./ShellState";

type Props = {
  credits?: number | null;
  plan?: string | null;
  email?: string | null;
  userId?: string | null;
  pending?: number | null;
  usage?: PlanUsage;
  /** False when no CMO chat model is configured: the chat says so itself. */
  chatLive: boolean;
  /** Production: hide every screen whose data is not live. */
  hideSample: boolean;
  children: ReactNode;
};

/** Segments that keep today's shell. `video` only redirects to the editor. */
const CLASSIC: ReadonlySet<string> = new Set(["video"]);
/** The script prompter on the founder's phone, drawn without any frame. */
const PROMPTER = "script";

/**
 * `view`: one of the four views of the working screen (owner, 2026-11-12). They share one frame: the Context column on
 * the left and the CMO chat on the right stay mounted, and only the centre changes. The frame keeps the feed's scope
 * (`pg-main`) and the view's own artboard styles apply inside its `pg-<view>` wrapper.
 */
type Screen = { page: string; top: TopVariant | null; chat: "column" | "drawer" | "assistant"; legacy?: boolean; view?: string };

/** Which artboard each route is. Screens the canvas has no artboard for wear the agent page's frame. */
function screenFor(segment: string | null): Screen {
  switch (segment) {
    case null:
      return { page: "main", top: { kind: "home" }, chat: "column" };
    // Post's week view (the old Calendar tab, owner 2026-11-19: four tabs).
    case "schedule":
      return { page: "main", view: "calendar", top: { kind: "views", current: "post" }, chat: "column" };
    // The photo-post page is gone from the bar (B2B channels only, 2026-11-18); its route stays until wave 4 deletes it.
    case "photos":
      return { page: "main", view: "calendar", top: { kind: "views", current: "post" }, chat: "column" };
    case "analytics":
      return { page: "main", view: "analytics", top: { kind: "views", current: "analytics" }, chat: "column" };
    case "sales":
      return { page: "main", view: "agentsales", top: { kind: "views", current: "sales" }, chat: "column" };
    // Post's list view: the drafts and posts, with a List / Week switch.
    case "writer":
      return { page: "main", view: "agentwriter", top: { kind: "views", current: "post" }, chat: "column" };
    case "studio":
    case "projects":
    case "jobs":
      return { page: "projects", top: { kind: "crumbs", trail: [{ label: "Editor" }], credits: true, back: true }, chat: "drawer" };
    case "settings":
    case "billing":
      return { page: "main", view: "settings", top: { kind: "views", current: null }, chat: "column" };
    case "setup":
      // Setup draws its own header with the steps (Setup.dc.html).
      return { page: "setup", top: null, chat: "drawer" };
    case "editor":
      // The editor has its own top bar (Editor.dc.html); its Assistant takes the right column.
      return { page: "editor", top: null, chat: "assistant" };
    default: {
      return { page: "main", view: "agentsales", top: { kind: "views", current: null }, chat: "column", legacy: true };
    }
  }
}

export function ShellV2(props: Props) {
  const segment = useSelectedLayoutSegment();
  // THEME_BOOT sets `html[data-theme]` only on a full page load; a client navigation into /app (after sign-in, from the
  // landing page) needs the hook, or every artboard's dark tokens never apply and "System" ignores a dark Mac.
  useApplyTheme();
  if (segment !== null && CLASSIC.has(segment)) {
    const { hideSample: _hideSample, chatLive: _chatLive, usage: _usage, ...account } = props;
    return <WebShell {...account} />;
  }
  // The prompter fills the phone: no frame around it (cmo-review-3 I2).
  if (segment === PROMPTER) return <>{props.children}</>;
  return <TodayFrame {...props} segment={segment} />;
}

function TodayFrame({ credits, plan, email, userId, pending, usage, chatLive, children, segment }: Props & { segment: string | null }) {
  const router = useRouter();
  const [account, setAccount] = useState({ credits: credits ?? null, plan: plan ?? null, pending: pending ?? null, usage: usage ?? FREE_USAGE });
  // The feed's queue, once it has reported one: it wins over the server count so every number on screen agrees.
  const [queue, setQueue] = useState<{ pending: number; stuck: DepartmentName[] } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const reading = useRef(false);

  const refreshAccount = useCallback(() => {
    if (reading.current) return;
    reading.current = true;
    void api<AccountSummary>("/account")
      .then((summary) => setAccount((was) => ({ credits: summary.credits, plan: summary.plan, pending: summary.cmo_pending, usage: summary.usage ?? was.usage })))
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

  // A client navigation from the classic shell lands here without the boot script running again.
  useEffect(() => {
    document.documentElement.dataset.ui = "v2";
  }, []);

  const { active, toast: jobToast, clearToast } = useActiveJobs(userId ?? null, refreshAccount);

  const reportQueue = useCallback((count: number, stuck: DepartmentName[]) => {
    setQueue((was) => (was && was.pending === count && was.stuck.join() === stuck.join() ? was : { pending: count, stuck }));
  }, []);

  const screen = screenFor(segment);
  const [chatOpen, setChatOpen] = useState(false);
  // Off the Feed the chat column starts folded to the "Ask" rail (wave 2, owner 2026-11-19): the view gets the width.
  // Folding only hides the panel, so its draft and session survive.
  const foldsByDefault = screen.chat === "column" && segment !== null;
  const [chatFolded, setChatFolded] = useState(foldsByDefault);
  const folded = foldsByDefault && chatFolded;
  const [logsOpen, setLogsOpen] = useState(false);
  const chatColumn = useRef<HTMLElement>(null);
  const focusChat = useCallback(() => {
    setLogsOpen(false);
    setChatOpen(true);
    setChatFolded(false);
    // After the drawer (if any) is shown: a hidden textarea cannot take focus.
    requestAnimationFrame(() =>
      [...(chatColumn.current?.querySelectorAll<HTMLTextAreaElement>("textarea") ?? [])].find((area) => area.offsetParent !== null)?.focus(),
    );
  }, []);
  const openLogs = useCallback(() => {
    setChatOpen(false);
    setLogsOpen(true);
  }, []);
  const closeLogs = useCallback(() => setLogsOpen(false), []);
  const [workVersion, setWorkVersion] = useState(0);
  const workChanged = useCallback(() => setWorkVersion((n) => n + 1), []);
  const chatWidth = useTodayColumns();
  const [clipAssistantSlot, setClipAssistantSlot] = useState<HTMLElement | null>(null);

  // A new screen closes the chat drawer and the logs, unless the chat itself moved there (it opens Writer when a draft
  // is ready, or the screen a request is about): the founder is mid-conversation, and on that screen the chat is a
  // drawer, so it stays open instead of vanishing with the answer.
  const shown = useRef(segment);
  // The path the chat itself last opened: landing there keeps the drawer open; any other screen closes it as usual.
  const chatTarget = useRef<string | null>(null);
  const onChatOpensPanel = useCallback((path: string) => {
    chatTarget.current = path;
  }, []);
  useEffect(() => {
    if (shown.current === segment) return;
    shown.current = segment;
    const chatMovedHere = chatTarget.current === window.location.pathname;
    setChatOpen(chatMovedHere && screen.chat === "drawer");
    // The chat that opened this screen stays open beside it; any other arrival folds it again.
    setChatFolded(!chatMovedHere);
    chatTarget.current = null;
    setLogsOpen(false);
  }, [segment, screen.chat]);

  // `?logs=1` (Billing's "Open Logs") opens the drawer over the screen it lands on, then drops the flag.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("logs") !== "1") return;
    setLogsOpen(true);
    url.searchParams.delete("logs");
    window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
  }, [segment]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setChatOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const chatSource = useMemo<ChatSource>(() => ({ live: { chat: chatLive }, chat: [], chatTitle: null, demo: false }), [chatLive]);

  const state = useMemo<ShellState>(
    () => ({
      pending: queue?.pending ?? account.pending,
      stuck: queue?.stuck ?? [],
      reportQueue,
      toast: setMessage,
      focusChat,
      openLogs,
      workVersion,
      workChanged,
      clipAssistantSlot,
      usage: account.usage,
    }),
    [queue, account.pending, reportQueue, focusChat, openLogs, workVersion, workChanged, clipAssistantSlot, account.usage],
  );

  const toastText = message ?? jobToast?.text ?? null;
  const jobAction = useMemo(
    () => (!message && jobToast ? { label: "Open", onClick: () => router.push(studioItemHref(jobToast.projectId)) } : undefined),
    [message, jobToast, router],
  );

  const chatClass = screen.chat === "column" ? "chat td-chat" : screen.chat === "assistant" ? "td-assistant" : "td-chat td-chatdrawer";

  return (
    <ShellAccountContext.Provider value={{ credits: account.credits, plan: account.plan, userId: userId ?? null, refreshAccount }}>
      <ShellStateContext.Provider value={state}>
        <WorkspaceProvider>
          <div className={`k pg-${screen.page} td-frame`} data-chat={chatOpen ? "open" : undefined} data-screen={screen.page}>
            {screen.top ? (
              <TopBar variant={screen.top} usage={account.usage} email={email ?? null} logsOpen={logsOpen} onLogs={openLogs} onChat={focusChat} />
            ) : null}
            <div className={screen.chat === "column" ? "cols" : "td-body"}>
              {screen.chat === "column" ? <WorkspaceSide /> : null}
              {screen.view ? (
                <div className="mid td-view" data-view={screen.view}>
                  <div className={`k pg-${screen.view}`}>{screen.legacy ? <div className="v2 td-legacy td-cardhost td-v2host">{children}</div> : children}</div>
                </div>
              ) : (
                children
              )}
              {screen.chat === "column" && !folded ? (
                <Sash
                  label="Resize the chat"
                  controls="v2-chat"
                  value={chatWidth.columns.chat}
                  min={CHAT.min}
                  max={CHAT.max}
                  invert
                  onLive={(value) => chatWidth.live("chat", value)}
                  onCommit={(value) => chatWidth.commit("chat", value)}
                  onReset={() => chatWidth.commit("chat", CHAT.base)}
                />
              ) : null}
              <aside className={chatClass} id="v2-chat" aria-label={screen.chat === "assistant" ? "Assistant" : "Chat with your CMO"} data-clip={screen.chat === "assistant" ? "" : undefined} data-folded={folded ? "" : undefined} ref={chatColumn}>
                {folded ? (
                  <button type="button" className="td-askrail" aria-label="Open the chat" aria-expanded="false" aria-controls="v2-chat-panel" onClick={focusChat}>
                    <svg className="i s" viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                    </svg>
                    <span>Ask</span>
                  </button>
                ) : null}
                {foldsByDefault && !folded ? (
                  <button type="button" className="ib td-chat-close" aria-label="Fold the chat" aria-expanded="true" aria-controls="v2-chat-panel" onClick={() => setChatFolded(true)}>
                    <svg className="i s" viewBox="0 0 24 24" aria-hidden="true">
                      <path d="m13 17 5-5-5-5" />
                      <path d="m6 17 5-5-5-5" />
                    </svg>
                  </button>
                ) : null}
                {screen.chat === "drawer" ? (
                  <button type="button" className="ib td-chat-close" aria-label="Close the chat" onClick={() => setChatOpen(false)}>
                    <svg className="i s" viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M18 6 6 18" />
                      <path d="m6 6 12 12" />
                    </svg>
                  </button>
                ) : null}
                {/* Hidden, not unmounted, in the editor: the CMO chat keeps its draft for the way back. */}
                <div className="td-chatpanel" id="v2-chat-panel" hidden={folded}>
                  <ChatPanel ws={chatSource} onToast={setMessage} onWorkStarted={() => setWorkVersion((n) => n + 1)} drivesPanel onOpenPanel={onChatOpensPanel} />
                </div>
                {screen.chat === "assistant" ? <div className="v2-clip-slot" ref={setClipAssistantSlot} /> : null}
              </aside>
            </div>
            {chatOpen && screen.chat === "drawer" ? <div className="td-scrim" aria-hidden="true" onClick={() => setChatOpen(false)} /> : null}
            {logsOpen ? <LogsDrawer onClose={closeLogs} running={active.length} /> : null}
          </div>
        </WorkspaceProvider>
        <Toast message={toastText} onDone={() => (message ? setMessage(null) : clearToast())} action={jobAction} tone={message ? "info" : jobToast?.tone} />
      </ShellStateContext.Provider>
    </ShellAccountContext.Provider>
  );
}
