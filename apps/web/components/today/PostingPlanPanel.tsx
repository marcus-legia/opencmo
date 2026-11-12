"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { ApiError, api, jsonBody } from "@/components/clipping/api";
import { TEXT_PLATFORMS, VIDEO_PLATFORMS, dayTargets, type PostingPlan } from "@/lib/cmo/posting-plan";
import type { ScheduleScreen } from "@/lib/screens/schedule";

const TEXT_LABEL: Record<(typeof TEXT_PLATFORMS)[number], string> = { x: "X", threads: "Threads", linkedin: "LinkedIn", facebook: "Facebook Page" };
const VIDEO_LABEL: Record<(typeof VIDEO_PLATFORMS)[number], string> = { tiktok: "TikTok", instagram: "Instagram", youtube: "YouTube" };
const TEXT_MAX = 3;
const VIDEO_MAX = 7;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** What the plan costs the founder, in plain words: core posts a day (one post goes to each platform of its slot). */
export function planLine(plan: PostingPlan): string {
  const posts = dayTargets(plan).length;
  const scripts = VIDEO_PLATFORMS.reduce((n, p) => n + plan.video[p], 0);
  return `The CMO writes ${plural(posts, "post", "posts")} a day and ${plural(scripts, "video script", "video scripts")} a week.`;
}

/**
 * The planner (daily core drafts, owner 2026-11-12): one row per platform with a stepper, saved on every change. The
 * week plan builds its skeleton from it, and saving moves the posts still only planned to the new platforms. A sample
 * screen changes only on this page.
 */
export function PostingPlanPanel({ initial, accounts, live, onSaved }: { initial: PostingPlan; accounts: ScheduleScreen["accounts"]; live: boolean; onSaved?: () => void }) {
  const [plan, setPlan] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const saved = useRef(initial);
  const seq = useRef(0);
  // A reload of the screen brings the stored plan; a save in flight keeps what the founder just set.
  const initialKey = JSON.stringify(initial);
  useEffect(() => {
    if (seq.current === 0) {
      saved.current = JSON.parse(initialKey) as PostingPlan;
      setPlan(saved.current);
    }
  }, [initialKey]);

  const connected = (id: string) => accounts.some((a) => a.platform === id && a.status === "connected");

  async function save(next: PostingPlan) {
    setPlan(next);
    setError(null);
    if (!live) return;
    const mine = ++seq.current;
    try {
      const res = await api<{ plan: PostingPlan }>("/cmo/posting-plan", jsonBody(next, "PUT"));
      saved.current = res.plan;
      // Only the last click's answer is shown: an earlier one landing late must not undo it.
      if (mine === seq.current) {
        setPlan(res.plan);
        seq.current = 0;
        onSaved?.();
      }
    } catch (err) {
      if (mine === seq.current) {
        setPlan(saved.current);
        seq.current = 0;
        setError(err instanceof ApiError ? err.message : "Could not save your posting plan.");
      }
    }
  }

  const set = (kind: "text" | "video", id: string, n: number) =>
    void save({ ...plan, [kind]: { ...plan[kind], [id]: n } } as PostingPlan);

  return (
    <section
      aria-label="Posting plan"
      data-testid="posting-plan"
      style={{ border: "1px solid var(--line)", borderRadius: "10px", background: "var(--panel)", padding: "12px 14px", marginBottom: "14px" }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: "10px", flexWrap: "wrap", marginBottom: "8px" }}>
        <h2 style={{ margin: "0", fontSize: "15px", fontWeight: "600" }}>Posting plan</h2>
        <span className="meta">{live ? "Saved as you change it. The week plan follows it." : "Sample plan: changes stay on this page."}</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "4px 24px" }}>
        {TEXT_PLATFORMS.map((id) => (
          <Row key={id} name={TEXT_LABEL[id]} unit="posts a day" value={plan.text[id]} max={TEXT_MAX} connected={connected(id)} onChange={(n) => set("text", id, n)} />
        ))}
        {VIDEO_PLATFORMS.map((id) => (
          <Row key={id} name={VIDEO_LABEL[id]} unit="videos a week" value={plan.video[id]} max={VIDEO_MAX} connected={connected(id)} onChange={(n) => set("video", id, n)} />
        ))}
      </div>
      <p style={{ margin: "10px 0 0", fontSize: "13.5px", color: "var(--muted)" }} data-testid="posting-plan-line">
        {planLine(plan)}
      </p>
      {error ? (
        <p role="alert" style={{ margin: "6px 0 0", fontSize: "13px", color: "var(--warn)" }}>
          {error}
        </p>
      ) : null}
    </section>
  );
}

function Row({ name, unit, value, max, connected, onChange }: { name: string; unit: string; value: number; max: number; connected: boolean; onChange: (n: number) => void }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "8px", minHeight: "36px", borderBottom: "1px solid var(--line)" }}>
      <span style={{ fontWeight: "500", fontSize: "14px", whiteSpace: "nowrap" }}>{name}</span>
      {connected ? (
        <span className="meta">Connected</span>
      ) : (
        <Link href="/app/settings#settings-connected-accounts" className="meta" style={{ color: "var(--accent)" }}>
          Connect
        </Link>
      )}
      <div style={{ flex: "1 1 auto" }}></div>
      <button type="button" className="ib" aria-label={`Fewer ${unit} on ${name}`} disabled={value <= 0} onClick={() => onChange(value - 1)}>
        <svg className="i s" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M5 12h14" />
        </svg>
      </button>
      <output aria-label={`${name}: ${unit}`} style={{ minWidth: "18px", textAlign: "center", fontVariantNumeric: "tabular-nums", fontWeight: "600" }}>
        {value}
      </output>
      <button type="button" className="ib" aria-label={`More ${unit} on ${name}`} disabled={value >= max} onClick={() => onChange(value + 1)}>
        <svg className="i s" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M5 12h14" />
          <path d="M12 5v14" />
        </svg>
      </button>
      <span className="meta" style={{ minWidth: "88px" }}>
        {unit}
      </span>
    </div>
  );
}
