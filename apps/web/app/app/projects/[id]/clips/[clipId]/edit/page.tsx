import { redirect } from "next/navigation";

/** Old editor links (bookmarks, earlier emails) → `/app/editor/<clip>` (E0). */
export default async function EditClipPage({ params }: { params: Promise<{ id: string; clipId: string }> }) {
  const { clipId } = await params;
  redirect(`/app/editor/${clipId}`);
}
