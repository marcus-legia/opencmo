/** A bare host name: letters, digits and hyphens in labels, a letter TLD. No port, path, IP or user. */
const HOST = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/** The host of a site the founder typed ("https://www.buffer.com/pricing" → "buffer.com"), or null. */
export function logoHost(raw: string): string | null {
  const text = raw.trim().toLowerCase();
  if (!text) return null;
  let host: string;
  try {
    host = new URL(text.includes("://") ? text : `https://${text}`).hostname;
  } catch {
    return null;
  }
  host = host.replace(/^www\./, "");
  return HOST.test(host) ? host : null;
}

/** The same-origin address of a company's icon, or null when the site is not a host name. */
export function logoSrc(site: string | null | undefined): string | null {
  const host = site ? logoHost(site) : null;
  return host ? `/api/logo?d=${encodeURIComponent(host)}` : null;
}
