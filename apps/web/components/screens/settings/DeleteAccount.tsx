"use client";

import { useState } from "react";

import { ApiError, api, jsonBody } from "@/components/clipping/api";
import { Button, Field } from "@/components/ui";
import { SUPPORT_EMAIL } from "@/lib/site";

/** The refusal `account_delete` gives while a plan still renews; the founder gets a link to Billing beside it. */
const CANCEL_FIRST = "Cancel your plan first, on the Billing page. Then you can delete your account.";

/**
 * Delete my account (wave 4 C3, owner decision 2 default): the founder types their email back, the route runs
 * `account_delete` and removes the sign-in, and the landing page says it is done. SQL's refusals are shown as they are.
 * Export is by email to support, said on the same card.
 */
export function DeleteAccount({ email }: { email: string | null }) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const matches = email !== null && typed.trim().toLowerCase() === email.toLowerCase();

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await api("/account/delete", jsonBody({ email: typed.trim() }));
      window.location.assign("/?deleted=1");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not delete the account. Please try again.");
      setBusy(false);
    }
  }

  return (
    <div className="v2-panel-body scr-small scr-delete" data-testid="settings-delete-account">
      <p style={{ margin: "0" }}>
        To get a copy of your data, email <a href={`mailto:${SUPPORT_EMAIL}?subject=Export%20my%20data`}>{SUPPORT_EMAIL}</a> from this address before you
        delete the account.
      </p>
      {!open ? (
        <div>
          <Button variant="secondary" onClick={() => setOpen(true)}>
            Delete my account
          </Button>
        </div>
      ) : (
        <form
          style={{ display: "flex", flexDirection: "column", gap: "10px" }}
          onSubmit={(e) => {
            e.preventDefault();
            if (matches && !busy) void remove();
          }}
        >
          <p style={{ margin: "0" }}>
            This deletes your business documents, the people Sales found, your drafts, posts, videos and connected accounts. It cannot be undone.
          </p>
          <Field
            label={
              <>
                Type <b>{email ?? "your email"}</b> to confirm
              </>
            }
            type="email"
            autoComplete="off"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
          />
          {error ? (
            <p role="alert" className="scr-delete-error" style={{ margin: "0" }}>
              {error}
              {error === CANCEL_FIRST ? (
                <>
                  {" "}
                  <a href="/app/billing">Open Billing</a>
                </>
              ) : null}
            </p>
          ) : null}
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", justifyContent: "flex-end" }}>
            <Button
              variant="secondary"
              onClick={() => {
                setOpen(false);
                setTyped("");
                setError(null);
              }}
            >
              Keep my account
            </Button>
            <Button type="submit" variant="danger" disabled={!matches || busy}>
              {busy ? "Deleting…" : "Delete my account"}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
