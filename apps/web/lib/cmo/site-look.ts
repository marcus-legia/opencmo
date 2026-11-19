/**
 * The Brand's look read from the website (wave 3 B4): the logo, two to four colours and the main font, taken from the
 * home page's own markup, never guessed. Onboarding puts them in the Brand document; the founder fixes what is off.
 * Pure: no network, so it is checked on fixed HTML.
 */

export type SiteLook = { logo_url: string; colors: string[]; font: string };

const GENERIC_FONTS = /^(inherit|initial|unset|serif|sans-serif|monospace|cursive|fantasy|system-ui|ui-sans-serif|ui-serif|ui-monospace|-apple-system|blinkmacsystemfont|arial|helvetica|helvetica neue|segoe ui|roboto|times|times new roman|georgia|courier|courier new|var\(.*\))$/i;

/** A #rgb or #rrggbb colour as #rrggbb, lower case. */
function hex(value: string): string | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim());
  if (!m) return null;
  const h = m[1]!.length === 3 ? [...m[1]!].map((c) => c + c).join("") : m[1]!;
  return `#${h.toLowerCase()}`;
}

/** White, black and greys are the page, not the brand. */
function isNeutral(color: string): boolean {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16));
  return Math.max(r!, g!, b!) - Math.min(r!, g!, b!) < 24;
}

/** An https URL for `raw` on the page at `base`, or null (data: and http: logos are left out). */
function https(raw: string | undefined, base: URL): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw.trim(), base);
    return url.protocol === "https:" && url.href.length <= 500 ? url.href : null;
  } catch {
    return null;
  }
}

const attr = (tag: string, name: string) => new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, "i").exec(tag)?.[1];

export function extractLook(pageUrl: string, html: string): SiteLook {
  const base = new URL(pageUrl);
  const head = html.slice(0, 200_000);

  // Logo: an image that says it is the logo, then the touch icon, then the icon. Not og:image (a share card).
  let logo: string | null = null;
  for (const [tag] of head.matchAll(/<img\b[^>]*>/gi)) {
    if (/logo/i.test(`${attr(tag, "alt") ?? ""} ${attr(tag, "class") ?? ""} ${attr(tag, "id") ?? ""} ${attr(tag, "src") ?? ""}`)) {
      logo = https(attr(tag, "src"), base);
      if (logo) break;
    }
  }
  if (!logo) {
    for (const rel of ["apple-touch-icon", "icon"]) {
      const tag = [...head.matchAll(/<link\b[^>]*>/gi)].map((m) => m[0]).find((t) => (attr(t, "rel") ?? "").toLowerCase().split(/\s+/).includes(rel));
      logo = tag ? https(attr(tag, "href"), base) : null;
      if (logo) break;
    }
  }

  // Colours: the theme colour first, then brand-named CSS variables, then the most used non-neutral colours in the
  // page's own styles.
  const colors: string[] = [];
  const add = (c: string | null) => {
    if (c && !isNeutral(c) && !colors.includes(c) && colors.length < 4) colors.push(c);
  };
  const theme = [...head.matchAll(/<meta\b[^>]*>/gi)].map((m) => m[0]).find((t) => (attr(t, "name") ?? "").toLowerCase() === "theme-color");
  if (theme) add(hex(attr(theme, "content") ?? ""));
  const styles = [...head.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join("\n") + [...head.matchAll(/\bstyle\s*=\s*"([^"]*)"/gi)].map((m) => m[1]).join(";");
  for (const m of styles.matchAll(/--[\w-]*(brand|primary|accent)[\w-]*\s*:\s*(#[0-9a-f]{3,6})\b/gi)) add(hex(m[2]!));
  const counts = new Map<string, number>();
  for (const m of styles.matchAll(/#[0-9a-f]{6}\b|#[0-9a-f]{3}\b/gi)) {
    const c = hex(m[0]);
    if (c && !isNeutral(c)) counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  for (const [c] of [...counts].sort((a, b) => b[1] - a[1])) add(c);

  // Font: a Google Fonts family the page loads, else the first named family in its styles.
  let font = "";
  const google = /fonts\.googleapis\.com\/css2?\?[^"']*family=([^:&"']+)/i.exec(head)?.[1];
  if (google) font = decodeURIComponent(google.replace(/\+/g, " ")).trim();
  if (!font) {
    for (const m of styles.matchAll(/font-family\s*:\s*([^;}"]+)/gi)) {
      const first = m[1]!.split(",")[0]!.trim().replace(/^["']|["']$/g, "");
      if (first && !GENERIC_FONTS.test(first)) {
        font = first;
        break;
      }
    }
  }
  return { logo_url: logo ?? "", colors: colors.slice(0, 4), font: font.slice(0, 60) };
}
