import { permanentRedirect } from "next/navigation";

import { LibraryView } from "@/components/clipping/web/LibraryView";
import { UI_V2 } from "@/components/ui/flag";

export default async function ProjectsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  // Studio replaces My projects (U7b). The redirect stays for bookmarks and old emails.
  if (UI_V2) {
    const { q } = await searchParams;
    permanentRedirect(typeof q === "string" && q ? `/app/studio?q=${encodeURIComponent(q.slice(0, 200))}` : "/app/studio");
  }
  return <LibraryView />;
}
