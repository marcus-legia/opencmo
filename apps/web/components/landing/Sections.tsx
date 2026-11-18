import { BRAND, FIT, PAINS, PROMISES, STEPS } from "./data";
import { LineIcon } from "./Glyphs";

/** Who it is for, said plainly, including who should not sign up: a poor fit costs a refund and a churned account. */
export function FitSection() {
  return (
    <section id="fit" aria-labelledby="fit-title" className="lv-panel-section">
      <div className="lv-container lv-fit">
        <div className="lv-stack-18">
          <p data-rise="1" className="lv-eyebrow">Who it is for</p>
          <h2 id="fit-title" className="lv-h2 is-md">
            <span className="lv-mask"><span data-h="1">If this sounds</span></span>
            <span className="lv-mask"><span data-h="1" className="lv-accent">like your week</span></span>
          </h2>
        </div>
        <div className="lv-stack-26">
          <ul className="lv-pains">
            {PAINS.map((p) => (
              <li key={p} data-rise="1">{p}</li>
            ))}
          </ul>
          <p data-rise="1" className="lv-fit-line"><b>Built for</b> {FIT.good}</p>
          <p data-rise="1" className="lv-fit-line is-poor"><b>Probably a poor fit if</b> {FIT.poor}</p>
        </div>
      </div>
    </section>
  );
}

/** The five jobs from a thread to a conversation. The id stays `departments`: MarketingNav links to it. */
export function StepsSection() {
  return (
    <section id="departments" aria-labelledby="steps-title" className="lv-panel-section">
      <div className="lv-container lv-stack-40">
        <div className="lv-stack-18">
          <p data-rise="1" className="lv-eyebrow">How it works</p>
          <h2 id="steps-title" className="lv-h2 is-md">
            <span className="lv-mask"><span data-h="1">From a thread</span></span>
            <span className="lv-mask"><span data-h="1" className="lv-accent">to a conversation.</span></span>
          </h2>
        </div>
        <ol className="lv-steps">
          {STEPS.map((s, i) => (
            <li key={s.title} data-rise="1" className="lv-step">
              <span className="lv-step-icon"><LineIcon d={s.icon} size={22} width={1.8} /></span>
              <span className="lv-step-num">{String(i + 1).padStart(2, "0")}</span>
              <h3>{s.title}</h3>
              <p>{s.body}</p>
            </li>
          ))}
        </ol>
        <p data-rise="1" className="lv-fineprint">Includes the video editor, for clips from videos you record.</p>
      </div>
    </section>
  );
}

/** Assist, never act: the rules the product keeps, said where a buyer decides. */
export function PromiseSection() {
  return (
    <section aria-labelledby="promise-title" className="lv-panel-section">
      <div className="lv-container lv-fit">
        <div className="lv-stack-18">
          <p data-rise="1" className="lv-eyebrow">What {BRAND} won&apos;t do</p>
          <h2 id="promise-title" className="lv-h2 is-md">
            <span className="lv-mask"><span data-h="1">Every message</span></span>
            <span className="lv-mask"><span data-h="1" className="lv-accent">goes out from you.</span></span>
          </h2>
        </div>
        <ul className="lv-pains is-promises">
          {PROMISES.map((p) => (
            <li key={p} data-rise="1">{p}</li>
          ))}
        </ul>
      </div>
    </section>
  );
}
