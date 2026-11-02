"use client";

import type { ReactNode } from "react";

export function Toggle({
  checked,
  onChange,
  children,
  disabled,
  title,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  children: ReactNode;
  disabled?: boolean;
  /** Why it is disabled, when it is. */
  title?: string;
}) {
  return (
    <button type="button" role="switch" aria-checked={checked} className="v2-toggle" disabled={disabled} title={title} onClick={() => onChange(!checked)}>
      <span className="v2-toggle-track" aria-hidden="true" />
      <span>{children}</span>
    </button>
  );
}
