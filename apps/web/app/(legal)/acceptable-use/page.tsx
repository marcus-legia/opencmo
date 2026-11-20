import type { Metadata } from "next";

import { LegalPage } from "@/components/marketing/LegalPage";
import { SUPPORT_EMAIL } from "@/lib/site";

export const metadata: Metadata = { title: "Acceptable Use Policy", alternates: { canonical: "/acceptable-use" } };

export default function AcceptableUsePage() {
  return (
    <LegalPage
      title="Acceptable Use Policy"
      intro={<p>Ferreto helps you find and talk to people who need what you built, as yourself. To keep it fair for those people and the communities they use, you may not use Ferreto for the things below. Breaking this policy can lead to removed content or a suspended account.</p>}
      sections={[
        {
          heading: "Ways you may not use Ferreto",
          body: (
            <ul>
              <li>Spam, bulk messaging, or contacting people who have asked not to be contacted.</li>
              <li>Sending the direct messages or emails Ferreto drafts in bulk, from a list, or to anyone other than the person whose post Ferreto showed you.</li>
              <li>Fake engagement: automated likes, follows, comments or reviews, or running several or fake accounts.</li>
              <li>Breaking a community’s rules, including posting product mentions where self-promotion is not allowed.</li>
              <li>Pretending to be someone else, or hiding that a product you recommend is yours where the community asks you to say so.</li>
              <li>Collecting, exposing or selling other people’s personal data.</li>
              <li>Trying to bypass limits, access other users’ data or disrupt the service.</li>
            </ul>
          ),
        },
        {
          heading: "Content you may not create or publish",
          body: (
            <ul>
              <li>Sexual, explicit or sexually suggestive content of any kind.</li>
              <li>Deepfakes, or images, voices or likenesses of real people used without their consent.</li>
              <li>Content you do not own or have the rights to use.</li>
              <li>Hate, harassment, violence, or content that exploits or endangers minors.</li>
              <li>Illegal content, scams, misleading health or financial claims, or “get rich quick” promotions.</li>
            </ul>
          ),
        },
        {
          heading: "Images and video",
          body: <p>Images and video Ferreto generates for you are screened before and after they are created. Requests and results that break this policy are refused. You may not create realistic images of real, identifiable people, or anything that imitates a brand, logo or product you do not own.</p>,
        },
        {
          heading: "Reporting",
          body: <p>Report abuse, misuse of a public post, or copyright concerns to <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>. We review every report.</p>,
        },
      ]}
    />
  );
}
