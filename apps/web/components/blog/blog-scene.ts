import * as THREE from "three";

import { prefersReducedMotion } from "@/components/landing/motion";
import type { SCENE_PRESETS } from "@/lib/blog-blocks";

type Preset = (typeof SCENE_PRESETS)[number];
type Tick = (t: number) => void;

/**
 * The four 3D illustrations a post can use. Shape i takes colour `--bk-c<i>` from
 * blog.css, the same colour as legend item i, so the reader can match label to shape
 * without any text in the canvas.
 *
 * Returns a cleanup that stops the loop and frees the GPU objects.
 */
export function createBlogScene(canvas: HTMLCanvasElement, box: HTMLElement, preset: Preset, count: number): () => void {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8170, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 1.8);
  sun.position.set(3, 6, 5);
  scene.add(sun);

  const css = getComputedStyle(box);
  const colors = Array.from({ length: count }, (_, i) => new THREE.Color(css.getPropertyValue(`--bk-c${i}`).trim() || "#1b2a8c"));
  const accent = new THREE.Color(css.getPropertyValue("--bk-accent").trim() || "#c6a15b");
  const mat = (c: THREE.Color, extra: THREE.MeshStandardMaterialParameters = {}) =>
    new THREE.MeshStandardMaterial({ color: c, roughness: 0.42, metalness: 0.08, ...extra });

  const root = new THREE.Group();
  scene.add(root);
  const tick = BUILD[preset](root, colors, accent, mat, camera);

  const resize = () => {
    const { width, height } = box.getBoundingClientRect();
    renderer.setSize(width, height, false);
    camera.aspect = width / Math.max(1, height);
    // Narrow screens: step back so the widest shape still fits.
    camera.zoom = Math.min(1, camera.aspect / 1.5);
    camera.updateProjectionMatrix();
  };
  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(box);

  const reduced = prefersReducedMotion();
  const t0 = performance.now();
  let raf = 0, visible = true;
  const frame = () => {
    // Reduced motion: one still frame, posed mid-animation so every shape is in view.
    tick(reduced ? 1.6 : (performance.now() - t0) / 1000);
    renderer.render(scene, camera);
  };
  const loop = () => {
    if (!visible) return;
    raf = requestAnimationFrame(loop);
    frame();
  };
  const io = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    cancelAnimationFrame(raf);
    if (visible && !reduced) loop();
  });
  if (reduced) frame();
  else io.observe(box);

  return () => {
    cancelAnimationFrame(raf);
    io.disconnect();
    ro.disconnect();
    scene.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.InstancedMesh) {
        o.geometry.dispose();
        (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
      }
    });
    renderer.dispose();
  };
}

type Mat = (c: THREE.Color, extra?: THREE.MeshStandardMaterialParameters) => THREE.MeshStandardMaterial;
type Builder = (root: THREE.Group, colors: THREE.Color[], accent: THREE.Color, mat: Mat, camera: THREE.PerspectiveCamera) => Tick;

