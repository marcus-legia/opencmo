"use client";

/**
 * Bảng Visuals (spec visuals V3): chèn visual giải thích mà không cần agent —
 * mũi tên/khoanh/gạch chân, diagram, biểu đồ, đồ thị. Mỗi nút là MỘT
 * op của editor-core (cùng op agent gọi), đặt ở playhead, dài 4 giây.
 *
 * Chọn sẵn một visual trên canvas thì bảng mở ở chế độ sửa: đổi nhãn/số/công
 * thức rồi "Update" là `update_visual` — sinh lại tại chỗ, giữ id và thời gian.
 *
 * Titles (lower third, name tag, chapter) stay up 5.5 s so a name and role can be read.
 */

import { useEffect, useState } from "react";

import { findIcons, iconPath, type IconMatch } from "@opencmo/clip-icons";
import { TITLE_KINDS, TITLE_LOOKS, TITLE_MOTIONS, type TitleInput } from "@opencmo/editor-core";

const MOTIONS = ["draw", "pop", "spin", "orbit", "bounce", "float", "pulse", "shake", "fly"] as const;

/** Một ô icon: vẽ `d` 24×24 bằng SVG của trình duyệt (chỉ để chọn, không phải preview clip). */
function IconTile({ name, onPick }: { name: string; onPick: () => void }) {
  const [d, setD] = useState<string | null>(null);
  useEffect(() => {
    void iconPath(name).then(setD);
  }, [name]);
  return (
    <button type="button" className="ed2-chip" title={name} aria-label={name} data-testid={`visuals-icon-${name}`} onClick={onPick} style={{ padding: 6 }}>
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        {d ? <path d={d} /> : null}
      </svg>
    </button>
  );
}

type Kind = "icon" | "pointer" | "diagram" | "chart" | "graph" | "title" | "hook" | "list";

const KINDS: { kind: Kind; label: string }[] = [
  { kind: "icon", label: "Icon" },
  { kind: "pointer", label: "Pointer" },
  { kind: "diagram", label: "Diagram" },
  { kind: "chart", label: "Chart" },
  { kind: "graph", label: "Graph" },
  { kind: "title", label: "Title" },
  { kind: "hook", label: "Hook" },
  { kind: "list", label: "List" },
];

const POINTERS = [
  { shape: "arrow", label: "Arrow", from: [0.2, 0.25], to: [0.65, 0.4] },
  { shape: "circle", label: "Circle", box: { x: 0.3, y: 0.3, width: 0.4, height: 0.12 } },
  { shape: "underline", label: "Underline", from: [0.15, 0.62], to: [0.85, 0.62] },
  { shape: "highlight", label: "Highlight", box: { x: 0.15, y: 0.58, width: 0.7, height: 0.05 } },
  { shape: "check", label: "Check", box: { x: 0.42, y: 0.3, width: 0.16, height: 0.1 } },
  { shape: "cross", label: "Cross", box: { x: 0.43, y: 0.3, width: 0.14, height: 0.08 } },
] as const;

const LAYOUTS = ["column", "row", "cycle", "tree", "compare"] as const;
const TITLE_KIND_LABELS: Record<TitleInput["kind"], string> = { lowerThird: "Lower third", nameTag: "Name tag", chapter: "Chapter" };
const TITLE_LOOK_LABELS: Record<TitleInput["look"], string> = { bar: "Bar", kicker: "Kicker", card: "Card" };
const TITLE_MOTION_LABELS: Record<TitleInput["motion"], string> = { calm: "Calm", standard: "Standard", punchy: "Punchy" };
const TITLE_SIDES = [
  { side: "left", label: "Left" },
  { side: "center", label: "Center" },
  { side: "right", label: "Right" },
] as const;
type TitleSide = (typeof TITLE_SIDES)[number]["side"];
const CHARTS = ["stat", "bar", "line", "donut", "pie"] as const;

/** Vùng đặt chuẩn hoá 0–1; "auto" để op tự chọn (1/3 trên của khung dọc). */
const REGIONS = {
  auto: null,
  top: { x: 0.06, y: 0.06, width: 0.88, height: 0.34 },
  middle: { x: 0.06, y: 0.33, width: 0.88, height: 0.34 },
  bottom: { x: 0.06, y: 0.52, width: 0.88, height: 0.3 },
  left: { x: 0.04, y: 0.1, width: 0.46, height: 0.8 },
  right: { x: 0.5, y: 0.1, width: 0.46, height: 0.8 },
  full: { x: 0.04, y: 0.04, width: 0.92, height: 0.92 },
} as const;
type RegionName = keyof typeof REGIONS;

