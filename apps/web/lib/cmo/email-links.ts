/**
 * Email without a Google scope (wave 4 B6, owner's decision 1 default): the Email tab opens the founder's own mailbox
 * with the address, a subject and the drafted body filled in. Nothing is sent from Ferreto; the founder sends it.
 *
 * Browsers and Gmail cut long URLs without saying so, so a body that would not fit gives no link: the screen offers
 * Copy instead (`null` below).
 */

/** The line every email ends with, so the person can say no (plan "Reaching out": one email, an easy no). */
export const OPT_OUT_LINE = "If this is not for you, tell me and I will not write again.";

/** Longest URL we hand to a browser: under the ~2,000 characters some mail apps and Gmail still accept whole. */
export const MAX_MAIL_URL = 1900;

const MAX_SUBJECT = 120;

/** The subject: the person's own post title, so they know at once why a stranger writes. */
export function emailSubject(threadTitle: string): string {
  const title = threadTitle.replace(/\s+/g, " ").trim();
  if (!title) return "About your post";
  const subject = `About your post: ${title}`;
  return subject.length <= MAX_SUBJECT ? subject : `${subject.slice(0, MAX_SUBJECT - 1).trimEnd()}…`;
}

/**
 * The email's starting text when no DM was drafted (daily limit, a draft the checks dropped, a platform without DMs):
 * an opening that names their post, and the one line the founder writes themselves. Never an empty box.
 */
export function emailOpening(threadTitle: string): string {
  const title = threadTitle.replace(/\s+/g, " ").trim();
  return `Hi,\n\nI read your post${title ? ` "${title}"` : ""} and wanted to write to you directly.\n\n[One or two lines on how you can help with what they described.]`;
}

/** The body as sent: the draft, then the opt-out line unless the founder already wrote it. */
export function emailBody(draft: string): string {
  const body = draft.trim();
  if (!body) return "";
  return body.includes(OPT_OUT_LINE) ? body : `${body}\n\n${OPT_OUT_LINE}`;
}

export type MailLinks = { gmail: string | null; mailto: string | null };

/** Both links, or `null` for each that would be too long (copy instead). An empty body or address gives none. */
export function mailLinks(to: string, subject: string, draft: string): MailLinks {
  const body = emailBody(draft);
  if (!to.trim() || !body) return { gmail: null, mailto: null };
  const enc = encodeURIComponent;
  const gmail = `https://mail.google.com/mail/?view=cm&fs=1&to=${enc(to.trim())}&su=${enc(subject)}&body=${enc(body)}`;
  // mailto keeps the address readable (RFC 6068): only the query parts are encoded.
  const mailto = `mailto:${enc(to.trim()).replace(/%40/g, "@")}?subject=${enc(subject)}&body=${enc(body)}`;
  return { gmail: gmail.length <= MAX_MAIL_URL ? gmail : null, mailto: mailto.length <= MAX_MAIL_URL ? mailto : null };
}
