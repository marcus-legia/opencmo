import type { Metadata } from "next";

import { BRAND, faqs, SHOWCASE } from "@/components/landing/data";
import { FaqSection } from "@/components/landing/FaqSection";
import { Hero } from "@/components/landing/Hero";
import { LandingFooter } from "@/components/landing/LandingFooter";
import { LandingMotion } from "@/components/landing/LandingMotion";
import { LandingNav } from "@/components/landing/LandingNav";
import { PricingSection } from "@/components/landing/PricingSection";
import { ScrollEssay } from "@/components/landing/ScrollEssay";
import { FitSection, PromiseSection, StepsSection } from "@/components/landing/Sections";
import { JsonLd } from "@/components/seo/JsonLd";
import { offerPrices, plansOnSale, type SellablePlan } from "@/lib/billing-catalog";
import { SITE_NAME, SITE_URL, absoluteUrl } from "@/lib/site";
import { currentUser } from "@/lib/supabase/user";

const DESCRIPTION = `${BRAND} reads your website and finds people on Reddit, Hacker News, Threads and Facebook groups who describe the problem you solve. It drafts a reply built from your business plan; you post it from your own account.`;

export const metadata: Metadata = {
  title: { absolute: `${BRAND}: find the people asking for what you built` },
  description: DESCRIPTION,
  alternates: { canonical: "/" },
};

// Ai/cái gì/giá bao nhiêu — ba thứ máy trả lời câu hỏi cần để nhắc tới Ferreto
// đúng. `offers` và FAQ đọc cùng nguồn với trang: giá và câu trả lời không lệch nhau.
function landingLd(faq: { q: string; a: string }[], plans: SellablePlan[]) {
  return [
    {
      "@context": "https://schema.org",
      "@type": "Organization",
      "@id": `${SITE_URL}/#organization`,
      name: SITE_NAME,
      url: SITE_URL,
      logo: absoluteUrl("/icon.svg"),
    },
    {
      "@context": "https://schema.org",
      "@type": "WebSite",
      "@id": `${SITE_URL}/#website`,
      name: SITE_NAME,
      url: SITE_URL,
      publisher: { "@id": `${SITE_URL}/#organization` },
    },
    {
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      name: BRAND,
      url: SITE_URL,
      description: DESCRIPTION,
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web",
      offers: plans.filter((plan) => plan.slug).map((plan) => ({
        "@type": "Offer",
        name: plan.name,
        price: plan.billedPrice,
        priceCurrency: "USD",
        category: "subscription",
        priceSpecification: { "@type": "UnitPriceSpecification", price: plan.billedPrice, priceCurrency: "USD", unitCode: plan.interval === "year" ? "ANN" : "MON" },
      })),
    },
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: faq.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
    },
  ];
}

export default async function LandingPage() {
  const user = await currentUser();
  const [prices, plans] = await Promise.all([offerPrices(), plansOnSale()]);
  const faq = faqs(prices);
  // Ô WEBSITE (không phải link video): onboarding đọc nó để dựng chiến lược
  // (docs/cmo/san-pham.md §3.1). `site` đi qua đăng nhập tới app.
  const action = user ? "/app" : "/login";

  // Footer nằm NGOÀI <main>: footer trong main không phải landmark contentinfo, nên
  // trình đọc màn hình (và người duyệt Creem dùng nó) không tìm thấy bốn link pháp lý.
  return (
    <div className="landing">
      <LandingMotion />
      <JsonLd data={landingLd(faq, plans)} />
      <LandingNav user={!!user} />
      <main>
        <Hero action={action} />
        <FitSection />
        <StepsSection />
        <ScrollEssay beats={SHOWCASE} label="See it work" id="demo" eyebrow="See it work" />
        <PromiseSection />
        {/* No catalogue row, no price (cmo-review-2 S2.7): the section waits for the catalogue rather than guess. */}
        {prices ? (
          <PricingSection prices={prices} action={action} />
        ) : (
          <section id="pricing" aria-labelledby="pricing-title" className="lv-panel-section is-pricing">
            <div className="lv-container lv-stack-16">
              <p className="lv-eyebrow">Pricing</p>
              <h2 id="pricing-title" className="lv-h2">One plan, paid monthly or yearly.</h2>
              <p className="lv-lede">Your first plan and drafts are free. Pick a plan to approve and post them. You see the plans and their prices after you sign in.</p>
            </div>
          </section>
        )}
        <FaqSection items={faq} />
      </main>
      <LandingFooter action={action} />
    </div>
  );
}
