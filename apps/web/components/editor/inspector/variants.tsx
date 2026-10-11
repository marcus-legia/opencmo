"use client";

import { generationMatches, type Manifest } from "../media";
import { Row, Section } from "./controls";
import type { InspectorContext } from "./shared";

type Declaration = Record<string, unknown> & { seed?: number };

/** The shown AI image and the variants kept in `marks.variants`, in a stable order (by seed). */
export function variantsOf(node: Record<string, unknown>): { shown: Declaration; all: Declaration[] } | null {
  const variants = (node.marks as { variants?: Declaration[] } | undefined)?.variants;
  if (!variants?.length) return null;
  const paint = ((node.paints as { src?: unknown }[] | undefined) ?? []).find((item) => (item.src as Declaration | undefined)?.generate === "image");
  const shown = paint?.src as Declaration | undefined;
  if (!shown) return null;
  return { shown, all: [shown, ...variants].sort((a, b) => Number(a.seed ?? 0) - Number(b.seed ?? 0)) };
}

function stateOf(declaration: Declaration, manifest: Manifest): "ready" | "pending" | "failed" {
  const record = (manifest?.assets ?? []).find((item) => item && typeof item === "object" && generationMatches(declaration, item));
  if (!record || record.state === "pending") return "pending";
  return record.state === "error" ? "failed" : "ready";
}

/** Pick which variant of an AI image is shown; the others stay in the library. */
export function VariantsSection({ ctx }: { ctx: InspectorContext }) {
  const found = variantsOf(ctx.node);
  if (!found) return null;
  return (
    <Section title="Variants" testid="variant-strip">
      <Row label="Show">
        <div className="ed2-variants">
          {found.all.map((declaration, index) => {
            const current = declaration === found.shown;
            const state = stateOf(declaration, ctx.manifest);
            return (
              <button
                key={String(declaration.seed)}
                type="button"
                className="ed2-variant"
                aria-pressed={current}
                disabled={current || state === "failed"}
                data-testid={`variant-${declaration.seed}`}
                title={state === "pending" ? "Still generating" : state === "failed" ? "This variant failed" : current ? "Shown on the clip" : "Show this variant"}
                onClick={() => ctx.edit([{ op: "pick_variant", element_id: String(ctx.node.id), seed: declaration.seed }])}
              >
                {index + 1}
                {state === "pending" ? "…" : state === "failed" ? " ✕" : ""}
              </button>
            );
          })}
        </div>
      </Row>
    </Section>
  );
}
