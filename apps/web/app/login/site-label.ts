/**
 * The website typed in the landing's hero, as the person reads it back on /login: `https://www.acme.com/pricing` →
 * `acme.com`. Anything that does not parse as a host is not shown; it still rides along to the app, which checks it.
 */
export function siteLabel(site: string | undefined): string | null {
  const raw = site?.trim();
  if (!raw || raw.length > 300) return null;
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) && host.length <= 80 ? host : null;
  } catch {
    return null;
  }
}
