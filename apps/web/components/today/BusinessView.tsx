"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

import { PlanSheet, isPlanRequired } from "@/components/billing/PlanSheet";
import { api, jsonBody } from "@/components/clipping/api";
import { DocumentForm, type Body } from "@/components/cmo/DocumentFields";
import { useShellState } from "@/components/shell-v2/ShellState";
import { DOCUMENTS, DOCUMENT_KINDS, type DocumentKind, type Field } from "@/lib/cmo/documents";
import type { CmoState, DocumentRow } from "@/lib/cmo/state";

import { siteLabel, useWorkspace } from "./workspace";

/** What each document is for, in the order the founder reads them (canvas board Documents). */
const ABOUT: Record<DocumentKind, { title: string; readers: string; lede: string }> = {
  product: { title: "Product", readers: "every step", lede: "What you sell, in the words a customer would use. Sales reads it to judge fit; Post reads it so drafts never invent a feature." },
  strategy: { title: "Strategy", readers: "Sales, Post, chat", lede: "Who you sell to and where they talk. This decides what Sales looks for and what this week is for." },
  competitors: { title: "Competitors", readers: "Sales, Research", lede: "Who else they look at. Sales looks for people comparing you with each one." },
  post_plan: { title: "Post plan", readers: "Post, Calendar", lede: "What you post about and how often. Topics come from what people said, not from guesses." },
  brand: { title: "Brand", readers: "replies, posts, images", lede: "How you sound and how your images look. Replies and posts read the voice; images in Post use the look." },
};

/** Lists that read better as chips than as a list of lines. */
const CHIPS = new Set(["features", "where_they_ask", "avoid", "image_styles"]);
/** A line under a field's label: who uses it. */
const USES: Record<string, string> = {
  one_liner: "Used in replies that may name you",
  problems: "Sales looks for these",
  where_they_ask: "Sales looks here first",
  this_week: "The planner sets it on Monday",
  topics: "From the Library",
  voice_samples: "Replies and posts copy this, not a description of it",
  intro_line: "Every reply that names you",
  avoid: "Plus the no-AI-slop rules on every draft",
};
const CHANNEL_LABEL: Record<string, string> = { x: "X", linkedin: "LinkedIn", threads: "Threads" };

