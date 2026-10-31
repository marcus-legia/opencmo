#!/usr/bin/env node
/**
 * Một lệnh dựng cả stack dev: Supabase local + Next + worker.
 *
 * Trước D4 có hai lệnh `dev` và `dev:local` cho hai sản phẩm khác nhau. Còn một
 * sản phẩm thì còn một lệnh — và nó phải tự lo phần dễ quên nhất: worker không
 * chạy thì job nằm mãi ở `queued` mà giao diện không nói gì cả.
 *
 * Không tự `supabase stop` lúc thoát: database local là nơi giữ dữ liệu thử của
 * Marcus giữa hai phiên làm việc. Ctrl+C chỉ dừng hai tiến trình lệnh này mở.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WEB = path.join(ROOT, "apps", "web");

/** Biến engine được phép đọc từ `.env.local`; phần còn lại tới từ Supabase. */
const ENGINE_KEYS = new Set([
  "ANTHROPIC_API_KEY", "OPENCMO_SCRIBE_MODEL", "OPENCMO_WATERMARK",
  // Web đọc thẳng apps/web/.env.local nên bật model voice khi có khoá; worker
  // thiếu khoá thì mọi lượt voiceover chết "not set up" trên local.
  "ELEVENLABS_API_KEY", "OPENCMO_ELEVENLABS_VOICES", "OPENCMO_AI_MODELS",
  // AI images/video/cut-outs and their output moderation run on fal: without the key the local
  // worker cannot generate, and moderation silently skips.
  "FAL_KEY", "OPENCMO_AI_FAKE",
  // The standby checker of output moderation when Claude cannot answer.
  "GEMINI_API_KEY", "OPENCMO_MODERATION_GEMINI_MODEL",
  // Explainers: where clip-motion renders, and the free silent voice for runs without a fal key.
  "OPENCMO_MOTION", "OPENCMO_MOTION_FAKE_VOICE", "OPENCMO_MOTION_SCALE", "OPENCMO_MOTION_CHROME",
  "OPENCMO_MOTION_CONCURRENCY", "OPENCMO_MOTION_ASSET_ORIGIN",
]);
/** `OPENCMO_AI_MODEL_<ID>` đổi providerModel — web và worker phải thấy cùng giá trị. */
const ENGINE_PREFIXES = ["OPENCMO_AI_MODEL_"];

function die(message) {
  console.error(`\n${message}\n`);
  process.exit(1);
}

function run(command, args, options = {}) {
  return spawnSync(command, args, { encoding: "utf8", cwd: WEB, ...options });
}

// Docker trước mọi thứ khác: `supabase start` không có Docker sẽ thất bại sau
// khoảng ba mươi giây với một thông báo không nói được phải làm gì.
if (run("docker", ["info"], { stdio: "ignore" }).status !== 0) {
  die("Docker chưa chạy. Mở Docker Desktop rồi chạy lại `npm run dev`.");
}

/** Reads `KEY=value` lines from the two `.env.local` files (the web one wins) for the keys `keep` accepts. */
function readEnvFiles(keep) {
  const env = {};
  for (const file of [path.join(ROOT, ".env.local"), path.join(WEB, ".env.local")]) {
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, "utf8").split("\n")) {
      const index = line.indexOf("=");
      if (index < 1) continue;
      const key = line.slice(0, index).trim();
      if (keep(key)) env[key] = line.slice(index + 1).trim().replace(/^["']|["']$/g, "");
    }
  }
  return env;
}

// supabase/config.toml reads the Google OAuth client as `env(SUPABASE_AUTH_GOOGLE_*)`. The CLI only
// sees the shell, not apps/web/.env.local: without these the auth container gets the literal
// `env(...)` string and Google answers "Error 401: invalid_client". They are read once, when the
// containers are created — a stack started without them needs `supabase stop` first.
const supabaseEnv = readEnvFiles((key) => key.startsWith("SUPABASE_AUTH_"));

const status = run("supabase", ["status", "-o", "env"]);
if (status.status !== 0) {
  console.log("Supabase local chưa chạy — đang `supabase start`…");
  if (run("supabase", ["start"], { stdio: "inherit", env: { ...process.env, ...supabaseEnv } }).status !== 0) {
    die("`supabase start` thất bại. Xem log bên trên.");
  }
}

const fresh = run("supabase", ["status", "-o", "env"]);
if (fresh.status !== 0) die("Không đọc được `supabase status -o env`.");

