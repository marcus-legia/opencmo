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

/**
 * The image type from the file's first bytes, or null when it is not one of the raster formats an icon may be. The
 * upstream Content-Type is never echoed: a header such as "image/png, text/html" could pass a pattern and be read as
 * a page on this origin.
 */
export function rasterType(bytes: Uint8Array): string | null {
  const at = (i: number, ...b: number[]) => b.every((x, j) => bytes[i + j] === x);
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
  if (at(0, 0xff, 0xd8, 0xff)) return "image/jpeg";
  if (at(0, 0x47, 0x49, 0x46, 0x38)) return "image/gif";
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return "image/webp";
  if (at(0, 0x00, 0x00, 0x01, 0x00)) return "image/x-icon";
  return null;
}
