import { offerPrices } from "@/lib/billing-catalog";
import { absoluteUrl } from "@/lib/site";

/**
 * Calls to action in a post. Same promise and form as the landing hero: the website goes through sign-in to
 * onboarding, which reads it. The sign-in address is absolute: on the blog's own host `/login` is a blog address.
 *
 * `inline` sits mid-post, after the reader has learned something; `end` closes the post.
 */
export async function BlogCta({ variant = "end" }: { variant?: "inline" | "end" }) {
  const prices = await offerPrices();
  const id = `blog-cta-${variant}`;
  if (variant === "inline") {
    return (
      <aside className="blog-cta-inline" aria-labelledby={`${id}-title`}>
        <div>
          <p id={`${id}-title`} className="blog-cta-inline-title">Want to see who is asking for your product?</p>
          <p>Ferreto reads your website and finds people on Reddit, Hacker News, Threads and Facebook groups who describe the problem you solve, with a reply drafted for you to post yourself.</p>
        </div>
        <a href={absoluteUrl("/login")} className="blog-cta-inline-link">Start with your website <span aria-hidden="true">→</span></a>
      </aside>
    );
  }
  return (
    <aside className="blog-cta" aria-labelledby={`${id}-title`}>
      <p className="blog-cta-kicker">Ferreto · for founders who sell software</p>
      <h2 id={`${id}-title`}>Find the people already asking for what you built.</h2>
      <p>Each one comes with the words they wrote and a reply drafted from your business plan. You post it from your own account. Your first scan is free.</p>
      <form action={absoluteUrl("/login")} className="blog-cta-form">
        <label htmlFor={`${id}-site`} className="sr-only">Your website</label>
        <input id={`${id}-site`} name="site" type="text" inputMode="url" autoComplete="url" required placeholder="yourcompany.com" />
        <button type="submit">See who&apos;s asking</button>
      </form>
      {prices ? <p className="blog-cta-fine">${prices.annual} a month, billed annually · cancel anytime</p> : null}
    </aside>
  );
}
