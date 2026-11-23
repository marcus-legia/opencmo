import { parseIdea } from "@/lib/cmo/idea";

const BULB = "M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2Z";
const CHECK = "M20 6 9 17l-5-5";

/**
 * A reply idea as the founder reads it (owner, 2026-11-23): the IDEA in bold amber, the SOLUTION in bold green, and
 * under each, in italics, the words they could say. Both keywords always show.
 */
export function IdeaDraft({ draft, compact = false }: { draft: string; compact?: boolean }) {
  const parts = parseIdea(draft);
  if (!parts.length) return null;
  return (
    <div className="idea-box" data-testid="idea-draft" style={compact ? { padding: "12px 14px" } : undefined}>
      {parts.map((part, i) => (
        <div key={i} style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          <div className="idea-line">
            <span className="idea-key" data-k={part.kind}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d={part.kind === "idea" ? BULB : CHECK} />
              </svg>
              {part.kind === "idea" ? "Idea" : "Solution"}
            </span>
            {part.text ? (
              <span className="idea-text" data-k={part.kind}>
                {part.text}
              </span>
            ) : (
              <span className="idea-text" data-k={part.kind} data-empty="">
                Yours to add
              </span>
            )}
          </div>
          {part.say.map((line) => (
            <p key={line} className="idea-say" data-k={part.kind}>
              “{line}”
            </p>
          ))}
        </div>
      ))}
    </div>
  );
}
