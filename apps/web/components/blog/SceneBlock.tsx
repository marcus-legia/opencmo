"use client";

import { type CSSProperties, useEffect, useRef, useState } from "react";

import type { BlockOf } from "@/lib/blog-blocks";

/**
 * A 3D illustration in a post. three.js is loaded only when the figure scrolls near
 * the screen, and the loop stops while it is off-screen. The labels are real text in
 * the legend, so the figure still reads without WebGL, without JS, or to a screen reader.
 */
export function SceneBlock({ block }: { block: BlockOf<"scene"> }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [live, setLive] = useState(false);

  useEffect(() => {
    const box = boxRef.current!, canvas = canvasRef.current!;
    let stop: (() => void) | undefined;
    let cancelled = false;

    const near = new IntersectionObserver(async ([entry]) => {
      if (!entry.isIntersecting || stop) return;
      near.disconnect();
      const { createBlogScene } = await import("./blog-scene");
      if (cancelled) return;
      try {
        stop = createBlogScene(canvas, box, block.preset, block.labels.length);
        setLive(true);
      } catch {
        // No WebGL: the legend alone carries the figure.
      }
    }, { rootMargin: "200px" });
    near.observe(box);

    return () => {
      cancelled = true;
      near.disconnect();
      stop?.();
    };
  }, [block.preset, block.labels.length]);

  return (
    <figure className={`bk bk-scene is-${block.preset}`}>
      <figcaption className="bk-title">{block.title}</figcaption>
      <div ref={boxRef} className={`bk-scene-stage${live ? " is-live" : ""}`}>
        <canvas ref={canvasRef} aria-hidden="true" />
      </div>
      <ol className="bk-scene-legend">
        {block.labels.map((label, i) => (
          <li key={label} style={{ "--bk-i": i } as CSSProperties}>{label}</li>
        ))}
      </ol>
      {block.caption && <p className="bk-scene-caption">{block.caption}</p>}
    </figure>
  );
}
