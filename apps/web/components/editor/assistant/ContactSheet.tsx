"use client";

/**
 * Card 2 of a long take (`animate_video`): the keyframes in order with the words over each, so the
 * user judges the film before paying for its shots. Redo on a tile is its own small approval at its
 * own price; the card then comes back with the new keyframe and the price recomputed.
 */

import { useState } from "react";

import type { ContactSheet as Sheet } from "./client";

export function ContactSheet({ sheet, onRedo }: { sheet: Sheet; onRedo: (index: number) => void }) {
  const [asking, setAsking] = useState<number | null>(null);
  return (
    <ol className="ed2-asst-sheet" data-testid="assistant-contact-sheet">
      {sheet.tiles.map((tile) => (
        <li key={tile.index} className="ed2-asst-sheet-tile" data-garbled={tile.garbled || undefined}>
          {tile.url ? <img src={tile.url} alt={`Keyframe ${tile.index + 1}`} /> : <div className="ed2-asst-sheet-empty">No preview</div>}
          <span className="ed2-asst-sheet-number">Keyframe {tile.index + 1}</span>
          <p className="ed2-asst-sheet-words">{tile.words}</p>
          {tile.garbled ? <p className="ed2-asst-sheet-badge">This keyframe has garbled text. Redo it?</p> : null}
          {asking === tile.index ? (
            <div className="ed2-row">
              <button type="button" className="ed2-btn ed2-primary" data-testid="assistant-sheet-redo-confirm" onClick={() => onRedo(tile.index)}>
                Redo · {tile.credits} {tile.credits === 1 ? "credit" : "credits"}
              </button>
              <button type="button" className="ed2-btn" onClick={() => setAsking(null)}>
                Keep
              </button>
            </div>
          ) : (
            <button type="button" className="ed2-link" data-testid="assistant-sheet-redo" onClick={() => setAsking(tile.index)}>
              Redo
            </button>
          )}
        </li>
      ))}
    </ol>
  );
}
