"use client";

import { useEffect, useRef, useState } from "react";

import { DEMOS, type DeptId } from "./data";
import { gsap } from "./motion";

const TABS: [DeptId, string][] = [["video", "Video"], ["post", "Post"], ["sales", "Sales"]];

/** "See it work": three silent 5-second loops rebuilt from the real Editor/Dashboard UI. */
export function DemoSection() {
  const [tab, setTab] = useState<DeptId>("video");
  // The section sits below the fold; attaching `src` only near the viewport keeps the
  // MP4 out of the first page load. The poster covers the frame until then.
  const [near, setNear] = useState(false);
  const screenRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const barRef = useRef<HTMLSpanElement>(null);
  const first = useRef(true);
  const demo = DEMOS[tab];

  useEffect(() => {
    const el = screenRef.current;
    if (!el || near) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setNear(true);
          io.disconnect();
        }
      },
      { rootMargin: "400px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [near]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v || !near) return;
    // `key` follows the tab, so each tab is a fresh <video>; force `muted` (some browsers
    // ignore the attribute during hydration) and call play.
    v.muted = true;
    v.play().catch(() => {});
    if (!first.current) gsap.fromTo(v, { opacity: 0 }, { opacity: 1, duration: 0.6 });
    first.current = false;
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const d = v.duration || 5;
      if (barRef.current) barRef.current.style.transform = `scaleX(${((v.currentTime % d) / d).toFixed(4)})`;
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [tab, near]);

  return (
    <section id="demo" aria-labelledby="demo-title" className="lv-panel-section lv-demo">
      <div className="lv-container lv-stack-36">
        <div className="lv-demo-head">
          <div className="lv-stack-18">
            <p data-rise="1" className="lv-eyebrow">See it work</p>
            <h2 id="demo-title" className="lv-h2 is-md">
              <span className="lv-mask"><span data-h="1">Five seconds</span></span>
              <span className="lv-mask"><span data-h="1" className="lv-accent">per workflow.</span></span>
            </h2>
          </div>
          <div role="tablist" aria-label="Workflow" className="lv-segment">
            {TABS.map(([id, label]) => (
              <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? "is-on" : ""} onClick={() => setTab(id)}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <div data-rise="1" className="lv-demo-frame">
          <div ref={screenRef} className="lv-demo-screen">
            <video
              ref={videoRef}
              key={demo.src}
              src={near ? demo.src : undefined}
              poster={demo.poster}
              autoPlay
              muted
              loop
              playsInline
              preload={near ? "auto" : "none"}
              aria-label={demo.alt}
            />
            <div className="lv-demo-bar">
              <span>{demo.label}</span>
              <span className="lv-demo-track"><span ref={barRef} /></span>
            </div>
          </div>
        </div>
        <p data-rise="1" className="lv-demo-caption">{demo.caption}</p>
      </div>
    </section>
  );
}
