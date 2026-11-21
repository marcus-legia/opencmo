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
              <li><strong>Connected accounts</strong>: access tokens for social accounts you choose to connect, used only to publish what you approve or set to post on autopilot, and to read how those posts did.</li>
              <li><strong>Billing data</strong>: your plan and payment status. Card details are handled by our payment provider, never by us.</li>
              <li><strong>Usage data</strong>: basic logs and error reports needed to keep the service working and secure, and anonymous page-speed measurements.</li>
            </ul>
          ),
        },
        {
          heading: "Public conversations we read for you",
          body: (
            <>
              <p>To find people who describe the problem your product solves, Ferreto searches publicly available posts on online communities and social networks. We keep what is needed to show them to you: the link, the community, the date, a short summary and short quotes. We do not collect private messages, and we do not build profiles of the people who wrote the posts. When a post links to the author’s own business website, Ferreto may read that site’s public pages for an email address the author published, so you can reach them. We keep that address with the conversation it came from, and it is deleted with that conversation or on request.</p>
              <p>Anyone can ask us to delete what we kept from their post, and we do. To ask, email <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a> with the link. When Ferreto notices that a post was removed, it records that, and we delete what we kept from it on request.</p>
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
          heading: "Cookies",
          body: <p>We use only the cookies needed to keep you signed in and to keep the service secure. One more first-party cookie remembers which link first brought you here (a campaign name such as "ph" and the host of the linking site, nothing that identifies you) for 30 days, so we can count sign-ups by channel. We do not use advertising or third-party tracking cookies, and the page-speed measurements we collect set no cookies.</p>,
        },
        {
          heading: "Retention",
          body: <p>Account data and your content are kept while your account is open. Accounts that never make a purchase are deleted, with all their content, 30 days after sign-up; the app shows the date in advance. When you delete your account, we delete your content and personal data within 30 days, except records we must keep for legal or tax reasons.</p>,
        },
        {
          heading: "Your rights",
          body: <p>You can access, correct, export or delete your data, and stop any email from its own link or in Settings. You can delete your account yourself in Settings › Account. For anything else, email <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a> and we will respond within 30 days. If you are in the EU or UK you may also complain to your local data protection authority.</p>,
        },
        {
          heading: "Changes and contact",
          body: <p>We will tell you about material changes by email or in the app. Questions: <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.</p>,
        },
      ]}
    />
  );
}
