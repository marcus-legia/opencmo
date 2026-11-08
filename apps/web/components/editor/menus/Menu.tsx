"use client";

/**
 * Menu thả xuống nhỏ gọn cho shell: mục, mục con (mở khi rê chuột hay bấm),
 * phím tắt in bên phải, mục tắt. Dùng cho menu dự án và menu chuột phải.
 * Đóng khi bấm ra ngoài hay Esc.
 */

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type MenuItem =
  | { kind?: "item"; label: string; shortcut?: string | null; disabled?: boolean; onSelect: () => void; testid?: string }
  | { kind: "sub"; label: string; items: MenuItem[]; testid?: string }
  | { kind: "separator" };

export function MenuList({ items, onClose }: { items: MenuItem[]; onClose: () => void }) {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <ul className="ed2-menu" role="menu">
      {items.map((item, index) => {
        if (item.kind === "separator") return <li key={index} className="ed2-menu-sep" role="separator" />;
        if (item.kind === "sub") {
          return (
            <li key={index} className="ed2-menu-sub" onMouseEnter={() => setOpen(index)} onMouseLeave={() => setOpen(null)}>
              <button
                type="button"
                role="menuitem"
                className="ed2-menu-item"
                aria-haspopup="menu"
                aria-expanded={open === index}
                data-testid={item.testid}
                onClick={() => setOpen(open === index ? null : index)}
              >
                <span>{item.label}</span>
                <span className="ed2-menu-key">›</span>
              </button>
              {open === index ? <MenuList items={item.items} onClose={onClose} /> : null}
            </li>
          );
        }
        return (
          <li key={index}>
            <button
              type="button"
              role="menuitem"
              className="ed2-menu-item"
              disabled={item.disabled}
              data-testid={item.testid}
              onClick={() => {
                onClose();
                item.onSelect();
              }}
            >
              <span>{item.label}</span>
              {item.shortcut ? <span className="ed2-menu-key">{item.shortcut}</span> : null}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The button and its menu. The menu is portaled to <body> at a fixed spot under the button: the top bar scrolls
 * sideways in the app shell (`overflow-x: auto`) and blurs its backdrop, so a menu drawn inside it was clipped to the
 * bar's 52 px and could not be clicked (2026-11-08).
 */
export function DropdownMenu({
  label,
  items,
  testid,
  children,
}: {
  label: string;
  items: MenuItem[];
  testid?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = box.current?.getBoundingClientRect();
      if (!rect) return;
      setAt({ x: Math.max(4, Math.min(rect.left, window.innerWidth - 228)), y: rect.bottom + 6 });
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const close = (event: Event) => {
      if (event instanceof KeyboardEvent) {
        if (event.key === "Escape") setOpen(false);
        return;
      }
      const target = event.target as Node;
      if (!box.current?.contains(target) && !layer.current?.contains(target)) setOpen(false);
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", close);
    };
  }, [open]);
  return (
    <div className="ed2-menu-root" ref={box}>
      <button
        type="button"
        className="ed2-btn"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        data-testid={testid}
        onClick={() => setOpen(!open)}
      >
        {children}
      </button>
      {open && at
        ? createPortal(
            <div ref={layer} className="ed2-context ed2-menu-layer" style={{ left: at.x, top: at.y }}>
              <MenuList items={items} onClose={() => setOpen(false)} />
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

/** Menu chuột phải tại chỗ bấm. */
export function ContextMenu({ at, items, onClose }: { at: { x: number; y: number }; items: MenuItem[]; onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (event: Event) => {
      if (event instanceof KeyboardEvent ? event.key === "Escape" : !box.current?.contains(event.target as Node)) onClose();
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", close);
    window.addEventListener("blur", onClose);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", close);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose]);
  return (
    <div ref={box} className="ed2-context" style={{ left: at.x, top: at.y }} data-testid="context-menu">
      <MenuList items={items} onClose={onClose} />
    </div>
  );
}
