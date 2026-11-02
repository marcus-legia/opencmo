import type { ReactNode } from "react";

/** The uppercase mono label of the frames; `mark` adds the brand square, `live` makes it pulse. */
export function MonoLabel({
  children,
  small,
  muted,
  mark,
  live,
  as: Tag = "span",
  id,
}: {
  children: ReactNode;
  small?: boolean;
  muted?: boolean;
  mark?: boolean;
  live?: boolean;
  as?: "span" | "h2" | "h3" | "p";
  id?: string;
}) {
  const className = ["v2-mono", small && "is-small", muted && "is-muted"].filter(Boolean).join(" ");
  return (
    <Tag id={id} className={className} style={mark ? { display: "flex", alignItems: "center", gap: 10, margin: 0 } : { margin: 0 }}>
      {mark ? <span className={`v2-mark${small ? " is-small" : ""}${live ? " is-live" : ""}`} aria-hidden="true" /> : null}
      {children}
    </Tag>
  );
}
