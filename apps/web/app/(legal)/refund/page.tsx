import type { Metadata } from "next";

import { LegalPage } from "@/components/marketing/LegalPage";
import { SUPPORT_EMAIL } from "@/lib/site";

export const metadata: Metadata = { title: "Refund Policy", alternates: { canonical: "/refund" } };

export default function RefundPage() {
  return (
    <LegalPage
      title="Refund Policy"
      intro={<p>We want you to be happy with Ferreto. If something is wrong, write to us first: most problems can be fixed quickly.</p>}
      sections={[
        {
          heading: "Cancelling",
          body: <p>You can cancel your subscription at any time from Settings in the app. You will not be charged again.</p>,
        },
        {
          heading: "Refunds",
          body: (
            <>
              <p>You can request a full refund within 7 days of your first charge, on the monthly or the annual plan, if Ferreto was not right for you. After that, charges are not refunded, except that if Ferreto did not work as described, we will refund the charge for the affected period.</p>
              <p>Customers in the EU and UK keep their statutory right of withdrawal where it applies.</p>
            </>
          ),
        },
        {
          heading: "How to ask",
          body: <p>Email <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a> from your account email with the date of the charge. We reply within 2 business days. Refunds are issued by our payment provider, the merchant of record, to the original payment method.</p>,
        },
      ]}
    />
  );
}
