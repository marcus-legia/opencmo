/**
 * Lighthouse CI (.github/workflows/lighthouse.yml; plan docs/plans/engineering/2026-11-15-lighthouse-ci-plan.md).
 *
 * The public pages a founder lands on, on a production build (`next start`), three runs each (the median counts:
 * a CI runner is noisy). Lighthouse's default is a mid-range phone on a slow 4G link, which is the founder reading a
 * link from X.
 *
 * Every assertion is a warning for now: the first week of runs sets the baseline, then the budgets below become
 * errors (owner decision, step 2 of the hardening backlog).
 */
const BASE = process.env.LHCI_BASE_URL || "http://127.0.0.1:3200";

/**
 * The budgets, as warnings. Baseline 2026-11-15 (local): the plan lists each page's medians. Timing checks take the
 * median run; accessibility, best practices and SEO do not depend on timing, so they take the worst run, which catches a
 * page that drops its meta description on some loads.
 */
function budgets({ seo }) {
  return {
    "categories:performance": ["warn", { minScore: 0.8, aggregationMethod: "median-run" }],
    "categories:accessibility": ["warn", { minScore: 0.95, aggregationMethod: "pessimistic" }],
    "categories:best-practices": ["warn", { minScore: 0.95, aggregationMethod: "pessimistic" }],
    ...(seo ? { "categories:seo": ["warn", { minScore: 0.95, aggregationMethod: "pessimistic" }] } : {}),
    "largest-contentful-paint": ["warn", { maxNumericValue: 2500, aggregationMethod: "median-run" }],
    "cumulative-layout-shift": ["warn", { maxNumericValue: 0.1, aggregationMethod: "median-run" }],
    "total-blocking-time": ["warn", { maxNumericValue: 200, aggregationMethod: "median-run" }],
    // JavaScript a page downloads, in bytes (compressed).
    "resource-summary:script:size": ["warn", { maxNumericValue: 350_000 }],
  };
}

module.exports = {
  ci: {
    collect: {
      url: ["/", "/blog", "/blog/write-x-thread", "/login"].map((path) => `${BASE}${path}`),
      numberOfRuns: 3,
      settings: {
        // The runner is a container: Chrome needs these to start.
        chromeFlags: "--no-sandbox --headless=new",
        // Next streams metadata into <body> for a browser's user agent, and Lighthouse's is one, so this audit saw the
        // description on some loads only. Link-preview bots get it in <head>; `lighthouse/preview-meta.mjs` checks
        // that instead, in the same job.
        skipAudits: ["meta-description"],
      },
    },
    assert: {
      // `/login` is kept out of search on purpose (noindex, no description): it has no SEO budget.
      assertMatrix: [
        { matchingUrlPattern: "^(?!.*/login$).*$", assertions: budgets({ seo: true }) },
        { matchingUrlPattern: "/login$", assertions: budgets({ seo: false }) },
      ],
    },
    upload: {
      // Reports stay with the run (an artifact), not on a third-party server.
      target: "filesystem",
      outputDir: ".lighthouseci/reports",
    },
  },
};
