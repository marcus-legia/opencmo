import { LogoMark } from "@/components/landing/Glyphs";
import { absoluteUrl, blogUrl } from "@/lib/site";

/**
 * The nav of the blog, the legal pages and the 404: the landing's nav (`lv-nav`), always on its solid background.
 *
 * These pages are rendered STATICALLY and do not know who is signed in, so the button is "Log in"; a signed-in reader
 * who presses it is sent straight into the app by the middleware. Links to the site are absolute: on the blog's own
 * host (`blog.ferreto.io`) a `/login` would be a blog address.
 */
export function MarketingNav({ section }: { section?: "blog" }) {
  const items = [
    { label: "How it works", href: absoluteUrl("/#departments") },
    { label: "Pricing", href: absoluteUrl("/#pricing") },
    { label: "FAQ", href: absoluteUrl("/#faq") },
    { label: "Blog", href: blogUrl(), current: section === "blog" },
  ];
  return (
    <nav aria-label="Main" className="lv-nav">
      <a href={absoluteUrl("/")} className="lv-nav-brand" aria-label="Ferreto home">
        <LogoMark size={28} />
        <span>Ferreto</span>
      </a>
      <div className="lv-nav-menus">
        {items.map((it) => (
          <div key={it.label} className="lv-nav-trig is-plain">
            <a href={it.href} className="lv-nav-item" aria-current={it.current ? "page" : undefined}>{it.label}</a>
          </div>
        ))}
      </div>
      <div className="lv-nav-actions">
        <a href={absoluteUrl("/login")} className="lv-btn-ghost">Log in</a>
        <a href={absoluteUrl("/login")} className="lv-btn-light">Get started</a>
      </div>
    </nav>
  );
}
