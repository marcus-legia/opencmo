"use client";

/**
 * One reason picked from `DRAFT_REASONS` (cmo-review-3 2.1): on Skip, and once, optional, on an edited approve
 * ("What did you fix?"). Picking a chip again clears it. The same sheet of chips rates drafts (2.2).
 */

import { DRAFT_REASONS, type DraftReason } from "./labels";

export function ReasonChips({
  label,
  value,
  onChange,
  only,
  disabled,
}: {
  label: string;
  value: DraftReason | null;
  onChange: (code: DraftReason | null) => void;
  /** The codes to offer; all of them by default. */
  only?: readonly DraftReason[];
  disabled?: boolean;
}) {
  const reasons = only ? DRAFT_REASONS.filter((r) => only.includes(r.code)) : DRAFT_REASONS;
  return (
    <div className="v2-reasons" role="group" aria-label={label}>
      <span className="v2-reasons-label">{label}</span>
      <div className="v2-reasons-list">
        {reasons.map((reason) => (
          <button
            key={reason.code}
            type="button"
            className="v2-reason"
            aria-pressed={value === reason.code}
            disabled={disabled}
            data-reason={reason.code}
            onClick={() => onChange(value === reason.code ? null : reason.code)}
          >
            {reason.label}
          </button>
        ))}
      </div>
    </div>
  );
}
