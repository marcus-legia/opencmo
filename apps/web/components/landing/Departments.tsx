import { DEPTS } from "./data";
import { LogoMark, SocialTile } from "./Glyphs";
import { SOCIAL, type SocialKey } from "./icons";
import { PixelBot } from "./PixelBot";

/** Every platform a department works on, once each, in the order the departments list them. */
const PLATFORMS: SocialKey[] = Array.from(new Set(DEPTS.flatMap((d) => d.channels)));

function Hub({ label }: { label: string }) {
  return (
    <div className="lv-hub">
      <span className="lv-hub-mark"><LogoMark size={26} /></span>
      <span className="lv-hub-text"><b>OpenCMO</b><small>{label}</small></span>
    </div>
  );
}

/**
 * OpenCMO at the top, wired out to every platform it works on. The wires are CSS
 * stripes whose packets flow downward; each row of tiles hangs from its own bus, and a
 * spine through the middle joins the rows (see `.lv-fan` in landing.css).
 */
export function Channels() {
  return (
    <section aria-labelledby="channels-title" className="lv-org-section">
      <div className="lv-container lv-org-head">
        <p data-rise="1" className="lv-eyebrow">One CMO, every channel</p>
        <h2 id="channels-title" className="lv-h2 is-md">
          <span className="lv-mask"><span data-h="1">Everywhere your</span></span>
          <span className="lv-mask"><span data-h="1" className="lv-accent">customers already are.</span></span>
        </h2>
      </div>
      <div className="lv-container lv-org">
        <Hub label="Your AI CMO" />
        <span aria-hidden="true" className="lv-wire is-v is-trunk" />
        <div className="lv-fan">
          <span aria-hidden="true" className="lv-fan-spine" />
          <ul aria-label="Platforms">
            {PLATFORMS.map((k) => (
              <li key={k}>
                <span aria-hidden="true" className="lv-wire is-v" />
                {/* Reveal the tile, not the <li>: the <li> carries its slice of the bus. */}
                <span data-rise="1" className="lv-fan-tile">
                  <SocialTile k={k} size={52} radius={4} title={false} />
                  <span>{SOCIAL[k].name}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

/**
 * The org chart: the AI CMO at the top branches into the three departments, each one a
 * pixel robot with the result it answers for. `#departments` is linked from the
 * marketing nav, so the id stays.
 */
export function Departments() {
  return (
    <section id="departments" aria-labelledby="dept-title" className="lv-org-section">
      <div className="lv-container lv-org-head">
        <p data-rise="1" className="lv-eyebrow">Your marketing team</p>
        <h2 id="dept-title" className="lv-h2 is-md">
          <span className="lv-mask"><span data-h="1">Three departments.</span></span>
          <span className="lv-mask"><span data-h="1" className="lv-accent">Each answers for one result.</span></span>
        </h2>
        <p data-rise="1" className="lv-lede">The AI CMO sets the plan, each department owns one result, and you decide what goes out.</p>
      </div>
      <div className="lv-container lv-org">
        <Hub label="Sets the plan" />
        <span aria-hidden="true" className="lv-wire is-v is-trunk" />
        <ol className="lv-tree">
          {DEPTS.map((d, i) => (
            <li key={d.id}>
              <span aria-hidden="true" className="lv-wire is-v" />
              <div data-rise="1" className="lv-tree-node">
                <PixelBot delay={i * 0.4} />
                <p className="lv-tree-name"><span className="lv-numeral">{d.numeral}</span>{d.name}</p>
                <h3 className="lv-tree-goal">{d.goal}</h3>
                <p className="lv-tree-result">{d.result}</p>
                <span className="lv-chips">
                  {d.channels.map((c) => <SocialTile key={c} k={c} size={24} radius={4} />)}
                </span>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
