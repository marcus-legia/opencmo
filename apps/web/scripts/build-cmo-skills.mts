/**
 * Đóng gói skill CMO (`lib/cmo/skills/*.md`) thành `lib/cmo/skills/index.gen.ts` (H4).
 * Also `lib/cmo/skills/marketingskills/*.md`: the original marketingskills SKILL.md files (copied by
 * `sync-marketingskills.mts`), read only by CMO chat, with upstream-style frontmatter.
 *
 * Vì sao sinh file TS thay vì đọc .md lúc chạy: route serverless trên Vercel không mang theo
 * file lạ trừ khi khai `outputFileTracingIncludes`, và chuỗi cố định trong bundle giữ prompt
 * cache ổn định giữa các lượt.
 *
 *   tsx scripts/build-cmo-skills.mts          # ghi file
 *   tsx scripts/build-cmo-skills.mts --check  # check:contracts: đỏ nếu file gen lệch nguồn
 */

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const DIR = join(import.meta.dirname, "..", "lib", "cmo", "skills");
const OUT = join(DIR, "index.gen.ts");
const AGENTS = new Set(["cmo", "onboarding", "planner", "x_writer", "sales", "research", "checker", "captions"]);

type Skill = { name: string; description: string; agents: string[]; source: string; license: string; kind: "playbook" | "marketing"; body: string };

const MARKETING = join(DIR, "marketingskills");
/** Chỉ mục 38 dòng mô tả gốc (tới 1024 ký tự) phình prompt CMO mỗi lượt: giữ câu đầu. */
const INDEX_CHARS = 160;

function parse(file: string): Skill {
  const raw = readFileSync(join(DIR, file), "utf8");
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(raw);
  if (!match) throw new Error(`${file}: thiếu frontmatter`);
  const meta: Record<string, string> = {};
  for (const line of match[1]!.split("\n")) {
    const kv = /^(\w+):\s*(.*)$/.exec(line);
    if (kv) meta[kv[1]!] = kv[2]!.trim();
  }
  const name = meta.name ?? "";
  if (`${name}.md` !== file) throw new Error(`${file}: name "${name}" phải trùng tên file`);
  for (const key of ["kind", "description", "agents", "source", "license"]) if (!meta[key]) throw new Error(`${file}: missing ${key}`);
  // The same `kind` field as packages/skills, so these can move into the skill library unchanged.
  if (meta.kind !== "playbook") throw new Error(`${file}: kind must be "playbook" (got "${meta.kind}")`);
  const agents = meta.agents!.replace(/^\[|\]$/g, "").split(",").map((a) => a.trim()).filter(Boolean);
  for (const agent of agents) if (!AGENTS.has(agent)) throw new Error(`${file}: agent lạ "${agent}"`);
  if (!/MIT/.test(meta.license!)) throw new Error(`${file}: chỉ nhận nguồn MIT (ghi copyright)`);
  return { name, description: meta.description!, agents, source: meta.source!, license: meta.license!, kind: "playbook", body: match[2]!.trim() };
}

function shortDescription(raw: string): string {
  const text = raw.replace(/^["']|["']$/g, "").trim();
  const first = /^(.*?[.!?])(\s|$)/.exec(text)?.[1] ?? text;
  return first.length <= INDEX_CHARS ? first : `${first.slice(0, INDEX_CHARS - 1).trimEnd()}…`;
}

function parseMarketing(file: string): Skill {
  const raw = readFileSync(join(MARKETING, file), "utf8");
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(raw);
  if (!match) throw new Error(`marketingskills/${file}: missing frontmatter`);
  const name = /^name:\s*(.+)$/m.exec(match[1]!)?.[1]?.trim() ?? "";
  const description = /^description:\s*(.+)$/m.exec(match[1]!)?.[1]?.trim() ?? "";
  const version = /^\s+version:\s*(.+)$/m.exec(match[1]!)?.[1]?.trim() ?? "?";
  if (`${name}.md` !== file) throw new Error(`marketingskills/${file}: name "${name}" must match the file name`);
  if (!description) throw new Error(`marketingskills/${file}: missing description`);
  return {
    name,
    description: shortDescription(description),
    agents: ["cmo"],
    source: `marketingskills/${name} v${version}`,
    license: "MIT — Copyright (c) 2025 Corey Haines",
    kind: "marketing",
    body: match[2]!.trim(),
  };
}

const playbooks = readdirSync(DIR).filter((f) => f.endsWith(".md") && f !== "LICENSE.md").sort().map(parse);
const marketing = readdirSync(MARKETING).filter((f) => f.endsWith(".md") && f !== "SOURCE.md").sort().map(parseMarketing);
for (const skill of marketing) {
  if (playbooks.some((p) => p.name === skill.name)) throw new Error(`marketingskills/${skill.name}.md has the same name as a playbook: rename one`);
}
const skills = [...playbooks, ...marketing];
const out = `// SINH TỰ ĐỘNG bởi scripts/build-cmo-skills.mts từ lib/cmo/skills/*.md và marketingskills/*.md — đừng sửa tay.
/* eslint-disable */

export const CMO_SKILLS = ${JSON.stringify(Object.fromEntries(skills.map((s) => [s.name, s])), null, 2)} as const;
`;

if (process.argv.includes("--check")) {
  const current = (() => {
    try {
      return readFileSync(OUT, "utf8");
    } catch {
      return "";
    }
  })();
  if (current !== out) {
    console.error("index.gen.ts lệch lib/cmo/skills/*.md hoặc marketingskills/*.md — chạy: npx tsx scripts/build-cmo-skills.mts");
    process.exit(1);
  }
  console.log(`cmo skills: ${playbooks.length} playbook + ${marketing.length} marketingskills khớp nguồn`);
} else {
  writeFileSync(OUT, out);
  console.log(`cmo skills: ghi ${playbooks.length} playbook + ${marketing.length} marketingskills → lib/cmo/skills/index.gen.ts`);
}
