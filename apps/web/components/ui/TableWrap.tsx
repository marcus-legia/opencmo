import type { ReactNode } from "react";

/**
 * Wraps a table that may scroll sideways on a phone. A scrolling region must be reachable by keyboard (axe
 * `scrollable-region-focusable`), so it is a focusable, labelled region.
 */
export function TableWrap({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="v2-table-wrap" role="region" aria-label={label} tabIndex={0}>
      {children}
    </div>
  );
}
