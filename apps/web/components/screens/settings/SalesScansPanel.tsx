"use client";

import { useEffect, useState } from "react";

import { api, jsonBody } from "@/components/clipping/api";
import { CADENCE_LABEL, SCAN_CADENCES, type Cadence } from "@/lib/cmo/funnel-view";

import { Panel } from "../parts";

/**
 * Settings › Sales scans (wave 3, C6): how often Sales scans on its own (A5's `sales_settings.cadence`), Monday,
 * Wednesday and Friday by default. Scan now on the Sales page works any day; where Sales looks stays on its own tab.
 */
const WEEK = ["M", "T", "W", "T", "F", "S", "S"];
/** The days each choice scans on, Monday = 0. */
const SCAN_DAYS: Record<Cadence, number[]> = { mwf: [0, 2, 4], weekdays: [0, 1, 2, 3, 4], monday: [0] };

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
    <Panel id="settings-sales-scans" title="Sales scans" sub="The days Sales looks for new people on its own. Scan now on the Sales page works any day.">
      <div className="v2-panel-body scr-form" data-testid="settings-sales-scans">
        {/* One choice per row, its name next to the week it scans (owner, 2026-11-25: squares alone said nothing). */}
        <div role="radiogroup" aria-label="When Sales scans on its own" data-sec="find" className="scr-cadence">
          {SCAN_CADENCES.map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              className="scr-cadence-row"
              aria-checked={cadence === c}
              disabled={cadence === null || busy}
              onClick={() => void change(c)}
              data-testid={`settings-cadence-${c}`}
            >
              <span className="scr-cadence-dot" aria-hidden="true" />
              <span className="scr-cadence-name">
                {CADENCE_LABEL[c]}
                {c === "mwf" ? <span className="scr-small scr-muted"> · recommended</span> : null}
              </span>
              <span className="scr-cadence-week" aria-hidden="true">
                {WEEK.map((d, i) => (
                  <span key={i} className="day-btn" data-on={SCAN_DAYS[c].includes(i) || undefined}>
                    {d}
                  </span>
                ))}
              </span>
            </button>
          ))}
        </div>
        {note ? (
          <p role="status" className="scr-small" style={{ margin: "0" }}>
            {note}
          </p>
        ) : null}
      </div>
    </Panel>
  );
}
