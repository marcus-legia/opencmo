/**
 * The feed's three columns (Main.dc.html): Context · feed · CMO chat. The two side columns are resizable by their
 * sashes (drag, arrows, Enter to reset); the feed takes what is left. Widths live in CSS variables on <html> so a drag
 * re-renders nothing, and `TODAY_COLUMNS_BOOT` sets them before the first frame, as the theme boot does.
 */
export const LEFT = { min: 220, max: 420, base: 288 } as const;
export const CHAT = { min: 300, max: 600, base: 380 } as const;

export const KEY = "opencmo.today.columns";

export type TodayColumns = { left: number; chat: number };
export const DEFAULT_COLUMNS: TodayColumns = { left: LEFT.base, chat: CHAT.base };

export const clamp = (value: number, range: { min: number; max: number }) => Math.round(Math.min(range.max, Math.max(range.min, value)));

export function parseColumns(raw: string | null): TodayColumns {
  try {
    const value = JSON.parse(raw ?? "null") as Partial<TodayColumns> | null;
    return {
      left: clamp(Number.isFinite(value?.left) ? Number(value?.left) : LEFT.base, LEFT),
      chat: clamp(Number.isFinite(value?.chat) ? Number(value?.chat) : CHAT.base, CHAT),
    };
  } catch {
    return DEFAULT_COLUMNS;
  }
}

export function applyColumns(columns: TodayColumns): void {
  const root = document.documentElement;
  root.style.setProperty("--td-col-left", `${columns.left}px`);
  root.style.setProperty("--td-col-chat", `${columns.chat}px`);
}

/** Inline, before the first frame (`app/app/layout.tsx`): hand-written ES5 that mirrors `parseColumns`. */
export const TODAY_COLUMNS_BOOT =
  `try{var t=JSON.parse(localStorage.getItem('${KEY}')||'null')||{},q=function(v,a,b,d){v=typeof v=='number'&&isFinite(v)?v:d;return Math.round(Math.min(b,Math.max(a,v)))},s=document.documentElement.style;` +
  `s.setProperty('--td-col-left',q(t.left,${LEFT.min},${LEFT.max},${LEFT.base})+'px');s.setProperty('--td-col-chat',q(t.chat,${CHAT.min},${CHAT.max},${CHAT.base})+'px')}catch(e){}`;