export type SelectedVisual = { id: string; op: string; input: Record<string, unknown> };

/** "Label: 12" mỗi dòng → dữ liệu biểu đồ; dòng không có số bị bỏ. */
function parseData(text: string): { label: string; value: number }[] {
  return text
    .split("\n")
    .map((line) => {
      const match = /^(.*?)[:=\s]\s*(-?[\d.,]+)\s*$/.exec(line.trim());
      if (!match) return null;
      const value = Number(match[2]!.replace(/,/g, ""));
      return Number.isFinite(value) ? { label: match[1]!.trim().slice(0, 24), value } : null;
    })
    .filter((item): item is { label: string; value: number } => item !== null);
}

const lines = (text: string) =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

export function VisualsPanel({
  busy,
  playhead,
  selected,
  onRun,
  onClose,
}: {
  busy: boolean;
  playhead: () => number;
  selected: SelectedVisual | null;
  onRun: (ops: unknown[]) => void;
  onClose: () => void;
}) {
  const [kind, setKind] = useState<Kind>("icon");
  const [iconQuery, setIconQuery] = useState("arrow");
  const [icons, setIcons] = useState<IconMatch[]>([]);
  const [motion, setMotion] = useState<(typeof MOTIONS)[number]>("pop");
  const [labels, setLabels] = useState("Hook\nValue\nCall to action");
  const [layout, setLayout] = useState<(typeof LAYOUTS)[number]>("column");
  const [chart, setChart] = useState<(typeof CHARTS)[number]>("stat");
  const [data, setData] = useState("Faster: 47");
  const [unit, setUnit] = useState("%");
  const [expr, setExpr] = useState("2^x");
  const [title, setTitle] = useState("");
  const [region, setRegion] = useState<RegionName>("auto");
  const [titleKind, setTitleKind] = useState<TitleInput["kind"]>("lowerThird");
  const [titleSub, setTitleSub] = useState("");
  const [hookTop, setHookTop] = useState("");
  const [hookBottom, setHookBottom] = useState("");
  const [listText, setListText] = useState("Plan the week\nDraft the posts\nApprove and publish");
  const [titleLook, setTitleLook] = useState<TitleInput["look"]>("bar");
  const [titleSide, setTitleSide] = useState<TitleSide>("left");
  const [titleMotion, setTitleMotion] = useState<TitleInput["motion"]>("standard");

  // Sửa visual đang chọn: nạp input của nó vào form.
  useEffect(() => {
    if (!selected) return;
    const input = selected.input;
    if (selected.op === "add_diagram") {
      setKind("diagram");
      setLabels(((input.nodes as { label: string }[] | undefined) ?? []).map((node) => node.label).join("\n"));
      if (typeof input.layout === "string") setLayout(input.layout as (typeof LAYOUTS)[number]);
    } else if (selected.op === "add_chart") {
      setKind("chart");
      setChart(input.type as (typeof CHARTS)[number]);
      setData(((input.data as { label: string; value: number }[] | undefined) ?? []).map((item) => `${item.label}: ${item.value}`).join("\n"));
      setUnit(typeof input.unit === "string" ? input.unit : "");
    } else if (selected.op === "add_graph") {
      setKind("graph");
      setExpr(String(input.expr ?? "x"));
    } else if (selected.op === "add_title") {
      setKind("title");
      const kindOf = (input.kind as TitleInput["kind"] | undefined) ?? "lowerThird";
      setTitleKind(kindOf);
      setTitleSub(typeof input.sub === "string" ? input.sub : "");
      setTitleLook((input.look as TitleInput["look"] | undefined) ?? "bar");
      setTitleSide((input.side as TitleSide | undefined) ?? (kindOf === "chapter" ? "center" : "left"));
      setTitleMotion((input.motion as TitleInput["motion"] | undefined) ?? "standard");
    } else if (selected.op === "add_hook_title") {
      setKind("hook");
      const hook = (input.lines as string[] | undefined) ?? [];
      setHookTop(hook[0] ?? "");
      setHookBottom(hook[1] ?? "");
    } else if (selected.op === "add_list") {
      setKind("list");
      setListText(((input.items as { label: string; meta?: string }[] | undefined) ?? []).map((item) => (item.meta ? `${item.label} | ${item.meta}` : item.label)).join("\n"));
    }
    setTitle(typeof input.title === "string" ? input.title : "");
  }, [selected]);

  useEffect(() => {
    if (kind !== "icon") return;
    let live = true;
    void findIcons(iconQuery || "arrow", 30).then((found) => live && setIcons(found));
    return () => {
      live = false;
    };
  }, [kind, iconQuery]);

  const at = (seconds = 4) => {
    const start = Math.round(playhead() * 100) / 100;
    return { start, end: Math.round((start + seconds) * 100) / 100 };
  };
  const titled = { ...(title.trim() ? { title: title.trim() } : {}), ...(REGIONS[region] ? { region: REGIONS[region] } : {}) };

  const spec = (): Record<string, unknown> | null => {
    if (kind === "diagram") {
      const nodes = lines(labels).slice(0, 8);
      if (!nodes.length) return null;
      if (layout === "compare") {
        const [a, b] = [nodes.slice(0, Math.ceil(nodes.length / 2)), nodes.slice(Math.ceil(nodes.length / 2))];
        return { layout, nodes: [{ label: a[0] ?? "A", items: a.slice(1) }, { label: b[0] ?? "B", items: b.slice(1) }], ...titled };
      }
      return { layout, nodes: nodes.map((label) => ({ label: label.slice(0, 60) })), ...titled };
    }
    if (kind === "chart") {
      const values = parseData(data);
      if (!values.length) return null;
      return { type: chart, data: chart === "stat" ? values.slice(0, 1) : values.slice(0, 12), ...(unit ? { unit } : {}), ...titled };
    }
    if (kind === "graph") return expr.trim() ? { expr: expr.trim(), label: `y = ${expr.trim()}`, ...titled } : null;
    if (kind === "hook") {
      const hook = [hookTop, hookBottom].map((line) => line.trim().slice(0, 40)).filter(Boolean);
      return hook.length ? { lines: hook } : null;
    }
    if (kind === "list") {
      // "Label | fact" per line; the fact is optional ("12.4k", "free").
      const items = lines(listText)
        .slice(0, 7)
        .map((line) => {
          const [label, meta] = line.split("|").map((part) => part.trim());
          return { label: (label ?? "").slice(0, 40), ...(meta ? { meta: meta.slice(0, 16) } : {}) };
        })
        .filter((item) => item.label);
      return items.length >= 2 ? { items } : null;
    }
    if (kind === "title") {
      if (!title.trim()) return null;
      return { kind: titleKind, title: title.trim().slice(0, 60), ...(titleSub.trim() ? { sub: titleSub.trim().slice(0, 80) } : {}), look: titleLook, side: titleSide, motion: titleMotion };
    }
    return null;
  };

  const add = (op: string, extra: Record<string, unknown>) => onRun([{ op, ...at(op === "add_title" ? 5.5 : op === "add_list" ? 6 : 4), ...extra }]);
  const opFor: Record<Kind, string> = { icon: "add_icon", pointer: "add_shape", diagram: "add_diagram", chart: "add_chart", graph: "add_graph", title: "add_title", hook: "add_hook_title", list: "add_list" };
  const editing = selected && selected.op === opFor[kind] ? selected : null;

  return (
    <div className="ed2-gen" data-testid="visuals-panel" onPointerDown={(event) => event.stopPropagation()}>
      {/* The kinds do not fit one line of the panel: wrap instead of running under the canvas toolbar. */}
      <div className="ed2-row ed2-wrap">
        {KINDS.map((entry) => (
          <button key={entry.kind} type="button" className="ed2-chip" aria-pressed={kind === entry.kind} data-testid={`visuals-kind-${entry.kind}`} onClick={() => setKind(entry.kind)}>
            {entry.label}
          </button>
        ))}
        <span className="ed2-grow" />
        <button type="button" className="ed2-icon" aria-label="Close" onClick={onClose}>
          ×
        </button>
      </div>

      {kind === "icon" ? (
        <>
          <input className="ed2-select" style={{ flex: "none" }} aria-label="Search icons" placeholder="Search icons: money, rocket, bow arrow…" data-testid="visuals-icon-search" value={iconQuery} onChange={(event) => setIconQuery(event.target.value)} onKeyDown={(event) => event.stopPropagation()} />
          <div className="ed2-row ed2-wrap">
            {MOTIONS.map((value) => (
              <button key={value} type="button" className="ed2-chip" aria-pressed={motion === value} data-testid={`visuals-motion-${value}`} onClick={() => setMotion(value)}>
                {value}
              </button>
            ))}
          </div>
          <div className="ed2-row ed2-wrap" style={{ maxHeight: 180, overflowY: "auto" }}>
            {icons.map((icon) => (
              <IconTile
                key={icon.name}
                name={icon.name}
                onPick={() => add("add_icon", { name: icon.name, motion, at: [0.5, 0.25], ...(motion === "fly" ? { at: [0.2, 0.25], to: [0.8, 0.25], orient: true } : {}) })}
              />
            ))}
          </div>
        </>
      ) : null}

      {kind === "pointer" ? (
        <div className="ed2-row ed2-wrap">
          {POINTERS.map((pointer) => (
            <button
              key={pointer.shape}
              type="button"
              className="ed2-chip"
              disabled={busy}
              data-testid={`visuals-shape-${pointer.shape}`}
              onClick={() => {
                const { label: _label, ...shape } = pointer;
                add("add_shape", shape);
              }}
            >
              {pointer.label}
            </button>
          ))}
        </div>
      ) : null}

      {kind === "diagram" ? (
        <>
          <div className="ed2-row ed2-wrap">
            {LAYOUTS.map((value) => (
              <button key={value} type="button" className="ed2-chip" aria-pressed={layout === value} onClick={() => setLayout(value)}>
                {value}
              </button>
            ))}
          </div>
          <textarea
            className="ed2-asst-input"
            aria-label="Steps, one per line"
            placeholder={layout === "compare" ? "First half: title then bullets; second half: title then bullets" : "One step per line"}
            data-testid="visuals-labels"
            value={labels}
            onChange={(event) => setLabels(event.target.value)}
            onKeyDown={(event) => event.stopPropagation()}
          />
        </>
      ) : null}

      {kind === "chart" ? (
        <>
          <div className="ed2-row ed2-wrap">
            {CHARTS.map((value) => (
              <button key={value} type="button" className="ed2-chip" aria-pressed={chart === value} onClick={() => setChart(value)}>
                {value}
              </button>
            ))}
            <input className="ed2-select" aria-label="Unit" placeholder="Unit" value={unit} style={{ width: 64 }} onChange={(event) => setUnit(event.target.value)} onKeyDown={(event) => event.stopPropagation()} />
          </div>
          <textarea
            className="ed2-asst-input"
            aria-label="Data, one 'label: value' per line"
            placeholder="Label: value, one per line"
            data-testid="visuals-data"
            value={data}
            onChange={(event) => setData(event.target.value)}
            onKeyDown={(event) => event.stopPropagation()}
          />
        </>
      ) : null}

      {kind === "graph" ? (
        <input className="ed2-select" aria-label="Formula in x" placeholder="y = …  e.g. 2^x, x^2, sin(x)" data-testid="visuals-expr" value={expr} onChange={(event) => setExpr(event.target.value)} onKeyDown={(event) => event.stopPropagation()} />
      ) : null}

      {kind === "title" ? (
        <>
          <div className="ed2-row ed2-wrap" aria-label="Kind">
            {TITLE_KINDS.map((value) => (
              <button
                key={value}
                type="button"
                className="ed2-chip"
                aria-pressed={titleKind === value}
                data-testid={`visuals-title-kind-${value}`}
                onClick={() => {
                  setTitleKind(value);
                  // A chapter title reads best centred; switching back to a name puts it on the left.
                  if (value === "chapter") setTitleSide("center");
                  else if (titleKind === "chapter") setTitleSide("left");
                }}
              >
                {TITLE_KIND_LABELS[value]}
              </button>
            ))}
          </div>
          <input
            className="ed2-select"
            style={{ flex: "none" }}
            aria-label={titleKind === "chapter" ? "Title" : "Name"}
            placeholder={titleKind === "chapter" ? "Chapter title" : "Name"}
            maxLength={60}
            data-testid="visuals-title-text"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            onKeyDown={(event) => event.stopPropagation()}
          />
          <input
            className="ed2-select"
            style={{ flex: "none" }}
            aria-label={titleKind === "chapter" ? "Subtitle (optional)" : "Role (optional)"}
            placeholder={titleKind === "chapter" ? "Subtitle, e.g. Episode 12 (optional)" : "Role, e.g. Founder, Paylane (optional)"}
            maxLength={80}
            data-testid="visuals-title-sub"
            value={titleSub}
            onChange={(event) => setTitleSub(event.target.value)}
            onKeyDown={(event) => event.stopPropagation()}
          />
          {/* Look and side share a row: the panel has no max height and must fit a 720 px-high window. */}
          <div className="ed2-row ed2-wrap">
            {TITLE_LOOKS.map((value) => (
              <button key={value} type="button" className="ed2-chip" aria-pressed={titleLook === value} data-testid={`visuals-title-look-${value}`} onClick={() => setTitleLook(value)}>
                {TITLE_LOOK_LABELS[value]}
              </button>
            ))}
            <span className="ed2-grow" />
            {TITLE_SIDES.map((entry) => (
              <button key={entry.side} type="button" className="ed2-chip" aria-pressed={titleSide === entry.side} aria-label={`Side: ${entry.label}`} data-testid={`visuals-title-side-${entry.side}`} onClick={() => setTitleSide(entry.side)}>
                {entry.label}
              </button>
            ))}
          </div>
          <div className="ed2-row ed2-wrap" aria-label="Motion">
            {TITLE_MOTIONS.map((value) => (
              <button key={value} type="button" className="ed2-chip" aria-pressed={titleMotion === value} data-testid={`visuals-title-motion-${value}`} onClick={() => setTitleMotion(value)}>
                {TITLE_MOTION_LABELS[value]}
              </button>
            ))}
          </div>
        </>
      ) : null}

      {kind === "hook" ? (
        <>
          <input className="ed2-select" style={{ flex: "none" }} aria-label="First line" placeholder="First line: the topic, e.g. 3 posts a day" maxLength={40} data-testid="visuals-hook-top" value={hookTop} onChange={(event) => setHookTop(event.target.value)} onKeyDown={(event) => event.stopPropagation()} />
          <input className="ed2-select" style={{ flex: "none" }} aria-label="Second line (optional)" placeholder="Second line: the promise, e.g. in 10 minutes (optional)" maxLength={40} data-testid="visuals-hook-bottom" value={hookBottom} onChange={(event) => setHookBottom(event.target.value)} onKeyDown={(event) => event.stopPropagation()} />
        </>
      ) : null}

      {kind === "list" ? (
        <textarea
          className="ed2-asst-input"
          aria-label="Items, one per line"
          placeholder={"One item per line, 2 to 7. Add a short fact after a bar: Free tier | $0"}
          data-testid="visuals-list-items"
          value={listText}
          onChange={(event) => setListText(event.target.value)}
          onKeyDown={(event) => event.stopPropagation()}
        />
      ) : null}

      {kind !== "pointer" && kind !== "icon" && kind !== "title" && kind !== "hook" && kind !== "list" ? (
        <div className="ed2-row ed2-wrap" aria-label="Region">
          {(Object.keys(REGIONS) as RegionName[]).map((name) => (
            <button key={name} type="button" className="ed2-chip" aria-pressed={region === name} data-testid={`visuals-region-${name}`} onClick={() => setRegion(name)}>
              {name}
            </button>
          ))}
        </div>
      ) : null}

      {kind === "diagram" || kind === "chart" || kind === "graph" || kind === "title" || kind === "hook" || kind === "list" ? (
        <div className="ed2-row">
          {kind === "title" || kind === "hook" || kind === "list" ? (
            <span className="ed2-grow" />
          ) : (
            <input className="ed2-select ed2-grow" aria-label="Title (optional)" placeholder="Title (optional)" value={title} onChange={(event) => setTitle(event.target.value)} onKeyDown={(event) => event.stopPropagation()} />
          )}
          {editing ? (
            <button
              type="button"
              className="ed2-btn"
              disabled={busy || !spec()}
              data-testid="visuals-update"
              onClick={() => {
                const changes = spec();
                if (changes) onRun([{ op: "update_visual", id: editing.id, changes }]);
              }}
            >
              Update
            </button>
          ) : null}
          <button
            type="button"
            className="ed2-btn ed2-primary"
            disabled={busy || !spec()}
            data-testid="visuals-add"
            title={kind === "title" || kind === "hook" ? "In your brand colors, inside the safe area and above the captions" : undefined}
            onClick={() => {
              const extra = spec();
              if (extra) add(opFor[kind], extra);
            }}
          >
            Add at playhead
          </button>
        </div>
      ) : null}
    </div>
  );
}
