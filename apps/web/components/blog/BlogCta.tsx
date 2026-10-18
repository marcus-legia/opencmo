import { offerPrices } from "@/lib/pricing";

/**
 * Calls to action in a post. Same promise and form as the landing hero: the website
 * goes through sign-in to onboarding, which reads it to build the plan.
 *
 * `inline` sits mid-post, after the reader has learned something; `end` closes the post.
 */
export function BlogCta({ variant = "end" }: { variant?: "inline" | "end" }) {
  const { annual } = offerPrices();
  const id = `blog-cta-${variant}`;
  if (variant === "inline") {
    return (
      <aside className="blog-cta-inline" aria-labelledby={`${id}-title`}>
        <div>
          <p id={`${id}-title`} className="blog-cta-inline-title">Rather have this done for you each week?</p>
          <p>OpenCMO is an AI CMO. It edits the videos, writes the posts and finds the conversations. You approve.</p>
        </div>
        <a href="/login" className="blog-cta-inline-link">Start with your website <span aria-hidden="true">→</span></a>
      </aside>
    );
  }
  return (
    <aside className="blog-cta" aria-labelledby={`${id}-title`}>
      <p className="blog-cta-kicker">OpenCMO · AI CMO for founders</p>
      <h2 id={`${id}-title`}>Your AI marketing team.</h2>
      <p>It edits the videos, writes the posts and finds the conversations. Nothing goes out until you approve it.</p>
      <form action="/login" className="blog-cta-form">
        <label htmlFor={`${id}-site`} className="sr-only">Your website</label>
        <input id={`${id}-site`} name="site" type="text" inputMode="url" autoComplete="url" required placeholder="yourcompany.com" />
        <button type="submit">Start with your website</button>
      </form>
      <p className="blog-cta-fine">${annual} a month, billed annually · cancel anytime</p>
    </aside>
  );
}
