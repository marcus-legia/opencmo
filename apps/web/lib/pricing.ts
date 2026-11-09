/**
 * The plans: quotas and features, keyed by plan id. Prices and credits on sale live only in `billing_catalog`
 * (`lib/billing-catalog.ts`). The paid plans here carry no price (0): a page with no catalogue row for a plan shows no
 * price for it rather than a number that may be stale (cmo-review-2 S2.7).
 *
 * Two things copied from Opus Clip (OPUSCLIP.md §3.10) because the market has proved them:
 *   1. A permanent struck-through list price on the annual plan, not a time-limited offer.
 *   2. The cheapest paid tier already drops the watermark. It only pushes people past the FIRST payment.
 */

// Server-side, like the catalogue it goes with. `check:pricing` runs outside Next, hence `--conditions=react-server` (`package.json`).
import "server-only";

export type PlanId = "free" | "starter" | "creator";

export type Plan = {
  id: PlanId;
  name: string;
  /** Giá gốc, để gạch ngang. Bỏ trống nếu không có. */
  listPrice?: number;
  /** Giá quy ra mỗi tháng — số in to trên landing và billing. */
  price: number;
  /** Chu kỳ thu tiền. Gói năm thu `price * 12` một lần (`billedPrice`). */
  interval: "month" | "year";
  billedPrice: number;
  credits: number;
  previewsPerDay: number;
  exportsPerDay: number;
  /** Trần chiều cao export editor; client không được tự nâng vượt gói. */
  maxExportResolution: 720 | 1080;
  watermark: boolean;
  features: string[];
  highlight?: boolean;
  quota: { previews: number; exports: number; storageBytes: number; storageObjects: number };
};

export const PLANS: Plan[] = [
  {
    id: "free",
    name: "Free",
    price: 0,
    interval: "month",
    billedPrice: 0,
    credits: 30,
    previewsPerDay: 20,
    exportsPerDay: 5,
    maxExportResolution: 720,
    watermark: true,
    quota: { previews: 20, exports: 5, storageBytes: 2 * 1024 ** 3, storageObjects: 200 },
    // Gói `free` KHÔNG còn là một bậc dùng được: nó là trạng thái "chưa mua".
    // Quà đăng ký đã bỏ (migration 20260921150000), nên nói đúng như vậy thay
    // vì liệt kê tính năng của một thứ không chạy được.
    features: [
      "No monthly credits — pick a plan to add more",
      "Auto captions",
      "Watermarked exports",
      "Account deleted 30 days after sign-up unless you buy a plan",
    ],
  },
  // One price, paid monthly or yearly. The ids stay `starter`/`creator` because `plan_quota`, both webhook RPCs and
  // their constraints name them; changing an id is a migration of its own.
  {
    id: "starter",
    name: "Monthly",
    price: 0,
    interval: "month",
    billedPrice: 0,
    credits: 0,
    previewsPerDay: 100,
    exportsPerDay: 30,
    maxExportResolution: 1080,
    watermark: false,
    quota: { previews: 100, exports: 30, storageBytes: 10 * 1024 ** 3, storageObjects: 1000 },
    features: [
      "AI CMO + Post, Video and Sales departments",
      "Monthly credits",
      "No watermark, full-resolution 1080×1920 download",
    ],
  },
  {
    id: "creator",
    name: "Annual",
    price: 0,
    interval: "year",
    billedPrice: 0,
    credits: 0,
    previewsPerDay: 300,
    exportsPerDay: 100,
    maxExportResolution: 1080,
    watermark: false,
    quota: { previews: 300, exports: 100, storageBytes: 25 * 1024 ** 3, storageObjects: 2500 },
    highlight: true,
    features: ["Everything in Monthly, billed once a year"],
  },
];

// Hai hằng số này sống ở `lib/credits.ts` vì màn tạo job (client component)
// cần chúng, còn file này thì `server-only`. Re-export để caller phía server
// không phải nhớ chúng nằm ở đâu.
export { CREDITS_PER_MINUTE, JOB_HOLD_CREDITS } from "./credits";

/** A plan with the catalogue's price and monthly credits. `monthlyCents` is the struck-through list price of an annual plan. */
export function withCatalogPrice(plan: Plan, priceCents: number, credits: number, monthlyCents?: number): Plan {
  const billed = priceCents / 100;
  const year = plan.interval === "year";
  return {
    ...plan,
    price: year ? Math.round(priceCents / 12) / 100 : billed,
    billedPrice: billed,
    credits,
    listPrice: year && monthlyCents ? monthlyCents / 100 : plan.listPrice,
    features: year
      ? [`Everything in Monthly, ${credits} credits every month, billed $${billed} once a year`]
      : plan.features.map((feature) => (feature === "Monthly credits" ? `${credits} credits per month` : feature)),
  };
}

/**
 * Paid = one of the two plans on sale. Same rule as SQL `is_paid()`: an unknown or missing
 * `profiles.plan` is unpaid, so a typo in a webhook can't unlock paid features.
 */
export function isPaidPlan(plan: string | null | undefined): boolean {
  return plan === "starter" || plan === "creator";
}

export function planById(id: string): Plan | undefined {
  return PLANS.find((p) => p.id === id);
}
