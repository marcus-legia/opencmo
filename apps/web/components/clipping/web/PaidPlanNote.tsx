import Link from "next/link";

/** The upgrade path shown where a free account would connect Claude (API keys, Connected apps). */
export function PaidPlanNote() {
  return (
    <p className="field-hint" data-testid="mcp-paid-plan">
      <strong>Connect Claude with a paid plan.</strong> <Link href="/app/billing">See plans</Link>
    </p>
  );
}
