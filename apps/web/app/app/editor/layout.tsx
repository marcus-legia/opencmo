import { notFound } from "next/navigation";

import { editorLive } from "@/lib/editor-flag";

/** The editor is off in production for now (`lib/editor-flag.ts`): this route 404s there. */
export default function EditorRouteLayout({ children }: { children: React.ReactNode }) {
  if (!editorLive()) notFound();
  return children;
}
