import type { CSSProperties } from "react";

import type { Block, BlockOf, Segment } from "@/lib/blog-blocks";

import { BlogCta } from "./BlogCta";
import { SceneBlock } from "./SceneBlock";

/**
 * Renders a post: HTML runs from the file, and visual blocks as components. Block
 * fields are plain text that React escapes, so a post cannot add markup through them.
 */
export function PostBody({ segments }: { segments: Segment[] }) {
  return (
    <div className="blog-prose blog-article-body">
      {withInlineCta(segments).map((s, i) =>
        s.kind === "cta" ? <BlogCta key={i} variant="inline" />
          : s.kind === "html" ? <div key={i} className="blog-run" dangerouslySetInnerHTML={{ __html: s.html }} />
          : <BlockView key={i} block={s.block} />,
      )}
    </div>
  );
}

/**
 * Places the mid-post CTA right before the middle H2: the reader has had half a lesson,
 * and a section break is where an aside doesn't cut a thought in two.
 */
function withInlineCta(segments: Segment[]): (Segment | { kind: "cta" })[] {
  const total = segments.reduce((n, s) => n + (s.kind === "html" ? (s.html.match(/<h2\b/g)?.length ?? 0) : 0), 0);
  if (total < 3) return segments;
  let target = Math.floor(total / 2) + 1;
  const out: (Segment | { kind: "cta" })[] = [];
  for (const s of segments) {
    const here = s.kind === "html" ? [...s.html.matchAll(/<h2\b/g)] : [];
    if (s.kind === "html" && target > 0 && target <= here.length) {
      const at = here[target - 1].index!;
      if (at > 0) out.push({ kind: "html", html: s.html.slice(0, at) });
      out.push({ kind: "cta" }, { kind: "html", html: s.html.slice(at) });
      target = 0;
    } else {
      target -= here.length;
      out.push(s);
    }
  }
  return out;
}

function BlockView({ block }: { block: Block }) {
  switch (block.type) {
    case "stats": return <Stats block={block} />;
    case "chart": return <Chart block={block} />;
    case "leaderboard": return <Leaderboard block={block} />;
    case "storyboard": return <Storyboard block={block} />;
    case "callout": return <Callout block={block} />;
    case "compare": return <Compare block={block} />;
    case "scene": return <SceneBlock block={block} />;
  }
}

function Evidence({ block }: { block: { source?: { label: string; url: string }; illustrative?: boolean } }) {
  if (block.illustrative) return <p className="bk-evidence is-example">Illustrative example, not measured data</p>;
  if (!block.source) return null;
  return (
    <p className="bk-evidence">
      Source: <a href={block.source.url} rel="noopener nofollow" target="_blank">{block.source.label}</a>
    </p>
  );
}

const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 1 });

function Stats({ block }: { block: BlockOf<"stats"> }) {
  return (
    <figure className="bk bk-stats">
      {block.title && <figcaption className="bk-title">{block.title}</figcaption>}
      <dl style={{ "--bk-cols": block.items.length } as CSSProperties}>
        {block.items.map((item) => (
          <div key={item.label}>
            <dt>{item.label}</dt>
            <dd>{item.value}</dd>
          </div>
        ))}
      </dl>
      <Evidence block={block} />
    </figure>
  );
}

function Chart({ block }: { block: BlockOf<"chart"> }) {
  const max = Math.max(...block.data.map((d) => d.value)) || 1;
  const unit = block.unit ? ` ${block.unit}` : "";
  return (
    <figure className={`bk bk-chart is-${block.kind}`}>
      <figcaption className="bk-title">{block.title}</figcaption>
      {block.kind === "bar" ? (
        <ol className="bk-bars">
          {block.data.map((d, i) => (
            <li key={d.label} className={block.highlight === i ? "is-hot" : undefined}>
              <span className="bk-bar-label">{d.label}</span>
              <span className="bk-bar-track">
                <span className="bk-bar-fill" style={{ "--bk-w": `${(d.value / max) * 100}%`, "--bk-i": i } as CSSProperties} />
              </span>
              <span className="bk-bar-value">{fmt(d.value)}{unit}</span>
            </li>
          ))}
        </ol>
      ) : (
        <LineChart data={block.data} max={max} unit={unit} highlight={block.highlight} />
      )}
      <Evidence block={block} />
    </figure>
  );
}

