import type { Metadata } from "next";

import { LegalPage } from "@/components/marketing/LegalPage";
import { SUPPORT_EMAIL } from "@/lib/site";

export const metadata: Metadata = { title: "Privacy Policy", alternates: { canonical: "/privacy" } };

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy Policy"
      intro={<p>This policy explains what personal data Ferreto collects, why, and the choices you have. We collect only what we need to run the product.</p>}
      sections={[
        {
          heading: "What we collect about you",
          body: (
            <ul>
              <li><strong>Account data</strong>: your email address, name and profile picture from the sign-in you choose, and sign-in records.</li>
              <li><strong>Business information</strong>: the website you enter, the documents Ferreto writes from it, and the edits you make to them.</li>
              <li><strong>Your content</strong>: drafts, posts, replies you edit or mark as sent, and any files you upload.</li>
              <li><strong>Connected accounts</strong>: access tokens for social accounts you choose to connect, used only to publish what you approve.</li>
              <li><strong>Billing data</strong>: your plan and payment status. Card details are handled by our payment provider, never by us.</li>
              <li><strong>Usage data</strong>: basic logs and error reports needed to keep the service working and secure.</li>
            </ul>
          ),
        },
        {
          heading: "Public conversations we read for you",
          body: (
            <>
              <p>To find people who describe the problem your product solves, Ferreto searches publicly available posts on online communities and social networks. We keep what is needed to show them to you: the link, the community, the date, a short summary and short quotes. We do not collect private messages, and we do not build profiles of the people who wrote the posts. When a post links to the author’s own business website, Ferreto may read that site’s public contact page so you can reach them; we keep only what you choose to use.</p>
              <p>When we learn that a post was removed by its author or its platform, or when someone asks us to, we delete what we kept from it. To ask, email <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a> with the link.</p>
            </>
          ),
        },
        {
          heading: "How we use it",
          body: <p>To provide Ferreto, write drafts for you, publish what you approve, send the emails you choose to receive, bill you, answer support requests and keep the service secure. We do not sell personal data, and we do not use your content to train AI models.</p>,
        },
        {
          heading: "Service providers",
          body: <p>We use providers to run Ferreto: hosting, database and processing providers; AI model providers that process prompts to produce drafts; email delivery; providers of publicly available social data; publishing integrations for the accounts you connect; and our payment provider, which acts as merchant of record. They process data only on our instructions and under their own security obligations.</p>,
        },
        {
          heading: "Retention",
          body: <p>Account data and your content are kept while your account is open. Accounts that never make a purchase are deleted, with all their content, 30 days after sign-up; the app shows the date in advance. When you delete your account, we delete your content and personal data within 30 days, except records we must keep for legal or tax reasons.</p>,
        },
        {
          heading: "Your rights",
          body: <p>You can access, correct, export or delete your data, and stop any email from its own link or in Settings. Email <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a> and we will respond within 30 days. If you are in the EU or UK you may also complain to your local data protection authority.</p>,
        },
        {
          heading: "Changes and contact",
          body: <p>We will tell you about material changes by email or in the app. Questions: <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.</p>,
        },
      ]}
    />
  );
}
