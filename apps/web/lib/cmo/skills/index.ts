/**
 * Skill của CMO (H4): playbook .md chép/chắt từ repo MIT (marketingskills, social-media-research-
 * skills, claude-code-templates — copyright ở frontmatter từng file và LICENSE.md).
 * Sửa .md rồi chạy `npx tsx scripts/build-cmo-skills.mts`; `check:contracts` đỏ khi quên.
 *
 * Job nhúng NGUYÊN skill của agent mình vào system prompt (chuỗi cố định → prompt cache).
 * CMO chat chỉ thấy chỉ mục và đọc bằng `read_skill` khi cần (đỡ tốn context mỗi lượt).
 *
 * `marketingskills/`: the original marketingskills SKILL.md files (strategy, channels, sales, SEO), read
 * only by CMO chat. They were written for coding agents, so they are read with MARKETING_PREAMBLE: the
 * context is the four documents rather than files, there is no CLI, and everything is a draft the founder posts.
 */

import type { AgentId } from "@/lib/cmo/agents/registry";

import { CMO_SKILLS } from "./index.gen";

export type SkillName = keyof typeof CMO_SKILLS;
export const SKILL_NAMES = Object.keys(CMO_SKILLS) as SkillName[];

/** Chuỗi tĩnh (không chèn biến) để thân skill đọc qua tool vẫn y hệt giữa các lượt. */
export const MARKETING_PREAMBLE = `This is a general marketing playbook written for a different tool. Apply it like this:
- Product marketing context is the founder's four documents in <documents> (product, strategy, competitors, content strategy). Never look for files such as .agents/product-marketing.md; if something is missing, ask the founder one short question.
- Skip any step about reading or writing files, running command-line tools, installing code, connecting integrations or checking for skill updates. You advise and draft; you do not edit the founder's website or code.
- For SEO or website reviews, read the live site with read_site, then give a short prioritized list of fixes the founder can make.
- Everything that goes out (posts, replies, emails, outreach) is a draft the founder approves and sends from their own account. Never suggest automated liking, following or commenting, multiple accounts, or bought engagement.`;

/** Thân skill (markdown), bọc thẻ để model biết đâu là playbook. */
export function skillText(name: SkillName): string {
  const skill = CMO_SKILLS[name];
  const body = skill.kind === "marketing" ? `${MARKETING_PREAMBLE}\n\n${skill.body}` : skill.body;
  return `<skill name="${name}">\n${body}\n</skill>`;
}

/**
 * Chỉ mục skill một agent dùng được: tên + một câu mô tả. Playbook riêng đứng trước thư viện để
 * model chọn playbook khi hai bên cùng chủ đề (vd. x-writing trước social).
 */
export function skillIndex(agent: AgentId): string {
  const line = (name: SkillName) => `- ${name}: ${CMO_SKILLS[name].description}`;
  const mine = SKILL_NAMES.filter((name) => (CMO_SKILLS[name].agents as readonly string[]).includes(agent));
  const playbooks = mine.filter((name) => CMO_SKILLS[name].kind === "playbook").map(line);
  const marketing = mine.filter((name) => CMO_SKILLS[name].kind === "marketing").map(line);
  if (!playbooks.length && !marketing.length) return "";
  const blocks = [playbooks.length ? `<skills>\n${playbooks.join("\n")}\n</skills>` : ""];
  if (marketing.length) blocks.push(`Marketing library (strategy, channels, sales, SEO — prefer a playbook above when both fit):\n<library>\n${marketing.join("\n")}\n</library>`);
  return blocks.filter(Boolean).join("\n\n");
}
