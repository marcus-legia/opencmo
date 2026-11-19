"use client";

import { useEffect, useState } from "react";

/**
 * The one line a founder reads after "Delete my account" (wave 4 C3): the app sends them to `/?deleted=1`. Read in the
 * browser so the landing page itself stays the same for everyone; the flag is dropped from the address once shown.
 */
export function DeletedNotice() {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("deleted") !== "1") return;
    setShown(true);
    url.searchParams.delete("deleted");
    window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
  }, []);
  if (!shown) return null;
  return (
    <p role="status" data-testid="account-deleted" style={{ margin: "0", padding: "12px 16px", textAlign: "center", fontSize: "15px", background: "#e3f3ec", color: "#14583c" }}>
      Your account is deleted. Thank you for trying Ferreto.
    </p>
  );
}
