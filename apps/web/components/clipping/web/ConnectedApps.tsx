"use client";

/**
 * Apps connected through OpenCMO's OAuth server (claude.ai's connector, other MCP clients): the
 * consent screen (`/oauth/consent`) promises they can be disconnected here. Disconnecting revokes
 * both Supabase's grant and ours (`mcp_grants`, which the MCP server checks on every request), so
 * the app's token stops working on its next request. A connection with no grant of ours (made
 * before grants existed) no longer works over MCP: it says so, and disconnecting then connecting
 * again fixes it. Shown only where the OAuth server
 * is on: without it there is nothing to list or to promise. A free account sees the upgrade path
 * (connecting is a paid-plan feature) and can still disconnect what it connected before.
 */

import { useEffect, useState } from "react";

import { createClient } from "@/lib/supabase/client";

import { Skeleton } from "../Skeleton";

import { PaidPlanNote } from "./PaidPlanNote";

type Grant = { client: { id: string; name: string; uri: string }; scopes: string[]; granted_at: string; active: boolean };

const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

export function ConnectedApps({ paid = false }: { paid?: boolean } = {}) {
  const [grants, setGrants] = useState<Grant[] | null>(null);
  const [available, setAvailable] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    const supabase = createClient();
    const { data, error: failed } = await supabase.auth.oauth.listGrants();
    if (failed) {
      setAvailable(false);
      return;
    }
    const { data: ours } = await supabase.from("mcp_grants").select("client_id").is("revoked_at", null);
    const active = new Set(((ours ?? []) as { client_id: string }[]).map((row) => row.client_id));
    setGrants(((data ?? []) as Omit<Grant, "active">[]).map((grant) => ({ ...grant, active: active.has(grant.client.id) })));
  };

  useEffect(() => {
    void load();
  }, []);

  const disconnect = async (grant: Grant) => {
    setError(null);
    const supabase = createClient();
    // Ours first: it is the one the MCP server checks, so the app stops even if Supabase's call fails.
    const { error: ours } = await supabase.rpc("mcp_grant_revoke", { p_client_id: grant.client.id });
    const { error: failed } = await supabase.auth.oauth.revokeGrant({ clientId: grant.client.id });
    if (ours || failed) setError("Could not disconnect it. Please try again.");
    await load();
  };

  if (!available) return null;
  return (
    <div className="settings-card" data-testid="connected-apps">
      <h2>Connected apps</h2>
      <p>Apps you allowed to use OpenCMO as you, such as Claude. Disconnect one to stop it at once.</p>
      {paid ? null : <PaidPlanNote />}
      {error ? (
        <p className="field-error" role="alert">
          {error}
        </p>
      ) : null}
      {grants === null ? (
        <Skeleton height={40} radius="var(--ds-radius-lg)" />
      ) : grants.length ? (
        <ul className="connected-app-list" data-testid="connected-app-list">
          {grants.map((grant) => (
            <li key={grant.client.id}>
              <strong>{grant.client.name || "An app"}</strong>
              <span>{grant.active ? `connected ${day(grant.granted_at)}` : "needs reconnecting: disconnect it, then connect again"}</span>
              <button type="button" className="link-button" onClick={() => void disconnect(grant)} data-testid={`connected-app-disconnect-${grant.client.id}`}>
                Disconnect
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="field-hint">No apps connected.</p>
      )}
    </div>
  );
}
