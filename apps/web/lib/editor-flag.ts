import { isProduction } from "@/lib/production";

/**
 * The video editor and AI media generation, off in production until they are finished (owner, 2026-11-22). The code
 * stays; production just cannot reach it. It also keeps the store outside Creem's Gen AI category, which requires
 * Customer Credits for every image or video generation (Creem "AI Wrapper Compliance").
 *
 * `OPENCMO_EDITOR=1` turns it back on in production. Pure, so `.check.ts` files can import it.
 */
export const editorLive = (): boolean => !isProduction() || process.env.OPENCMO_EDITOR === "1";
