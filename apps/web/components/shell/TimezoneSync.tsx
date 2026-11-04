"use client";

import { useEffect } from "react";

import { createClient } from "@/lib/supabase/client";

const KEY = "opencmo.tz-sent";

/**
 * Sends the browser's time zone once per browser (cmo-review B1.7). Slots, the digest hour and best time run in
 * `profiles.timezone`, which starts as 'UTC'; `profile_timezone_detect` writes the zone only while the founder never
 * chose one, so this can never overwrite Settings. Nothing is shown: a failure just tries again on the next load.
 */
export function TimezoneSync() {
  useEffect(() => {
    let zone: string | undefined;
    try {
      zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (!zone || localStorage.getItem(KEY) === zone) return;
    } catch {
      return;
    }
    void createClient()
      .rpc("profile_timezone_detect", { p_timezone: zone })
      .then(({ error }) => {
        if (!error) {
          try {
            localStorage.setItem(KEY, zone!);
          } catch {
            // Private mode: it is sent again next time, and the RPC is a no-op then.
          }
        }
      });
  }, []);
  return null;
}
