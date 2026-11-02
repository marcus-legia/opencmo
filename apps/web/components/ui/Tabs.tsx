"use client";

import { useRef } from "react";
import type { KeyboardEvent } from "react";

export type TabItem<T extends string> = { id: T; label: string };

/**
 * Underlined tabs with the WAI-ARIA keyboard pattern (arrows, Home, End). The caller renders the panel and gives it
 * `id={`${idBase}-panel`}` and `aria-labelledby={`${idBase}-${value}`}`; tabs that filter a page without one panel
 * pass `panel={false}`, so no `aria-controls` points at a missing element.
 */
export function Tabs<T extends string>({
  label,
  items,
  value,
  onChange,
  idBase,
  large,
  panel = true,
}: {
  label: string;
  items: TabItem<T>[];
  value: T;
  onChange: (value: T) => void;
  idBase: string;
  large?: boolean;
  panel?: boolean;
}) {
  const list = useRef<HTMLDivElement>(null);

  function onKey(event: KeyboardEvent<HTMLDivElement>) {
    const index = items.findIndex((item) => item.id === value);
    const next =
      event.key === "ArrowRight" ? (index + 1) % items.length
      : event.key === "ArrowLeft" ? (index - 1 + items.length) % items.length
      : event.key === "Home" ? 0
      : event.key === "End" ? items.length - 1
      : -1;
    if (next < 0) return;
    event.preventDefault();
    onChange(items[next].id);
    list.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
  }

  return (
    <div ref={list} role="tablist" aria-label={label} className={large ? "v2-tabs is-large" : "v2-tabs"} onKeyDown={onKey}>
      {items.map((item) => {
        const selected = item.id === value;
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            id={`${idBase}-${item.id}`}
            aria-selected={selected}
            aria-controls={panel ? `${idBase}-panel` : undefined}
            tabIndex={selected ? 0 : -1}
            className="v2-tab"
            onClick={() => onChange(item.id)}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
