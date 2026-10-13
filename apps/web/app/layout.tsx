import type { Metadata } from "next";
import { SpeedInsights } from "@vercel/speed-insights/next";

import "./globals.css";
import "@/styles/design-system.css";
import "@/styles/marketing.css";
import "@/styles/landing.css";
import "@/styles/blog.css";
import "@/styles/app.css";
import "@/styles/cmo.css";

import { SITE_DESCRIPTION, SITE_NAME, SITE_URL } from "@/lib/site";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  icons: { icon: "/icon.svg" },
  title: { default: "OpenCMO — 1 long video, 10 vertical clips", template: "%s · OpenCMO" },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  openGraph: { type: "website", siteName: SITE_NAME, locale: "en_US", url: "/" },
  twitter: { card: "summary_large_image" },
  alternates: { types: { "application/rss+xml": [{ url: "/blog/rss.xml", title: "OpenCMO Blog" }] } },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // The /app boot script (rail, theme) sets `data-*` on <html> before React hydrates;
    // suppress the attribute mismatch on this tag only, not its children.
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen antialiased">
        {children}
        {/* Real-user Core Web Vitals; only reports on Vercel deployments with Speed Insights enabled. */}
        <SpeedInsights />
      </body>
    </html>
  );
}
