import { notFound, withApi } from "@/lib/api/handler";
import { isProduction } from "@/lib/production";
import { UI_V2 } from "@/lib/screens/flag";
import { SCREEN_NAMES, SCREENS, released, type ScreenName } from "@/lib/screens/registry";

export const dynamic = "force-dynamic";

/**
 * Which v2 screens the rail may show (`live`), and which fields of each read real rows (`screens`). Static (no loader runs): the rail
 * asks once per page load. In production a screen is shown only once released; elsewhere every screen shows.
 */
export const GET = withApi({}, async () => {
  if (!UI_V2) throw notFound();
  const production = isProduction();
  const screens = Object.fromEntries(
    SCREEN_NAMES.map((name: ScreenName) => [name, { available: !production || released(name), live: SCREENS[name].live }]),
  );
  // `live` is the rail's shape (`components/shell-v2/useScreensLive.ts`): may this screen show here.
  const live = Object.fromEntries(SCREEN_NAMES.map((name) => [name, !production || released(name)]));
  return { screens, live };
});
