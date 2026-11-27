"use client";

/**
 * Đọc và sửa một marketing document, vẽ từ mô tả field ở `lib/cmo/documents.ts`.
 * Dùng chung cho màn onboarding (`CmoView`) và sheet tài liệu trong dashboard
 * (`DocumentSheet`) — một bản vẽ field, hai chỗ hiện.
 */

import { DOCUMENTS, type DocumentKind, type Field } from "@/lib/cmo/documents";

export type Body = Record<string, unknown>;

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const list = (v: unknown) => (Array.isArray(v) ? (v as unknown[]).map(str).filter(Boolean) : []);

/**
 * Bản đọc dàn trang như một tài liệu: mỗi field một tiêu đề nhỏ + chữ/gạch đầu
 * dòng. Field rỗng bị bỏ hẳn — một trang đầy "Not set" đọc như form chưa điền.
 */
export function DocumentRead({ fields, value }: { fields: Field[]; value: Body }) {
  const shown = fields.filter((field) => {
    const v = value[field.key];
    if (field.type === "group") return Array.isArray(v) && v.length > 0;
    if (field.type === "list" || field.type === "choices") return list(v).length > 0;
    if (field.type === "object") return !!v && typeof v === "object" && field.fields.some((f) => (Array.isArray((v as Body)[f.key]) ? list((v as Body)[f.key]).length : str((v as Body)[f.key])));
    return str(v) !== "";
  });
  if (!shown.length) return <p className="cmo-muted">This document is empty. Edit it to add what Ferreto should know.</p>;
  return (
    <div className="cmo-prose">
      {shown.map((field) => {
        const v = value[field.key];
        if (field.type === "group") {
          return (
            <section key={field.key}>
              <h3>{field.label}</h3>
              <div className="cmo-prose-groups">
                {(v as Body[]).map((row, i) => {
                  const [first, ...rest] = field.fields;
                  return (
                    <article key={i} className="cmo-prose-card">
                      {first ? <h4>{str(row[first.key]) || `${field.label} ${i + 1}`}</h4> : null}
                      <DocumentRead fields={rest} value={row} />
                    </article>
                  );
                })}
              </div>
            </section>
          );
        }
        if (field.type === "object") {
          return (
            <section key={field.key}>
              <h3>{field.label}</h3>
              <DocumentRead fields={field.fields} value={v as Body} />
            </section>
          );
        }
        if (field.type === "choices") {
          const labels = new Map(field.options.map((o) => [o.value, o.label]));
          return (
            <section key={field.key}>
              <h3>{field.label}</h3>
              <p>{list(v).map((item) => labels.get(item) ?? item).join(", ")}</p>
            </section>
          );
        }
        if (field.type === "list") {
          return (
            <section key={field.key}>
              <h3>{field.label}</h3>
              <ul>{list(v).map((item, i) => <li key={i}>{item}</li>)}</ul>
            </section>
          );
        }
        return (
          <section key={field.key}>
            <h3>{field.label}</h3>
            <p>{str(v)}</p>
          </section>
        );
      })}
    </div>
  );
}

/** A line under a field's label where the label alone does not say what to write. */
const FIELD_HINTS: Record<string, string> = {
  content_plan: "What to write, the mix each day, and what never to write. Ferreto plans and writes your posts from it.",
};

