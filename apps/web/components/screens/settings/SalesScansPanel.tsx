"use client";

import { useEffect, useState } from "react";

import { api, jsonBody } from "@/components/clipping/api";
import { CADENCE_LABEL, SCAN_CADENCES, type Cadence } from "@/lib/cmo/funnel-view";

import { Panel } from "../parts";

/**
 * Settings › Sales scans (wave 3, C6): how often Sales scans on its own (A5's `sales_settings.cadence`), Monday,
 * Wednesday and Friday by default. Scan now on the Sales page works any day; where Sales looks stays on its own tab.
 */
export function SalesScansPanel() {
  const [cadence, setCadence] = useState<Cadence | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    api<{ cadence: Cadence }>("/sales/settings")
      .then((r) => alive && setCadence(r.cadence))
      .catch(() => alive && setNote("Your scan days could not be read. Reload to try again."));
    return () => {
      alive = false;
    };
  }, []);

  async function change(next: Cadence) {
    const was = cadence;
    setCadence(next);
    setBusy(true);
    setNote(null);
    try {
      const saved = await api<{ cadence: Cadence }>("/sales/settings", jsonBody({ cadence: next }));
      setCadence(saved.cadence);
      setNote("Saved.");
    } catch (err) {
      setCadence(was);
      setNote(err instanceof Error ? err.message : "Could not save. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel id="settings-sales-scans" title="Sales scans">
      <div className="v2-panel-body scr-form" data-testid="settings-sales-scans">
        <label className="v2-field" htmlFor="scan-cadence">
          When Sales scans on its own
          <select id="scan-cadence" className="v2-input" value={cadence ?? ""} disabled={cadence === null || busy} onChange={(e) => void change(e.target.value as Cadence)}>
            {cadence === null ? <option value="">Loading…</option> : null}
            {SCAN_CADENCES.map((c) => (
              <option key={c} value={c}>
                {CADENCE_LABEL[c]}
              </option>
            ))}
          </select>
        </label>
        <p className="scr-small scr-muted" style={{ margin: "0" }}>
          Scans are part of your plan&apos;s monthly allowance. You can still press Scan now on the Sales page any day. Where Sales looks is in Sales › Settings.
        </p>
        {note ? (
          <p role="status" className="scr-small" style={{ margin: "0" }}>
            {note}
          </p>
        ) : null}
      </div>
    </Panel>
  );
}
