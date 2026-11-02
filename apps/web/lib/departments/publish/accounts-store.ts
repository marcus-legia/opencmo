/**
 * The Supabase side of `accounts.ts`. Reads and the founder's own remove run under their RLS session; the two
 * saves (`zernio_profile_save`, `social_account_save`) are service-role only (A0) and are called only after
 * Zernio confirmed the profile or account is this founder's.
 */

import "server-only";

import { rpcOrThrow, type SupabaseClient } from "@/lib/api/handler";
import { apiErrorFromPostgrest } from "@/lib/api/errors";
import { createAdminClient } from "@/lib/supabase/admin";

import type { AccountsStore } from "./accounts";
import { isPublishPlatform } from "./types";

export function accountsStore(supabase: SupabaseClient): AccountsStore {
  return {
    async profileId(userId) {
      const { data, error } = await supabase.from("zernio_profiles").select("zernio_profile_id").eq("user_id", userId).maybeSingle();
      if (error) throw apiErrorFromPostgrest(error);
      return (data?.zernio_profile_id as string | undefined) ?? null;
    },
    async saveProfile(userId, zernioProfileId) {
      const { error } = await createAdminClient().rpc("zernio_profile_save", { p_user: userId, p_profile: zernioProfileId });
      if (error) throw apiErrorFromPostgrest(error);
    },
    async saveAccount(userId, account) {
      const { data, error } = await createAdminClient().rpc("social_account_save", {
        p_user: userId,
        p_platform: account.platform,
        p_handle: account.handle,
        p_avatar_url: account.avatarUrl,
        p_zernio_account_id: account.zernioAccountId,
      });
      if (error) throw apiErrorFromPostgrest(error);
      const row = (Array.isArray(data) ? data[0] : data) as { id: string } | null;
      return { id: row?.id ?? "" };
    },
    async account(id) {
      const { data, error } = await supabase.from("social_accounts").select("id, platform, zernio_account_id").eq("id", id).maybeSingle();
      if (error) throw apiErrorFromPostgrest(error);
      if (!data || !isPublishPlatform(String(data.platform))) return null;
      return { id: String(data.id), platform: data.platform, zernioAccountId: String(data.zernio_account_id) };
    },
    async removeAccount(id) {
      await rpcOrThrow(supabase, "social_account_remove", { p_id: id });
    },
  };
}
