# Preview Feature — Proposal (postponed)

Status: **not implemented, postponed by decision on 2026-08-11.** This document exists so the
reasoning and research aren't lost before work resumes.

## Background

`company-page` used to have a `/preview` page and `api/preview.ts` endpoint that let a visitor
enter a URL and get an "instant" renovated-site demo. Both were removed 2026-08-11 because:

- The endpoint's "instant" results came from a **hardcoded whitelist of 41 slugs** pointing at
  `new/{slug}/` — static demo files, not real generation.
- Its fallback path (when a URL wasn't in the whitelist) dispatched GitHub Actions to
  `The-InSite/HTML-templates-production` and `The-InSite/ssp-website-generator` — the **old**
  generation pipeline, which has been superseded by Static-Studio (Astro + Strapi CMS, VM-built,
  deployed per-client at `{slug}.theinsite.dev`).
- The `new/{slug}/` directories it depended on (last touched 2026-04-16) were themselves removed
  as dead output of the old pipeline.

So the feature needs to be rebuilt against Static-Studio's actual, current capabilities — not
reconnected to what was there before.

## What Static-Studio can actually support today

Researched from `~/Projects/Static-Studio/docs/` (`production-deployment-architecture.md`,
`vercel-deployment.md`, `pipeline-contracts.md`, `admin-generate-page-cloud-run-flow.md`,
`admin-repo-generate-page-runner-instructions.md`, `plan.md`,
`infra-partner-recommendations-multiclient-i18n.md`) on 2026-08-11:

1. **Full-pipeline generation exists, but is admin-only and untimed.**
   `POST /renovation-api/jobs` on the CMS runs the full `crawl → extract → images → map →
   compile → build → deploy` pipeline asynchronously (poll for job status). Its bearer token is
   documented as server-side only. No stage has documented timing anywhere in the docs — could be
   seconds or minutes, nobody has measured it. The newer Cloud Run version of this job runner is
   explicitly flagged as "not production-ready — needs durable job storage before permanent
   Admin UI rollout."
   → **Not safe to call directly from a public, unauthenticated page today.**

2. **The tier-0 audit engine — the right thing to put behind a public button — is spec'd but not
   built.** Per the business plan (`docs/business-plan.md`, gap #4) and `docs/plan.md`, it's meant
   to be a ~1s single-page fetch scoring title/meta/H1/structured-data/canonical/mobile/response
   time — explicitly *no crawl, no DB writes, no images, no compile*. Cheap enough to run against
   thousands of anonymous URLs. Not implemented in code yet.

3. **No cost or isolation headroom for public/anonymous full-preview generation.** Self-serve
   tenant cost ceiling is ~$5/site/month all-in; a single always-on Strapi instance alone runs
   ~$5–8/month — already over budget before adding preview-specific compute. There's no isolation
   tier for random internet visitors triggering full builds; that's open infra work, not something
   `company-page` can route around.

## Recommended shape (for when this resumes)

Two tiers, matching the business plan's own funnel design (§3: mass tier-0 audits → full preview
only for the ~35% of repliers who engage) rather than faking step 2 as step 1's UX, which is what
the old whitelist hack was really doing.

**Step 1 — instant, real, public.**
Visitor enters their URL → a new, cheap tier-0 audit endpoint (needs to be built — this is the one
piece of net-new work required) returns a genuine computed diagnostic: which SEO/structure signals
are missing, e.g. "6 of 12 signals need work," with specifics. Safe to expose publicly because it's
just a fetch + score, no crawl, no storage. This is also a better fit for the "proprietary
algorithm, not AI magic" positioning than a canned demo swap — it's a real result, not a mockup.

**Step 2 — full rebuild preview, requested, not instant.**
"Want to see it rebuilt?" captures email (and maybe name), and queues a real job through the
existing admin-side generation pipeline — triggered by a human (or later, an automation once the
Cloud Run job runner has durable job storage) rather than fired directly from the public page. The
visitor is told "we'll email your preview," not shown a fake real-time progress spinner the infra
can't back yet. The resulting link is a real `preview-{slug}.theinsite.dev` staging URL, noindexed,
using the same mechanism that already works for admin-triggered previews today.

## Explicitly deferred

- A live, real-time "watch your site rebuild" experience. Blocked on the Cloud Run job runner
  getting durable job storage and per-request isolation — infra work outside `company-page`.
- Any public/anonymous path that triggers the full pipeline directly. Blocked on cost ceiling and
  isolation tier not existing yet for anonymous callers.

## Next steps when this resumes

1. Build the tier-0 audit endpoint (spec already exists in Static-Studio's `docs/plan.md`,
   "Epic: Commercial Readiness"). This is shared infrastructure — Channel 1's outreach funnel needs
   it too, so it isn't `company-page`-specific work.
2. Design the step-2 request-capture form and decide the notification mechanism (email queue vs.
   manual trigger by Pavel) for the full-preview job.
3. Rebuild `/preview` on `company-page` against the above, once both exist.
