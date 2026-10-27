import "server-only";

import type { SupabaseClient } from "@/lib/api/handler";

import type { ScreenData, ScreenName } from "./registry";

export type LoadContext = { supabase: SupabaseClient; userId: string; params: URLSearchParams };

type Loader<N extends ScreenName> = (ctx: LoadContext) => Promise<Partial<ScreenData<N>>>;

/**
 * Live readers, one per screen, under the founder's RLS session (no service role). A loader returns only the
 * fields it reads for real; `registry.ts` `live` must list them too before they replace sample data.
 * Brain plan W1-5 fills these as each backend phase lands.
 */
export const LOADERS: { [N in ScreenName]?: Loader<N> } = {};
