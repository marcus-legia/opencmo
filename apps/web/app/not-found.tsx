import Link from "next/link";

import { MarketingFooter } from "@/components/marketing/MarketingFooter";
import { MarketingNav } from "@/components/marketing/MarketingNav";
import { absoluteUrl, blogUrl } from "@/lib/site";

export default function NotFound() {
  return (
    <div className="site">
      <MarketingNav />
      <div className="marketing blog">
      <main className="blog-main blog-notfound">
        <p className="section-kicker">404</p>
        <h1>This page isn’t here.</h1>
        <p>It may have moved, or the link has a typo.</p>
        <div>
          <Link href={blogUrl()} className="blog-notfound-primary">Read the blog</Link>
          <a href={absoluteUrl("/")}>Go to the homepage</a>
        </div>
      </main>
      </div>
      <MarketingFooter />
    </div>
  );
}
