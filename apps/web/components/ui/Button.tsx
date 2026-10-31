import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode } from "react";

export type ButtonVariant = "primary" | "secondary" | "quiet" | "danger" | "on-dark";

type Common = { variant?: ButtonVariant; compact?: boolean; icon?: boolean; className?: string; children: ReactNode };

function classes({ variant = "secondary", compact, icon, className }: Omit<Common, "children">) {
  return ["v2-button", `is-${variant}`, compact && "is-compact", icon && "is-icon", className].filter(Boolean).join(" ");
}

export function Button({ variant, compact, icon, className, type = "button", ...rest }: Common & ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type={type} className={classes({ variant, compact, icon, className })} {...rest} />;
}

/** A link styled as a button: navigation stays a real `<a>`. */
export function ButtonLink({ variant, compact, icon, className, href, ...rest }: Common & { href: string; target?: string; rel?: string; "aria-label"?: string }) {
  return <Link href={href} className={classes({ variant, compact, icon, className })} {...rest} />;
}
