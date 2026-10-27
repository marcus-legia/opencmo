"use client";

import { useState } from "react";

import { Tabs } from "@/components/ui";

import { DEPARTMENT_LABEL, PLATFORM_LABEL, formatSeconds, type CardBody, type Platform } from "./model";

type Body<K extends CardBody["kind"]> = Extract<CardBody, { kind: K }>;

/** Post: one tab per platform, the chosen version, the checks it passed and why it was written. */
export function PostBody({
  body,
  cardId,
  editing,
  draft,
  onDraft,
  onPick,
}: {
  body: Body<"post">;
  cardId: string;
  editing: boolean;
  draft: string;
  onDraft: (text: string) => void;
  /** Reports the text on screen, so Approve sends what the founder saw. */
  onPick: (text: string) => void;
}) {
  const [platform, setPlatform] = useState<Platform>(body.versions[0]?.platform ?? "x");
  const [version, setVersion] = useState(0);
  const current = body.versions.find((v) => v.platform === platform) ?? body.versions[0];
  const texts = current?.texts ?? [];
  const text = texts[Math.min(version, texts.length - 1)] ?? "";

  function pick(nextPlatform: Platform, nextVersion: number) {
    setPlatform(nextPlatform);
    setVersion(nextVersion);
    const list = body.versions.find((v) => v.platform === nextPlatform)?.texts ?? [];
    onPick(list[Math.min(nextVersion, list.length - 1)] ?? "");
  }

  return (
    <>
      {body.versions.length > 1 ? (
        <Tabs
          label="Platform"
          idBase={`${cardId}-platform`}
          value={platform}
          onChange={(p) => pick(p, 0)}
          items={body.versions.map((v) => ({ id: v.platform, label: PLATFORM_LABEL[v.platform] }))}
        />
      ) : null}
      <div id={`${cardId}-platform-panel`} role={body.versions.length > 1 ? "tabpanel" : undefined} aria-labelledby={body.versions.length > 1 ? `${cardId}-platform-${platform}` : undefined}>
        {editing ? (
          <label className="v2-field">
            <span>Edit before you approve</span>
            <textarea className="v2-input" value={draft} maxLength={4000} onChange={(event) => onDraft(event.target.value)} />
          </label>
        ) : (
          <p className="v2-card-text">{text}</p>
        )}
      </div>
      {body.checks.length > 0 ? (
        <div className="v2-card-chips">
          {body.checks.map((check) => (
            <span key={check} className="v2-chip is-posted">
              {check}
            </span>
          ))}
        </div>
      ) : null}
      <div className="v2-card-meta">
        {texts.length > 1 ? (
          <span className="v2-card-versions">
            Version {Math.min(version, texts.length - 1) + 1} of {texts.length}
            <button type="button" className="v2-card-link" disabled={editing} onClick={() => pick(platform, (version + 1) % texts.length)}>
              Next version
            </button>
          </span>
        ) : null}
        {body.why ? <span>Why: {body.why}</span> : null}
      </div>
    </>
  );
}

