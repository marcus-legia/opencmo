import type { Metadata } from "next";
import Link from "next/link";

import { LegalPage } from "@/components/marketing/LegalPage";
import { SUPPORT_EMAIL } from "@/lib/site";

export const metadata: Metadata = { title: "Terms of Service", alternates: { canonical: "/terms" } };

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms of Service"
      intro={<p>These terms govern your use of Ferreto (“Ferreto”, “we”, “us”), a software product at ferreto.io. By creating an account or using Ferreto you agree to them. If you use Ferreto for a company, you accept these terms on its behalf.</p>}
      sections={[
        {
          heading: "1. What Ferreto is",
          body: (
            <>
              <p>Ferreto is software. It reads the website you give it, finds public conversations where people describe the problem your product solves, and drafts replies, direct messages, emails and posts for you. It is not an agency and does not provide human marketing or sales services.</p>
              <p>Ferreto does not reply to, message or email anyone on its own. You send replies, messages and emails yourself, from your own accounts. Posts are published only to accounts you have connected yourself, and only after you approve them or, if you turn on autopilot for a platform, at the time shown on a post you left untouched. You can turn autopilot off at any time.</p>
            </>
          ),
        },
        {
          heading: "2. Your account",
          body: <p>You must be at least 18 years old and give accurate information. You are responsible for activity under your account and for keeping the account you sign in with secure. Tell us at {SUPPORT_EMAIL} if you believe your account was used without permission. You can delete your account at any time in Settings › Account. Accounts that never make a purchase are deleted, with all their content, 30 days after sign-up; the app shows the date.</p>,
        },
        {
          heading: "3. Your content and your rights",
          body: (
            <>
              <p>You keep all rights to the content you give Ferreto (“Your Content”) and to the drafts Ferreto creates for you. You give us a limited licence to process Your Content only to provide the service to you.</p>
              <p>You confirm that you own Your Content or have permission to use it. Do not upload content you do not have rights to.</p>
            </>
          ),
        },
        {
          heading: "4. Public conversations and community rules",
          body: <p>Ferreto shows you publicly available posts and suggests how to reply. Those posts belong to their authors and platforms. When you reply, you do so as yourself and must follow each community’s rules, including rules about mentioning your own product. Ferreto points out the rules it can read, but you remain responsible for what you post. When you send a direct message or an email Ferreto drafted, you are the sender: you must follow the laws that apply to it, such as anti-spam and data protection laws, and stop contacting anyone who asks you to.</p>,
        },
        {
          heading: "5. Acceptable use",
          body: <p>You must follow our <Link href="/acceptable-use">Acceptable Use Policy</Link> and the rules of every platform you use. We may suspend or remove content or accounts that break it.</p>,
        },
        {
          heading: "6. AI output",
          body: <p>Drafts are generated with AI and can be wrong or incomplete. Review every draft before you post or approve it; you are responsible for what you publish.</p>,
        },
        {
          heading: "7. Plans and payment",
          body: (
            <>
              <p>Paid plans are subscriptions billed monthly or yearly. Each plan includes a fair-use allowance shown in the app; when it runs out, new searches pause until the next period. Free accounts get one free scan, as described in the app.</p>
              <p>Payments are processed by our payment provider acting as merchant of record, which also handles sales tax and invoices. You can cancel at any time from Settings. Refunds follow our <Link href="/refund">Refund Policy</Link>.</p>
            </>
          ),
        },
        {
          heading: "8. Third-party services",
          body: <p>Ferreto works with third-party services such as social networks, data providers and AI model providers. Their availability can change, and your use of them is governed by their own terms. Ferreto is independent and not affiliated with or endorsed by any social network it works with.</p>,
        },
        {
          heading: "9. Changes and termination",
          body: <p>We may change Ferreto or these terms; we will tell you about material changes by email or in the app. You may stop using Ferreto at any time. We may suspend accounts that break these terms or put other users or platforms at risk.</p>,
        },
        {
          heading: "10. Disclaimers and liability",
          body: <p>Ferreto is provided “as is”. We do not guarantee any particular result, such as replies, customers, reach or sales. To the extent permitted by law, our total liability is limited to the amount you paid us in the 12 months before the claim.</p>,
        },
        {
          heading: "11. Contact",
          body: <p>Questions about these terms: <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.</p>,
        },
      ]}
    />
  );
}