const BUILD: Record<Preset, Builder> = {
  /** Stages narrow downward; dots fall through and some drift out at each stage. */
  funnel(root, colors, accent, mat, camera) {
    const n = colors.length, step = 3.2 / n;
    camera.position.set(0, 1.2, 9.5);
    camera.lookAt(0, -0.1, 0);
    colors.forEach((c, i) => {
      const top = 2.2 - (i * 1.6) / n, bottom = 2.2 - ((i + 1) * 1.6) / n;
      const ring = new THREE.Mesh(new THREE.CylinderGeometry(top, bottom, step * 0.82, 64, 1, true), mat(c, { side: THREE.DoubleSide, transparent: true, opacity: 0.88 }));
      ring.position.y = 1.6 - step * (i + 0.5);
      root.add(ring);
    });
    const DOTS = 70;
    const dots = new THREE.InstancedMesh(new THREE.SphereGeometry(0.06, 12, 12), mat(accent, { emissive: accent, emissiveIntensity: 0.25 }), DOTS);
    root.add(dots);
    // Each dot leaves at a stage; later stages keep fewer dots, the point of a funnel.
    const seeds = Array.from({ length: DOTS }, (_, k) => ({ phase: k / DOTS, angle: k * 2.399, exit: Math.floor(Math.pow(Math.random(), 0.7) * (n + 1)) }));
    const m = new THREE.Matrix4();
    return (t) => {
      root.rotation.y = t * 0.25;
      seeds.forEach((s, k) => {
        const u = (t * 0.12 + s.phase) % 1;
        const y = 2.4 - u * 5.2;
        const stage = Math.floor((1.6 - y) / step);
        const out = stage >= s.exit && s.exit < n ? Math.min(1, (1.6 - y - s.exit * step) / step) : 0;
        const r = Math.max(0.15, 1.6 - stage * (1.6 / n)) * 0.45 + out * 2.2;
        const scale = out > 0 ? 1 - out * 0.8 : 1;
        m.makeScale(scale, scale, scale).setPosition(Math.cos(s.angle) * r, y, Math.sin(s.angle) * r);
        dots.setMatrixAt(k, m);
      });
      dots.instanceMatrix.needsUpdate = true;
    };
  },

  /** A loop of stages that feed each other, turning. */
  flywheel(root, colors, accent, mat, camera) {
    const n = colors.length, R = 2.1;
    camera.position.set(0, 4.2, 7.4);
    camera.lookAt(0, 0, 0);
    root.add(new THREE.Mesh(new THREE.TorusGeometry(R, 0.05, 16, 160), mat(accent)).rotateX(Math.PI / 2));
    const nodes = colors.map((c, i) => {
      const a = (i / n) * Math.PI * 2;
      const node = new THREE.Mesh(new THREE.SphereGeometry(0.36, 40, 40), mat(c));
      node.position.set(Math.cos(a) * R, 0, Math.sin(a) * R);
      const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.32, 24), mat(accent));
      const b = a + Math.PI / n;
      arrow.position.set(Math.cos(b) * R, 0, Math.sin(b) * R);
      // Point along the direction of travel (counter-clockwise from above).
      arrow.lookAt(Math.cos(b + 0.1) * R, 0, Math.sin(b + 0.1) * R);
      arrow.rotateX(Math.PI / 2);
      root.add(node, arrow);
      return node;
    });
    return (t) => {
      root.rotation.y = -t * 0.35;
      nodes.forEach((node, i) => { node.position.y = Math.sin(t * 2 + i) * 0.08; });
    };
  },

  /** Steps that climb; a marker hops from one to the next. */
  ladder(root, colors, accent, mat, camera) {
    const n = colors.length, w = 0.95;
    camera.position.set(2.2, 2.6, 9);
    camera.lookAt(0, 0.4, 0);
    const x0 = -((n - 1) * w) / 2;
    colors.forEach((c, i) => {
      const h = 0.45 + i * 0.5;
      const stepMesh = new THREE.Mesh(new THREE.BoxGeometry(w * 0.9, h, 1.1), mat(c));
      stepMesh.position.set(x0 + i * w, -1.2 + h / 2, 0);
      root.add(stepMesh);
    });
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.2, 32, 32), mat(accent, { emissive: accent, emissiveIntensity: 0.2 }));
    root.add(ball);
    root.rotation.y = -0.35;
    return (t) => {
      const u = (t * 0.6) % n, i = Math.floor(u), f = u - i;
      const j = Math.min(n - 1, i + 1);
      const top = (k: number) => -1.2 + 0.45 + k * 0.5 + 0.2;
      // Rest on the step for the first half, then arc to the next one.
      const g = Math.max(0, (f - 0.5) * 2);
      ball.position.set(x0 + (i + (j - i) * g) * w, top(i) + (top(j) - top(i)) * g + Math.sin(g * Math.PI) * 0.55, 0);
      root.rotation.y = -0.35 + Math.sin(t * 0.3) * 0.12;
    };
  },

  /** The first label is the core; the others orbit it at their own pace. */
  orbit(root, colors, accent, mat, camera) {
    camera.position.set(0, 3.4, 8.2);
    camera.lookAt(0, 0, 0);
    root.add(new THREE.Mesh(new THREE.SphereGeometry(0.75, 48, 48), mat(colors[0], { emissive: colors[0], emissiveIntensity: 0.15 })));
    const planets = colors.slice(1).map((c, k) => {
      const r = 1.5 + k * 0.55;
      root.add(new THREE.Mesh(new THREE.TorusGeometry(r, 0.012, 8, 160), mat(accent, { transparent: true, opacity: 0.6 })).rotateX(Math.PI / 2));
      const p = new THREE.Mesh(new THREE.SphereGeometry(0.24, 32, 32), mat(c));
      root.add(p);
      return { p, r, speed: 0.7 / Math.sqrt(r), phase: k * 1.7 };
    });
    root.rotation.x = 0.12;
    return (t) => {
      planets.forEach(({ p, r, speed, phase }) => {
        const a = t * speed + phase;
        p.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
      });
    };
  },
};
