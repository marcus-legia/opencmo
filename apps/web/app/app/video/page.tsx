import { redirect } from "next/navigation";

/** The old "New clips" page. Old links and bookmarks land on the editor's Upload tab. */
export default function NewVideoPage() {
  redirect("/app/editor?panel=upload");
}
