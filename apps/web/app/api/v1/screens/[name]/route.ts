import { notFound, withApi } from "@/lib/api/handler";
import { isProduction } from "@/lib/production";
import { UI_V2 } from "@/lib/screens/flag";
import { LOADERS } from "@/lib/screens/load";
import { compose, isScreenName, released, type ScreenName } from "@/lib/screens/registry";

export const dynamic = "force-dynamic";

/**
 * `{ data, live }` for one v2 screen: live fields from the loader, the rest from the fixture (never in
 * production, where they are empty). `?sample=1` returns the pure fixture outside production, for look checks.
 */
export const GET = withApi({}, async ({ request, supabase, user, params }) => {
  const name = params.name ?? "";
  if (!UI_V2 || !isScreenName(name)) throw notFound();
  const production = isProduction();
  if (production && !released(name)) throw notFound();
  const search = request.nextUrl.searchParams;
  const sample = search.get("sample") === "1";
  const loader = LOADERS[name] as ((ctx: Parameters<NonNullable<(typeof LOADERS)[ScreenName]>>[0]) => Promise<object>) | undefined;
  const loaded = loader && !sample ? await loader({ supabase, userId: user.id, params: search }) : {};
  return compose(name, loaded, { production, sample });
});
