import { redirect } from "next/navigation";

/**
 * The old "New clips" page. Clipping is the Clips tab of the editor (G1-c); old links and bookmarks
 * land there, with a link and picked moments carried over (contract A1).
 */
export default async function NewClipsPage({
  searchParams,
}: {
  searchParams: Promise<{ url?: string; source?: string; segments?: string; picker?: string }>;
}) {
  redirect(clipsHref(await searchParams));
}

function clipsHref(params: { url?: string; source?: string; segments?: string; picker?: string }): string {
  const keep = new URLSearchParams({ panel: "clips" });
  const source = params.source ?? params.url;
  if (source) keep.set("source", source);
  if (params.segments) keep.set("segments", params.segments);
  if (params.picker === "open" || source) keep.set("picker", "open");
  return `/app/editor?${keep.toString()}`;
}