export function ReplyBody({ body }: { body: Body<"reply"> }) {
  return (
    <>
      <p className="v2-card-strong">
        {body.community} · “{body.threadTitle}”
      </p>
      {body.quote ? <blockquote className="v2-card-quote">“{body.quote}”</blockquote> : null}
      {body.parts.length > 0 ? (
        <dl className="v2-card-scores" style={{ gridTemplateColumns: `repeat(${Math.min(4, body.parts.length)}, minmax(0, 1fr))` }}>
          {body.parts.map((part) => (
            <div key={part.label}>
              <dt>{part.label}</dt>
              <dd className="v2-num">
                {part.score}/{part.max}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      <div className="v2-card-draft">{body.draft}</div>
      <div className="v2-card-meta">Rules: {body.rules}</div>
    </>
  );
}

export function GoalBody({ body }: { body: Body<"goal"> }) {
  return (
    <>
      <p className="v2-card-goal">{body.goal}</p>
      <ul className="v2-card-plan">
        {body.plan.map((line) => (
          <li key={line.what}>
            <span>{line.what}</span>
            <span className="v2-muted">{DEPARTMENT_LABEL[line.department]}</span>
          </li>
        ))}
      </ul>
      {body.target ? <div className="v2-card-meta">Target: {body.target}</div> : null}
    </>
  );
}

export function ScriptBody({ body }: { body: Body<"script"> }) {
  return (
    <ol className="v2-card-beats">
      {body.beats.map((beat, index) => (
        <li key={index}>
          <b className="v2-card-beat-n">{String(index + 1).padStart(2, "0")}</b>
          <span>
            <b>“{beat.say}”</b> {beat.picture}
          </span>
        </li>
      ))}
    </ol>
  );
}

export function PriceBody({ body, price }: { body: Body<"price">; price: number | null }) {
  return (
    <>
      <div className="v2-card-frames" aria-hidden="true">
        {Array.from({ length: Math.min(8, Math.max(1, body.shots)) }, (_, index) => (
          <span key={index} className={index % 3 === 0 ? "is-light" : undefined} />
        ))}
      </div>
      <div className="v2-card-price">
        <span className="v2-muted">
          {formatSeconds(body.lengthSeconds)} · ready in about {body.readyMinutes} min
        </span>
        <b className="v2-num">{price === null ? "–" : `${price} cr`}</b>
      </div>
    </>
  );
}

export function FinishedVideoBody({ body }: { body: Body<"finished_video"> }) {
  return (
    <>
      <div className="v2-card-player">
        {body.posterUrl ? <img src={body.posterUrl} alt="" /> : null}
        <span className="v2-card-play" aria-hidden="true">
          <svg width="20" height="20" viewBox="0 0 24 24">
            <path d="M8 5l11 7-11 7z" fill="currentColor" />
          </svg>
        </span>
      </div>
      <div className="v2-card-meta">Approving marks it finished: Shorts can be cut from it</div>
    </>
  );
}

export function ShortsBody({ body }: { body: Body<"shorts_batch"> }) {
  return (
    <ul className="v2-card-shorts">
      {body.shorts.map((short) => (
        <li key={`${short.from}-${short.to}`}>
          <span className="v2-card-poster" aria-hidden="true" />
          <span>
            <b>
              {formatSeconds(short.from)}–{formatSeconds(short.to)}
            </b>
            <br />
            <span className="v2-muted">Hook: “{short.hook}”</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

export function SlideshowBody({
  body,
  cardId,
  firstSlide,
  onFirstSlide,
}: {
  body: Body<"slideshow">;
  cardId: string;
  firstSlide: string;
  onFirstSlide: (text: string) => void;
}) {
  return (
    <>
      <ul className="v2-card-slides">
        {body.slides.slice(0, 3).map((slide, index) => (
          <li key={index} className={index === 0 ? "is-cover" : undefined}>
            {index === 0 ? firstSlide : slide}
          </li>
        ))}
      </ul>
      <label className="v2-field" htmlFor={`${cardId}-slide1`}>
        Slide 1 text
        <input id={`${cardId}-slide1`} className="v2-input is-compact" value={firstSlide} maxLength={120} onChange={(event) => onFirstSlide(event.target.value)} />
      </label>
    </>
  );
}

export function ScheduleBody({ body }: { body: Body<"schedule"> }) {
  return (
    <>
      <p className="v2-card-strong">{body.item}</p>
      <dl className="v2-card-facts">
        <div>
          <dt>Where</dt>
          <dd>{body.where}</dd>
        </div>
        <div>
          <dt>When (your time)</dt>
          <dd className="v2-num">{body.when}</dd>
        </div>
      </dl>
      {body.why ? <div className="v2-card-meta">Why: {body.why}</div> : null}
    </>
  );
}

export function CorrectionBody({
  body,
  editing,
  draft,
  onDraft,
}: {
  body: Body<"correction">;
  editing: boolean;
  draft: string;
  onDraft: (text: string) => void;
}) {
  return (
    <>
      {editing ? (
        <label className="v2-field">
          <span>The rule, in your words</span>
          <input className="v2-input" value={draft} maxLength={200} onChange={(event) => onDraft(event.target.value)} />
        </label>
      ) : (
        <p className="v2-card-rule">“{body.rule}”</p>
      )}
      <ul className="v2-card-edits">
        {body.edits.map((edit, index) => (
          <li key={index}>
            <s className="v2-muted">{edit.before}</s> → {edit.after}
          </li>
        ))}
      </ul>
    </>
  );
}
