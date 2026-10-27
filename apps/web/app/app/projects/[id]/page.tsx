import { permanentRedirect } from "next/navigation";

import { ProjectView } from "@/components/clipping/web/ProjectView";
import { UI_V2 } from "@/components/screens/flag";
import { studioItemHref } from "@/components/screens/studio/href";

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Studio's item drawer replaces the project page (U7b).
  if (UI_V2) permanentRedirect(studioItemHref(id));
  return <ProjectView projectId={id} />;
}
