/**
 * What a link preview reads (.github/workflows/lighthouse.yml).
 *
 * Next 15 streams a page's metadata into <body> for browsers, and React moves it into <head> after; link-preview bots
 * (Twitterbot, facebookexternalhit, LinkedInBot, Slackbot…) get it in <head> at once. Lighthouse's own user agent is
 * a browser's, so its `meta-description` audit saw the description on some loads and not others (2026-11-15). This
 * script asks each page as Twitterbot and fails when <head> lacks what a preview needs.
 *
 *   node lighthouse/preview-meta.mjs http://127.0.0.1:3200 / /blog /blog/write-x-thread
 */
const [base, ...paths] = process.argv.slice(2);
if (!base || !paths.length) {
  console.error("usage: node lighthouse/preview-meta.mjs <base url> <path>...");
  process.exit(2);
}

const NEEDED = [
  ["description", /<meta[^>]+name="description"[^>]+content="[^"]+"/],
  ["og:title", /<meta[^>]+property="og:title"[^>]+content="[^"]+"/],
  ["og:description", /<meta[^>]+property="og:description"[^>]+content="[^"]+"/],
  ["og:image", /<meta[^>]+property="og:image"[^>]+content="https?:\/\/[^"]+"/],
  ["twitter:card", /<meta[^>]+name="twitter:card"[^>]+content="[^"]+"/],
];

let failed = 0;
for (const path of paths) {
  const response = await fetch(new URL(path, base), { headers: { "user-agent": "Twitterbot/1.0" }, redirect: "follow" });
  const html = await response.text();
  const end = html.indexOf("</head>");
  const head = end >= 0 ? html.slice(0, end) : "";
  const missing = NEEDED.filter(([, pattern]) => !pattern.test(head)).map(([name]) => name);
  if (response.status !== 200 || missing.length) {
    failed += 1;
    console.error(`✗ ${path}: status ${response.status}${missing.length ? `, missing in <head>: ${missing.join(", ")}` : ""}`);
  } else {
    console.log(`✓ ${path}: a preview has its description, title, image and card`);
  }
}
process.exit(failed ? 1 : 0);
