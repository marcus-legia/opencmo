/**
 * Bundles the MCP server into one file for the Modal image (`dist/server.cjs`): the server, the
 * web app's tool modules it imports through `@/` (each file's own tsconfig resolves the alias),
 * and the workspace packages. Built with the `react-server` condition, as the server runs under
 * tsx, so `server-only` is empty; `next/server` and `next/headers` become the stand-ins in
 * `src/shims`. Node built-ins stay outside.
 *
 *     npm run build --workspace @opencmo/mcp-server
 */
import { mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const out = path.join(root, "dist", "server.cjs");
await mkdir(path.dirname(out), { recursive: true });

const result = await build({
  entryPoints: [path.join(root, "src", "main.ts")],
  outfile: out,
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  conditions: ["react-server"],
  alias: {
    "next/server": path.join(root, "src", "shims", "next-server.ts"),
    "next/headers": path.join(root, "src", "shims", "next-headers.ts"),
  },
  // Optional native/peer packages of dependencies that the server never loads.
  external: ["bufferutil", "utf-8-validate"],
  sourcemap: "linked",
  legalComments: "linked",
  metafile: true,
  logLevel: "warning",
});

const { size } = await stat(out);
const inputs = Object.keys(result.metafile.inputs);
const next = inputs.filter((file) => file.includes("node_modules/next/"));
if (next.length) {
  console.error(`The bundle pulled in Next itself (${next.slice(0, 3).join(", ")}…): add the import to the shims.`);
  process.exit(1);
}
console.log(`${path.relative(process.cwd(), out)}: ${(size / 1e6).toFixed(1)} MB from ${inputs.length} files`);