export function DocumentForm({ fields, value, onChange, idPrefix }: { fields: Field[]; value: Body; onChange: (next: Body) => void; idPrefix: string }) {
  const set = (key: string, next: unknown) => onChange({ ...value, [key]: next });
  return (
    <div className="cmo-fields">
      {fields.map((field) => {
        const id = `${idPrefix}-${field.key}`;
        if (field.type === "group") {
          const rows = Array.isArray(value[field.key]) ? (value[field.key] as Body[]) : [];
          return (
            <fieldset key={field.key} className="cmo-group">
              <legend>{field.label}</legend>
              {rows.map((row, i) => (
                <div key={i} className="cmo-group-row">
                  <DocumentForm fields={field.fields} value={row} idPrefix={`${id}-${i}`} onChange={(next) => set(field.key, rows.map((r, j) => (j === i ? next : r)))} />
                  <button type="button" className="text-button" onClick={() => set(field.key, rows.filter((_, j) => j !== i))}>
                    Remove
                  </button>
                </div>
              ))}
              {rows.length < field.max ? (
                <button type="button" className="text-button" onClick={() => set(field.key, [...rows, {}])}>
                  Add {field.label.toLowerCase().replace(/s$/, "")}
                </button>
              ) : null}
            </fieldset>
          );
        }
        if (field.type === "object") {
          const inner = value[field.key] && typeof value[field.key] === "object" ? (value[field.key] as Body) : {};
          return (
            <fieldset key={field.key} className="cmo-group">
              <legend>{field.label}</legend>
              <DocumentForm fields={field.fields} value={inner} idPrefix={id} onChange={(next) => set(field.key, next)} />
            </fieldset>
          );
        }
        if (field.type === "choices") {
          return <Choices key={field.key} field={field} value={value[field.key]} onChange={(next) => set(field.key, next)} />;
        }
        if (field.type === "list") {
          const items = Array.isArray(value[field.key]) ? (value[field.key] as string[]) : [];
          return (
            <label key={field.key} className="cmo-field" htmlFor={id}>
              <span>{field.label} <small>One per line</small></span>
              <textarea id={id} rows={Math.max(3, items.length + 1)} value={items.join("\n")} onChange={(e) => set(field.key, e.target.value.split("\n"))} />
            </label>
          );
        }
        const text = typeof value[field.key] === "string" ? (value[field.key] as string) : "";
        const hint = FIELD_HINTS[field.key];
        return (
          <label key={field.key} className="cmo-field" htmlFor={id}>
            <span>{field.label}{hint ? <> <small>{hint}</small></> : null}</span>
            {field.type === "long" ? (
              <textarea id={id} rows={field.key === "content_plan" ? 12 : 4} value={text} onChange={(e) => set(field.key, e.target.value)} />
            ) : (
              <input id={id} type="text" value={text} onChange={(e) => set(field.key, e.target.value)} />
            )}
          </label>
        );
      })}
    </div>
  );
}

/** Markdown của một document — cho Copy và Download. */
export function documentMarkdown(kind: DocumentKind, value: Body): string {
  const doc = DOCUMENTS[kind];
  const lines: string[] = [`# ${doc.title}`, ""];
  const walk = (fields: Field[], body: Body, depth: number) => {
    for (const field of fields) {
      const v = body[field.key];
      const heading = `${"#".repeat(Math.min(6, depth))} ${field.label}`;
      if (field.type === "group") {
        const rows = Array.isArray(v) ? (v as Body[]) : [];
        if (!rows.length) continue;
        lines.push(heading, "");
        rows.forEach((row, i) => {
          const [first, ...rest] = field.fields;
          lines.push(`${"#".repeat(Math.min(6, depth + 1))} ${(first && str(row[first.key])) || `${field.label} ${i + 1}`}`, "");
          walk(rest, row, depth + 2);
        });
      } else if (field.type === "list") {
        const items = list(v);
        if (!items.length) continue;
        lines.push(heading, "", ...items.map((item) => `- ${item}`), "");
      } else if (str(v)) {
        lines.push(heading, "", str(v), "");
      }
    }
  };
  walk(doc.fields, value, 2);
  return `${lines.join("\n").trim()}\n`;
}

/** A set of fixed values, any of them: one checkbox each (Post plan's channels). */
export function Choices({ field, value, onChange }: { field: Extract<Field, { type: "choices" }>; value: unknown; onChange: (next: string[]) => void }) {
  const picked = new Set(list(value));
  return (
    <fieldset className="cmo-group">
      <legend>{field.label}</legend>
      {field.options.map((o) => (
        <label key={o.value} className="cmo-field">
          <input
            type="checkbox"
            checked={picked.has(o.value)}
            onChange={(e) => onChange(field.options.map((x) => x.value).filter((v) => (v === o.value ? e.target.checked : picked.has(v))))}
          />{" "}
          {o.label}
        </label>
      ))}
    </fieldset>
  );
}