function LineChart({ data, max, unit, highlight }: { data: { label: string; value: number }[]; max: number; unit: string; highlight?: number }) {
  // 0–100 viewBox stretched to the frame; text stays HTML so it is crisp and readable on phones.
  const pts = data.map((d, i) => [(i / (data.length - 1)) * 100, 96 - (d.value / max) * 88] as const);
  const line = pts.map(([x, y]) => `${x},${y}`).join(" ");
  return (
    <div className="bk-line">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <polygon className="bk-line-area" points={`0,100 ${line} 100,100`} />
        <polyline className="bk-line-stroke" points={line} />
      </svg>
      {pts.map(([x, y], i) => (
        <span key={data[i].label} className={`bk-line-dot${highlight === i ? " is-hot" : ""}`} style={{ left: `${x}%`, top: `${y}%` }}>
          <span>{fmt(data[i].value)}{unit}</span>
        </span>
      ))}
      <ol className="bk-line-axis">
        {data.map((d) => <li key={d.label}>{d.label}</li>)}
      </ol>
      <table className="bk-sr">
        <tbody>{data.map((d) => <tr key={d.label}><th>{d.label}</th><td>{fmt(d.value)}{unit}</td></tr>)}</tbody>
      </table>
    </div>
  );
}

function Leaderboard({ block }: { block: BlockOf<"leaderboard"> }) {
  const rows = [...block.rows].sort((a, b) => b.score - a.score);
  const max = rows[0].score || 1;
  const unit = block.unit ? ` ${block.unit}` : "";
  return (
    <figure className="bk bk-leaderboard">
      <figcaption className="bk-title">{block.title}</figcaption>
      <ol>
        {rows.map((row, i) => (
          <li key={row.name} className={i < 3 ? `is-top is-top-${i + 1}` : undefined}>
            <span className="bk-rank">{i + 1}</span>
            <span className="bk-lb-main">
              <strong>{row.name}</strong>
              {row.note && <small>{row.note}</small>}
              <span className="bk-lb-track"><span style={{ "--bk-w": `${(row.score / max) * 100}%`, "--bk-i": i } as CSSProperties} /></span>
            </span>
            <span className="bk-lb-score">{fmt(row.score)}{unit}</span>
          </li>
        ))}
      </ol>
      <Evidence block={block} />
    </figure>
  );
}

function Storyboard({ block }: { block: BlockOf<"storyboard"> }) {
  return (
    <figure className="bk bk-storyboard">
      {block.title && <figcaption className="bk-title">{block.title}</figcaption>}
      <ol>
        {block.frames.map((frame, i) => (
          <li key={frame.title}>
            <span className="bk-frame-no">Frame {String(i + 1).padStart(2, "0")}</span>
            <strong>{frame.title}</strong>
            <p>{frame.text}</p>
          </li>
        ))}
      </ol>
    </figure>
  );
}

const CALLOUT_LABEL = { tip: "Tip", key: "Key idea", warning: "Watch out", exercise: "Try this" } as const;
const CALLOUT_GLYPH = { tip: "✦", key: "◆", warning: "!", exercise: "✎" } as const;

function Callout({ block }: { block: BlockOf<"callout"> }) {
  return (
    <aside className={`bk bk-callout is-${block.tone}`}>
      <span className="bk-callout-glyph" aria-hidden="true">{CALLOUT_GLYPH[block.tone]}</span>
      <div>
        <p className="bk-callout-kicker">{CALLOUT_LABEL[block.tone]}</p>
        <p className="bk-callout-title">{block.title}</p>
        <p>{block.text}</p>
      </div>
    </aside>
  );
}

function Compare({ block }: { block: BlockOf<"compare"> }) {
  return (
    <figure className="bk bk-compare">
      {block.title && <figcaption className="bk-title">{block.title}</figcaption>}
      <div>
        {(["before", "after"] as const).map((side) => (
          <section key={side} className={`is-${side}`}>
            <p className="bk-compare-label"><span aria-hidden="true">{side === "before" ? "✕" : "✓"}</span>{block[side].label}</p>
            <ul>{block[side].items.map((item) => <li key={item}>{item}</li>)}</ul>
          </section>
        ))}
      </div>
    </figure>
  );
}