/** "Strategy", "Strategy and Brand", "Product, Strategy and Brand". */
const andList = (items: string[]) => (items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`);
const isKind = (value: string | null): value is DocumentKind => !!value && (DOCUMENT_KINDS as readonly string[]).includes(value);
const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((v): v is string => typeof v === "string" && v.trim() !== "") : []);
const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

const when = (iso: string) => {
  const d = new Date(iso);
  return d.toDateString() === new Date().toDateString() ? "today" : new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" }).format(d);
};

function Section({ label, uses, children }: { label: string; uses?: string; children: ReactNode }) {
  return (
    <section style={{ display: "grid", gridTemplateColumns: "minmax(0, 200px) minmax(0, 1fr)", gap: "8px 24px", padding: "14px 0", borderTop: "1px solid var(--line)" }} className="td-bizfield">
      <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
        <span style={{ fontWeight: "500", fontSize: "13.5px" }}>{label}</span>
        {uses ? <span className="meta">{uses}</span> : null}
      </div>
      <div style={{ minWidth: "0", fontSize: "14px", lineHeight: "1.55" }}>{children}</div>
    </section>
  );
}

const Chips = ({ items }: { items: string[] }) => (
  <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
    {items.map((item) => (
      <span key={item} className="chip">
        {item}
      </span>
    ))}
  </div>
);

const Items = ({ items }: { items: string[] }) => (
  <ul style={{ margin: "0", paddingLeft: "18px", display: "flex", flexDirection: "column", gap: "4px" }}>
    {items.map((item, i) => (
      <li key={i}>{item}</li>
    ))}
  </ul>
);

const Empty = () => <span className="meta">Not filled in yet.</span>;

/** The Brand's look: the logo's address, the colours as swatches, the font, the screenshots and a preview of an image. */
function Look({ look, name }: { look: Record<string, unknown>; name: string }) {
  const colors = strings(look.colors);
  const font = text(look.font);
  const logo = text(look.logo_url);
  const shots = strings(look.screenshots);
  const styles = strings(look.image_styles);
  const [primary, accent] = [colors[0] ?? "var(--accent)", colors[1] ?? colors[0] ?? "var(--accent)"];
  return (
    <>
      <Section label="Look · logo">{logo ? <span>{siteLabel(logo)}</span> : <Empty />}</Section>
      <Section label="Look · colours and font" uses="Read from your site">
        {colors.length ? (
          <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }} data-testid="brand-colors">
            {colors.map((c) => (
              <span key={c} style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                <span aria-hidden="true" style={{ width: "20px", height: "20px", borderRadius: "5px", background: c, border: "1px solid var(--line)" }}></span>
                <span className="mono meta">{c}</span>
              </span>
            ))}
          </div>
        ) : (
          <Empty />
        )}
        {font ? <div style={{ marginTop: "8px", fontFamily: `"${font}", var(--font-sans, system-ui)` }}>{font}</div> : null}
      </Section>
      {shots.length ? (
        <Section label="Look · product screenshots" uses="The image B2B buyers trust most">
          <Items items={shots.map((s) => s.split("/").pop() ?? s)} />
        </Section>
      ) : null}
      <Section label="Look · image styles">{styles.length ? <Chips items={styles} /> : <Empty />}</Section>
      <Section label="Preview">
        <div data-testid="brand-preview" style={{ borderRadius: "10px", padding: "16px", background: primary, color: "#fff", display: "flex", flexDirection: "column", gap: "6px", maxWidth: "360px", fontFamily: font ? `"${font}", system-ui` : undefined }}>
          <span style={{ fontSize: "12px", opacity: "0.85" }}>{name || "Your product"}</span>
          <span style={{ fontSize: "18px", fontWeight: "700" }}>One line from a post</span>
          <span style={{ alignSelf: "flex-start", fontSize: "12px", padding: "2px 8px", borderRadius: "999px", background: accent }}>Your accent colour</span>
        </div>
        <p className="meta" style={{ margin: "6px 0 0" }}>
          Images made in Post use these colours and this font.
        </p>
      </Section>
    </>
  );
}

/** One document as the founder reads it: each field drawn by what it holds. */
function DocumentBody({ kind, body, name }: { kind: DocumentKind; body: Record<string, unknown>; name: string }) {
  if (kind === "competitors") {
    const rows = (Array.isArray(body.competitors) ? body.competitors : []) as Record<string, unknown>[];
    return (
      <Section label="Competitors">
        {rows.length ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {rows.map((r, i) => (
              <div key={i} style={{ display: "grid", gridTemplateColumns: "minmax(0, 180px) minmax(0, 1fr)", gap: "4px 16px" }}>
                <span>
                  <b style={{ fontWeight: "600" }}>{text(r.name)}</b>
                  <span className="meta" style={{ display: "block" }}>
                    {siteLabel(text(r.website)) ?? ""}
                  </span>
                </span>
                <span>{text(r.difference)}</span>
              </div>
            ))}
          </div>
        ) : (
          <Empty />
        )}
      </Section>
    );
  }
  return (
    <>
      {DOCUMENTS[kind].fields.map((field) => {
        if (field.type === "object") return field.key === "look" ? <Look key={field.key} look={(body.look ?? {}) as Record<string, unknown>} name={name} /> : null;
        const value = body[field.key];
        const label = kind === "brand" && field.key !== "voice" ? `Voice · ${field.label.toLowerCase()}` : field.label;
        let content: ReactNode;
        if (field.type === "choices") {
          const picked = strings(value).map((v) => CHANNEL_LABEL[v] ?? v);
          content = picked.length ? <Chips items={picked} /> : <Empty />;
        } else if (field.type === "list") {
          const items = strings(value);
          content = !items.length ? (
            field.key === "voice_samples" ? (
              <span className="meta">None yet. Edit the Brand to paste two or three things you wrote: a post, a comment, an email.</span>
            ) : (
              <Empty />
            )
          ) : field.key === "voice_samples" ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {items.map((sample, i) => (
                <blockquote key={i} style={{ margin: "0", padding: "8px 10px", borderRadius: "7px", background: "var(--hover)" }}>
                  “{sample}”
                </blockquote>
              ))}
            </div>
          ) : CHIPS.has(field.key) ? (
            <Chips items={items} />
          ) : (
            <Items items={items} />
          );
        } else if (field.type === "group") {
          content = null;
        } else {
          const v = text(value);
          content = v ? <p style={{ margin: "0", whiteSpace: "pre-wrap" }}>{v}</p> : <Empty />;
        }
        return content === null ? null : (
          <Section key={field.key} label={label} uses={USES[field.key]}>
            {content}
          </Section>
        );
      })}
    </>
  );
}

const SAMPLES_MAX = 5;
const SAMPLE_CHARS = 600;

/**
 * The form's fields. The Brand's writing samples get their own boxes (a sample can span lines, so "one per line" would
 * cut it), and screenshots are kept as they are: they are files, not text to type.
 */
function formFields(kind: DocumentKind): Field[] {
  const fields = DOCUMENTS[kind].fields;
  if (kind !== "brand") return fields;
  return fields
    .filter((f) => f.key !== "voice_samples")
    .map((f) => (f.type === "object" ? { ...f, fields: f.fields.filter((inner) => inner.key !== "screenshots") } : f));
}

/** Up to five pieces of the founder's own writing, one box each: a post, a comment, an email. */
function SamplesEditor({ value, onChange }: { value: string[]; onChange: (next: string[]) => void }) {
  const boxes = value.length ? value : [""];
  return (
    <fieldset className="cmo-group" data-testid="brand-samples">
      <legend>Your writing samples</legend>
      <p className="meta" style={{ margin: "0 0 8px" }}>
        Paste things you wrote yourself: a post, a comment, an email to a client. Replies and posts are written to sound like them.
      </p>
      {boxes.map((sample, i) => (
        <label key={i} className="cmo-field" htmlFor={`biz-sample-${i}`}>
          <span>Sample {i + 1}</span>
          <textarea id={`biz-sample-${i}`} rows={3} maxLength={SAMPLE_CHARS} value={sample} onChange={(e) => onChange(boxes.map((s, j) => (j === i ? e.target.value : s)))} />
        </label>
      ))}
      {boxes.length < SAMPLES_MAX ? (
        <button type="button" className="text-button" onClick={() => onChange([...boxes, ""])}>
          Add a sample
        </button>
      ) : null}
    </fieldset>
  );
}

/**
 * Your business (wave 3, canvas board Documents): the five documents every step reads, on one page. Edit opens the
 * document's form in place and Save writes a new version. "Read my website again" first says which documents the
 * founder edited, since reading the site writes a new version of every document (the old ones stay in the history).
 */
export function BusinessView() {
  const params = useSearchParams();
  const router = useRouter();
  const ws = useWorkspace();
  const { toast } = useShellState();
  const asked = params.get("d");
  const kind: DocumentKind = isKind(asked) ? asked : "product";
  const [state, setState] = useState<CmoState | null>(null);
  const [failed, setFailed] = useState(false);
  const [draft, setDraft] = useState<Body | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [reading, setReading] = useState(false);
  const [planSheet, setPlanSheet] = useState(false);

  useEffect(() => {
    let alive = true;
    api<CmoState>("/cmo/documents")
      .then((next) => alive && setState(next))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, []);

  const written = state?.documents[kind];
  const changed = draft !== null && JSON.stringify(draft) !== JSON.stringify(written?.body ?? {});
  const pick = (next: DocumentKind) => {
    if (next === kind) return;
    if (changed && !window.confirm("Leave without saving your changes?")) return;
    setDraft(null);
    setError(null);
    router.push(`/app/business?d=${next}`, { scroll: false });
  };

  async function save() {
    if (!draft) return;
    setSaving(true);
    setError(null);
    try {
      const body = kind === "brand" ? { ...draft, voice_samples: strings(draft.voice_samples) } : draft;
      const saved = await api<DocumentRow>(`/cmo/documents/${kind}`, jsonBody({ body }, "PUT"));
      setState((was) => ({ lastRun: was?.lastRun ?? null, documents: { ...(was?.documents ?? {}), [kind]: saved } }));
      setDraft(null);
      ws.reload();
      toast(`${ABOUT[kind].title} saved. Every draft from now on reads it.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  const site = ws.site ?? (state?.lastRun?.input.site as string | undefined) ?? null;
  const edited = state ? DOCUMENT_KINDS.filter((k) => state.documents[k]?.created_by === "user").map((k) => ABOUT[k].title) : [];

  async function readAgain() {
    if (!site) return;
    setConfirming(false);
    setReading(true);
    try {
      await api("/cmo/onboarding", jsonBody({ site }));
      const next = await api<CmoState>("/cmo/documents");
      setState(next);
      ws.reload();
      toast("Your documents are drafted again from your website.");
    } catch (err) {
      if (isPlanRequired(err)) setPlanSheet(true);
      else toast(err instanceof Error ? err.message : "Could not read your website. Try again in a minute.");
    } finally {
      setReading(false);
    }
  }

  const name = text(state?.documents.product?.body.name) || ws.name || "";

  return (
    <div style={{ maxWidth: "1180px", margin: "0 auto", padding: "22px 24px 40px", display: "flex", gap: "28px", flexWrap: "wrap", alignItems: "flex-start" }} data-testid="v2-business">
      <nav aria-label="Documents" style={{ flex: "1 1 220px", maxWidth: "260px", display: "flex", flexDirection: "column", gap: "4px" }}>
        <span className="meta" style={{ fontWeight: "500", marginBottom: "4px" }}>
          Your business
        </span>
        {DOCUMENT_KINDS.map((k) => (
          <button
            key={k}
            type="button"
            aria-pressed={k === kind}
            onClick={() => pick(k)}
            data-testid="business-doc"
            style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: "1px", padding: "8px 10px", borderRadius: "8px", border: `1px solid ${k === kind ? "var(--accent)" : "transparent"}`, background: k === kind ? "var(--hover)" : "transparent", color: "inherit", font: "inherit", textAlign: "left", cursor: "pointer" }}
          >
            <span style={{ fontWeight: "500" }}>{ABOUT[k].title}</span>
            <span className="meta">Read by {ABOUT[k].readers}</span>
          </button>
        ))}
        <div style={{ marginTop: "12px", paddingTop: "12px", borderTop: "1px solid var(--line)", display: "flex", flexDirection: "column", gap: "8px" }}>
          <span className="meta">{site ? `Drafted from ${siteLabel(site)}. Every step reads these before it writes.` : "Every step reads these before it writes."}</span>
          {site ? (
            <button type="button" className="ghost" disabled={reading || !state} onClick={() => (edited.length ? setConfirming(true) : void readAgain())} style={{ alignSelf: "flex-start" }}>
              {reading ? "Reading your website…" : "Read my website again"}
            </button>
          ) : null}
          {confirming ? (
            <div role="alertdialog" aria-label="Read your website again?" className="card" data-testid="business-reread-confirm" style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <b>Write over your edits?</b>
              <span className="meta">
                You edited {andList(edited)}. Reading your website again writes a new version of every document. Your edited versions stay in the history.
              </span>
              <span style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                <button type="button" className="ghost" onClick={() => setConfirming(false)}>
                  Keep my edits
                </button>
                <button type="button" className="primary" onClick={() => void readAgain()}>
                  Read it again
                </button>
              </span>
            </div>
          ) : null}
        </div>
      </nav>

      <article aria-labelledby="business-title" style={{ flex: "999 1 480px", minWidth: "0" }}>
        <header style={{ display: "flex", flexDirection: "column", gap: "6px", marginBottom: "8px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
            <span className="meta">
              {written ? `Version ${written.version} · ${written.created_by === "user" ? "edited by you" : "drafted by your CMO"} ${when(written.created_at)}` : "Not written yet"}
            </span>
            <span style={{ marginLeft: "auto", display: "flex", gap: "8px" }}>
              {draft ? (
                <>
                  <button type="button" className="ghost" disabled={saving} onClick={() => setDraft(null)}>
                    Cancel
                  </button>
                  <button type="button" className="primary" disabled={saving} onClick={() => void save()}>
                    {saving ? "Saving…" : "Save"}
                  </button>
                </>
              ) : (
                <button type="button" className="primary" disabled={!state} onClick={() => setDraft(structuredClone(written?.body ?? {}))}>
                  {written ? "Edit" : "Write it"}
                </button>
              )}
            </span>
          </div>
          <h1 id="business-title" style={{ margin: "0", fontSize: "22px", fontWeight: "600", letterSpacing: "-0.4px" }}>
            {ABOUT[kind].title}
          </h1>
          <p className="meta" style={{ margin: "0", fontSize: "14px", maxWidth: "640px" }}>
            {ABOUT[kind].lede}
          </p>
        </header>

        {failed ? (
          <p role="alert">Your documents could not be read. Reload the page to try again.</p>
        ) : !state ? (
          <p className="meta">Loading…</p>
        ) : draft ? (
          <div className="td-docform v2">
            {kind === "brand" ? <SamplesEditor value={strings(draft.voice_samples)} onChange={(next) => setDraft({ ...draft, voice_samples: next })} /> : null}
            <DocumentForm fields={formFields(kind)} value={draft} onChange={setDraft} idPrefix={`biz-${kind}`} />
            {error ? (
              <p role="alert" className="td-docform-error">
                {error}
              </p>
            ) : null}
          </div>
        ) : written ? (
          <div data-testid="business-fields">
            <DocumentBody kind={kind} body={written.body} name={name} />
          </div>
        ) : (
          <p>
            Not written yet. Your CMO writes it from your website, or you can write it yourself. <Link href="/app/setup">Set up from your website</Link>
          </p>
        )}
      </article>
      <PlanSheet open={planSheet} onClose={() => setPlanSheet(false)} action="read your website again" />
    </div>
  );
}
