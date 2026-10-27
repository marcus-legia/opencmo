import { permanentRedirect } from "next/navigation";

import { studioItemHref } from "@/components/screens/studio/href";

/**
 * Old `/app/jobs/<id>` links (the cloud version before D3) move for good to the upload's page.
 * 308, not 307: this route never comes back, and bookmarks and shared links should update.
 */
export default async function LegacyJobPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  // With the redesign on this goes straight to Studio's item drawer, not through a second redirect.
  permanentRedirect(studioItemHref(id));
}
