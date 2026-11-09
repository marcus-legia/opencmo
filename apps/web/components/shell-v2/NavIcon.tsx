import { Icon, type IconName } from "@/components/icons";

/** Rail icons (Lucide), shown beside every label and alone when the rail is the 56 px strip. */
const ICON_OF: Record<string, IconName> = {
  "/app": "inbox",
  "/app/writer": "pencil",
  "/app/studio": "film",
  "/app/schedule": "calendar",
  "/app/sales": "message-circle",
  "/app/library": "file-text",
  "/app/research": "search",
  "/app/analytics": "chart-column",
  "/app/brain": "sparkles",
  "/app/editor": "scissors",
  "/app/settings": "settings",
};

export function NavIcon({ href }: { href: string }) {
  return <Icon name={ICON_OF[href] ?? "layers"} size={16} className="v2-rail-icon" />;
}
