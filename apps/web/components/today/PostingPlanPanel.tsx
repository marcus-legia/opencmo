"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { ApiError, api, jsonBody } from "@/components/clipping/api";
import { TEXT_PLATFORMS, VIDEO_PLATFORMS, dayTargets, type PostingPlan } from "@/lib/cmo/posting-plan";
import type { ScheduleScreen } from "@/lib/screens/schedule";

import { PlatformLogo, type LogoPlatform } from "./platform-logos";

const TEXT_LABEL: Record<(typeof TEXT_PLATFORMS)[number], string> = { x: "X", threads: "Threads", linkedin: "LinkedIn", facebook: "Facebook Page" };
const VIDEO_LABEL: Record<(typeof VIDEO_PLATFORMS)[number], string> = { tiktok: "TikTok", instagram: "Instagram Reels", youtube: "YouTube Shorts" };
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
 * The planner (daily core drafts, owner 2026-11-12): posts and videos as two groups, one row per platform with its
 * logo and a stepper that reads "Off", "1 a day", "2 a week", saved on every change. The
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

  const posts = dayTargets(plan).length;
  const on = TEXT_PLATFORMS.filter((id) => plan.text[id] > 0).map((id) => TEXT_LABEL[id]);

  return (
    <section aria-label="Posting plan" id="posting-plan" data-testid="posting-plan" className="pp">
      <header className="pp-head">
        <div>
          <h2>Posting plan</h2>
          <p>Pick where you post and how often. Your CMO writes to this plan.</p>
        </div>
        <span className="pp-saved" data-live={live || undefined}>
          {live ? (
            <>
              <svg className="i s" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M20 6 9 17l-5-5" />
              </svg>
              Saved as you change it
            </>
          ) : (
            "Sample plan: changes stay on this page"
          )}
        </span>
      </header>

      <div className="pp-groups">
        <div className="pp-group" role="group" aria-labelledby="pp-posts">
          <div className="pp-group-head">
            <span className="pp-group-icon" aria-hidden="true">
              <svg className="i" viewBox="0 0 24 24">
                <path d="M12 20h9" />
                <path d="M16.4 3.6a2 2 0 0 1 2.9 2.9L7 18.8l-4 1 1-4Z" />
              </svg>
            </span>
            <div>
              <h3 id="pp-posts">Posts</h3>
              <p>Written for you every morning. One post goes to every platform you turn on.</p>
            </div>
          </div>
          {TEXT_PLATFORMS.map((id) => (
            <Row key={id} platform={id} name={TEXT_LABEL[id]} per="day" value={plan.text[id]} max={TEXT_MAX} connected={connected(id)} byHand onChange={(n) => set("text", id, n)} />
          ))}
        </div>

        <div className="pp-group" role="group" aria-labelledby="pp-videos">
          <div className="pp-group-head">
            <span className="pp-group-icon" aria-hidden="true">
              <svg className="i" viewBox="0 0 24 24">
                <path d="m16 13 5.2 3.5a.5.5 0 0 0 .8-.4V7.9a.5.5 0 0 0-.8-.5L16 10.5" />
                <rect x="2" y="6" width="14" height="12" rx="2" />
              </svg>
            </span>
            <div>
              <h3 id="pp-videos">Videos</h3>
              <p>You record them. Your CMO writes the script and the caption for each one.</p>
            </div>
          </div>
          {VIDEO_PLATFORMS.map((id) => (
            <Row key={id} platform={id} name={VIDEO_LABEL[id]} per="week" value={plan.video[id]} max={VIDEO_MAX} connected={connected(id)} onChange={(n) => set("video", id, n)} />
          ))}
        </div>
      </div>

      <div className="pp-sum">
        <svg className="i" viewBox="0 0 24 24" aria-hidden="true">
          <rect width="18" height="18" x="3" y="4" rx="2" />
          <path d="M16 2v4" />
          <path d="M8 2v4" />
          <path d="M3 10h18" />
        </svg>
        <p>
          <b data-testid="posting-plan-line">{planLine(plan)}</b>{" "}
          {posts > 0 ? <span>{posts === 1 ? "It goes" : "They go"} to {listOf(on)}.</span> : <span>Turn on a platform above to get a post every day.</span>}
        </p>
      </div>
      {error ? (
        <p role="alert" className="pp-error">
          {error}
        </p>
      ) : null}
    </section>
  );
}

/** "X", "X and Threads", "X, Threads and LinkedIn". */
const listOf = (names: string[]) => (names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`);

function Row({
  platform,
  name,
  per,
  value,
  max,
  connected,
  byHand = false,
  onChange,
}: {
  platform: LogoPlatform;
  name: string;
  per: "day" | "week";
  value: number;
  max: number;
  connected: boolean;
  /** A text platform without an account still gets its post, to copy and post by hand; a video platform does not post. */
  byHand?: boolean;
  onChange: (n: number) => void;
}) {
  const unit = per === "day" ? "posts a day" : "videos a week";
  const off = value === 0;
  return (
    <div className="pp-row" data-off={off || undefined}>
      <PlatformLogo platform={platform} dim={off} />
      <div className="pp-who">
        <span className="pp-name">{name}</span>
        {connected ? (
          <span className="pp-state is-on">
            <i aria-hidden="true"></i>Connected
          </span>
        ) : (
          <span className="pp-state">
            {off ? "Not connected." : byHand ? "Not connected: you get the post to copy and paste." : "Not connected: you post the video yourself."}{" "}
            <Link href="/app/settings#settings-connected-accounts">Connect</Link>
          </span>
        )}
      </div>
      <div className="pp-step">
        <button type="button" aria-label={`Fewer ${unit} on ${name}`} disabled={value <= 0} onClick={() => onChange(value - 1)}>
          <svg className="i s" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M5 12h14" />
          </svg>
        </button>
        <output aria-label={`${name}: ${unit}`}>{off ? "Off" : `${value} a ${per}`}</output>
        <button type="button" aria-label={`More ${unit} on ${name}`} disabled={value >= max} onClick={() => onChange(value + 1)}>
          <svg className="i s" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M5 12h14" />
            <path d="M12 5v14" />
          </svg>
        </button>
      </div>
    </div>
  );
}