const supabase = {};
for (const line of fresh.stdout.split("\n")) {
  const index = line.indexOf("=");
  if (index < 1) continue;
  supabase[line.slice(0, index)] = line.slice(index + 1).replace(/^["']|["']$/g, "");
}
for (const key of ["API_URL", "ANON_KEY", "SERVICE_ROLE_KEY"]) {
  if (!supabase[key]) die(`\`supabase status\` thiếu ${key}.`);
}

const engineEnv = readEnvFiles((key) => ENGINE_KEYS.has(key) || ENGINE_PREFIXES.some((p) => key.startsWith(p)));

// Cổng 3000 bị chiếm thì Next lặng lẽ nhảy sang 3001, nhưng NEXT_PUBLIC_SITE_URL
// bên dưới vẫn là 3000 — magic link trong Inbucket trỏ về một cổng không có gì
// lắng nghe, và triệu chứng ("bấm link thì trắng trang") không chỉ về nguyên
// nhân. Thà dừng ngay với câu nói rõ phải làm gì.
const port = Number(process.env.PORT ?? 3000);
const busy = spawnSync("node", ["-e", `
  const net = require("node:net");
  const probe = net.createServer();
  probe.once("error", (error) => process.exit(error.code === "EADDRINUSE" ? 1 : 0));
  probe.once("listening", () => probe.close(() => process.exit(0)));
  probe.listen(${port}, "127.0.0.1");
`]).status === 1;
if (busy) {
  die(`Cổng ${port} đang bị chiếm. Xem tiến trình nào:\n\n  ss -ltnp | grep :${port}\n\nRồi tắt nó và chạy lại \`npm run dev\`.`);
}

const venv = path.join(ROOT, "packages", "engine", ".venv312", "bin", "python");
if (!existsSync(venv)) {
  die("Chưa có packages/engine/.venv312 — xem phần \"Chạy engine\" trong CLAUDE.md.");
}

// The fonts copied from packages/clip-media are generated files, not in git. `next dev` is called
// directly, so the `predev` hook of apps/web does not run.
if (run("npm", ["run", "media:sync"], { stdio: "inherit" }).status !== 0) {
  die("Could not copy the fonts (npm run media:sync in apps/web).");
}

// Explainers render with the local clip-motion CLI, and without a fal key the voice is a silent
// track, so `/explain` works end to end with no paid keys. Web (previews) and worker (renders)
// must agree. The first render downloads Remotion's headless browser once.
const motionEnv = {
  OPENCMO_MOTION: engineEnv.OPENCMO_MOTION ?? process.env.OPENCMO_MOTION ?? "local",
  OPENCMO_MOTION_FAKE_VOICE:
    engineEnv.OPENCMO_MOTION_FAKE_VOICE ?? process.env.OPENCMO_MOTION_FAKE_VOICE ?? (engineEnv.FAL_KEY || process.env.FAL_KEY ? "0" : "1"),
  // Previews fetch the user's images (kit.Image) from signed URLs of the local Supabase, and only from it.
  OPENCMO_MOTION_ASSET_ORIGIN: engineEnv.OPENCMO_MOTION_ASSET_ORIGIN ?? process.env.OPENCMO_MOTION_ASSET_ORIGIN ?? supabase.API_URL,
};

// 127.0.0.1 chứ không phải localhost: trên máy có IPv6, `localhost` giải ra ::1
// còn Supabase local lắng nghe trên 127.0.0.1, và magic link quay về sai host.
// `detached` cho mỗi tiến trình con tự làm trưởng nhóm, để lúc dừng còn giết
// được cả nhóm. Không có nó, `next` sống sót sau Ctrl+C: nó là CHÁU chứ không
// phải con — `npx` mới là con — nên SIGTERM gửi cho con không tới được nó, và
// nó giữ cổng 3000 cho tới lần `npm run dev` sau, lần đó Next lặng lẽ nhảy
// sang 3001 còn magic link thì vẫn trỏ về 3000.
const children = [
  spawn("npx", ["next", "dev", "-H", "127.0.0.1"], {
    cwd: WEB, stdio: "inherit", detached: true,
    env: {
      ...process.env,
      NEXT_PUBLIC_SUPABASE_URL: supabase.API_URL,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: supabase.ANON_KEY,
      SUPABASE_SERVICE_ROLE_KEY: supabase.SERVICE_ROLE_KEY,
      // MCP (G5) ký JWT ngắn hạn cho chủ khoá API.
      SUPABASE_JWT_SECRET: supabase.JWT_SECRET,
      NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL ?? "http://127.0.0.1:3000",
      // The redesigned UI (ui-build plan): local and preview run it, production leaves it unset until
      // release. `NEXT_PUBLIC_OPENCMO_UI= npm run dev` shows today's UI.
      NEXT_PUBLIC_OPENCMO_UI: process.env.NEXT_PUBLIC_OPENCMO_UI ?? "v2",
      // apps/web/.env.local holds the PRODUCTION worker URL and token: local jobs must be picked up
      // by the local worker, never sent to the production one. `@next/env` keeps a value that is
      // already set, so empty strings win over the file.
      MODAL_SUBMIT_URL: "",
      OPENCMO_WORKER_TOKEN: "",
      // Local previews encode the scene's images with the engine (`opencmo.ai.preview_assets`).
      OPENCMO_ENGINE_PYTHON: venv,
      ...motionEnv,
    },
  }),
  spawn(venv, ["-m", "opencmo.worker"], {
    cwd: path.join(ROOT, "packages", "engine"), stdio: "inherit", detached: true,
    env: {
      ...process.env, ...engineEnv,
      SUPABASE_URL: supabase.API_URL,
      SUPABASE_SERVICE_ROLE_KEY: supabase.SERVICE_ROLE_KEY,
      ...motionEnv,
    },
  }),
];

console.log(`\nWeb  http://127.0.0.1:3000\nMail http://127.0.0.1:54324  (magic link không gửi ra ngoài)\n`);

// Một tiến trình chết là cả hai dừng: worker im lặng trong lúc web vẫn chạy là
// đúng cái trạng thái khó tìm ra nhất — job "đang xử lý" mãi mãi.
let stopping = false;
function stop(code) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    // Số âm = cả nhóm, không riêng tiến trình con. Lỗi ESRCH chỉ nghĩa là nhóm
    // đó đã tự thoát trước.
    try { process.kill(-child.pid, "SIGTERM"); } catch { /* đã thoát */ }
  }
  process.exitCode = code ?? 0;
}
for (const child of children) child.on("exit", (code) => stop(code ?? 0));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => stop(0));
