# InternScout AI — Implementation Plan

> Phased roadmap addressing the technical audit. Ordered by risk × effort, not strictly by "priority label," so the highest-leverage fixes come first regardless of size.
>
> **Status tracking:** this file is updated as each task is completed. Status key: ⬜ not started · 🔶 in progress · ✅ done. Every Codex prompt from here on out includes an instruction to update this file's status when it finishes a task, so it stays a live source of truth rather than a static plan.

---

## Phase 0 — Foundational (do first, blocks other work)

These unblock everything else or prevent active data-integrity risk. Target: 1 week.

| # | Status | Task | Why first | Effort |
|---|---|---|---|---|
| 0.1 | ✅ | Reverse-engineer and commit migrations for `saved_internships`, `profiles`, `public.users` | Undocumented schema = no safe way to touch these tables in later phases; also a bus-factor/reproducibility risk | S (1-2 days) |
| 0.2 | ✅ | Run `supabase db pull` (or manual dashboard export) against production, diff against `supabase/migrations/`, commit the gap | Confirms 0.1 is complete and accurate | S |
| 0.3 | ✅ | Add rate limiting to `/api/search` (public endpoint) | Currently unprotected against credit-exhaustion abuse of Firecrawl/Gemini | S (few hours — Vercel KV/Upstash rate limiter, or Supabase-based token bucket) |
| 0.4 | ✅ | Add magic-byte content-sniffing on PDF upload (don't trust `Content-Type` header) | Cheap insurance before you touch the extraction pipeline in Phase 1 | XS |

**Progress notes:**
- PDF resume uploads now perform a five-byte `%PDF-` magic-byte check before storage or extraction, rejecting spoofed non-PDF content while preserving the existing type and 5 MB checks. Reads the file buffer once (existing duplicate byte-read consolidated). Committed to repo.
- Schema for `saved_internships` and `profiles` reverse-engineered from production (columns, PK/FK, RLS policies confirmed via SQL Editor queries).
- Confirmed `public.users` does not exist as a standalone table — `profiles.id` references `auth.users(id)` directly (standard Supabase pattern).
- Migration `016_document_saved_internships_and_profiles.sql` drafted, reviewed (added `to authenticated` scoping and `WITH CHECK` on UPDATE policies), and **applied to production via SQL Editor**. Verified post-apply: 7 RLS policies present, `with_check` populated on both UPDATE policies. Committed to repo.
- Used manual SQL Editor application instead of `supabase db pull`/CLI push since Docker Desktop isn't installed locally — this satisfies 0.2's intent (schema gap closed and version-controlled) without needing Docker for this specific task.
- Rate limiting (0.3) implemented via Postgres, not Upstash — chosen to avoid adding a new external service. Built `api_rate_limits` table (identifier, route, window_start, request_count; unique per identifier+route+window) and `check_rate_limit()` function (atomic upsert via `ON CONFLICT ... RETURNING`, `security definer`, locked to `service_role` only via `revoke`/`grant`). Limit set to 10 requests per 60-second window, both values as named constants in `search/route.ts` for easy tuning. Identifier resolution: authenticated user ID first, falling back to `x-forwarded-for`/`x-real-ip` header, then `"unknown"`. On rate-limit-exceeded, returns 429 with `Retry-After: 60` before any Firecrawl/Gemini work runs. On DB/infra errors during the check itself, fails open (allows the request, logs the error) so a limiter outage doesn't take down the whole search feature. Migration `017_add_rate_limiting.sql` reviewed, approved, and **applied to production via SQL Editor**. Verified post-apply: `api_rate_limits` has RLS enabled with zero permissive policies; `check_rate_limit()` is `security definer` with `EXECUTE` granted only to `service_role`. Live-tested via direct SQL calls and via the route with empty-body requests (zero Firecrawl cost) — first 10 requests passed the rate limiter (400 on invalid filters), requests 11-12 correctly returned 429. Committed and pushed.
- **Process note:** an earlier attempt to have Codex update this plan file resulted in it being overwritten from an outdated version, silently losing the 0.1/0.2 status and progress notes (also introduced UTF-8 encoding corruption on em-dashes/× symbols). This was caught by diffing before committing. Going forward, always paste the current file content back for verification after any Codex edit to this file, not just a diff summary.

**Exit criteria:** All tables have committed migrations; search endpoint rejects excessive requests; upload validates real file content.

---

## Phase 1 — Resume Pipeline Rebuild

This is your highest-impact single fix — bad PDF extraction poisons every downstream feature (match score, Copilot) silently. Target: 1 week.

| # | Task | Detail | Effort |
|---|---|---|---|
| 1.1 | Swap TextDecoder heuristic for `pdf-parse` or `pdfjs-dist` | Drop-in library replacement in the upload route; keep the same sanitize/truncate steps downstream | M (2-3 days incl. testing against varied resume formats: Canva, LaTeX, Google Docs export, scanned/image-based) |
| 1.2 | Add extraction-quality guardrail | If extracted text is suspiciously short (e.g. <200 chars) or mostly non-printable, flag to the user instead of silently proceeding with garbage | S |
| 1.3 | Re-test resume match scoring against real extracted text | Confirms the swap didn't change sanitize/truncate assumptions | S |
| 1.4 | (Stretch) Handle scanned/image-only PDFs | Either explicit "we can't read this, please upload text-based PDF" message, or OCR fallback (Tesseract.js) if you want to support it | M, optional |

**Exit criteria:** Resumes from at least 4-5 different real-world export sources extract cleanly; garbage extraction is caught and surfaced, not silently scored.

---

## Phase 2 — Search Quality & Data Integrity

Target: 1-2 weeks, can run partially in parallel with Phase 1 (different codepaths).

| # | Task | Detail | Effort |
|---|---|---|---|
| 2.1 | Add JSON-LD / `JobPosting` schema.org extraction as first-pass, before markdown regex heuristics | Scan Firecrawl's raw HTML for `<script type="application/ld+json">`; parse `JobPosting` fields (company, title, location, employmentType, validThrough, salary); fall back to current heuristics only when absent | M |
| 2.2 | Add Open Graph fallback (`og:title`, `og:description`) as a second-tier source | Cheap addition alongside 2.1 | S |
| 2.3 | Persist real posting dates from 2.1 where available | Directly fixes "posting freshness depends on available source timestamps" limitation | S |
| 2.4 | Pin/version-check Gemini model config | Add a startup check that validates the configured model string against a known-good list, or catch 404 "model deprecated" errors specifically and log a loud, actionable warning (not just a generic failure) — you already got burned by this once | S |
| 2.5 | Define and document explicit cache-freshness TTL | Tune per source type if ATS-hosted postings churn faster than static pages; make the number visible in code, not implicit | XS |
| 2.6 | Add adaptive query expansion | If post-dedup candidate count < 2 after the initial 5 queries, fire 1-2 additional targeted queries before giving up | M |
| 2.7 | Replace aggregator denylist with structural detection (stretch) | Detect pages with repeated `JobPosting`-like structures / listing-card DOM patterns instead of hardcoded domains | L, optional — denylist is "good enough" short-term |

**Exit criteria:** A sample of 20-30 real postings across different ATS platforms show structured-field extraction working before falling back to heuristics; Gemini model deprecation produces a clear log/alert instead of silent failures.

---

## Phase 3 — Matching Quality (Semantic Search)

Target: 1-2 weeks. Depends on Phase 1 (clean resume text) being done first.

| # | Task | Detail | Effort |
|---|---|---|---|
| 3.1 | Enable `pgvector` extension in Supabase | One-time DB setup | XS |
| 3.2 | Add embedding generation step for resume text and job descriptions | Use Gemini's embedding endpoint (or a dedicated embedding model) at persistence time for internships, and at upload/match time for resumes | M |
| 3.3 | Store embeddings as vector columns; add cosine-similarity query | New migration + a match-scoring function that blends embedding similarity with existing deterministic keyword scoring | M |
| 3.4 | A/B the blended score against current deterministic-only score | Validate it actually improves match quality on real data before fully switching over | S |
| 3.5 | (Stretch) Build a lightweight skill-synonym map as a cheaper interim fix | If full embedding work is deferred, a synonym dictionary (React/React.js, ML/Machine Learning, etc.) is a same-day fix that reduces false negatives immediately | XS, optional pre-step |

**Exit criteria:** Match scores correctly reflect near-synonym skills that were previously scored as non-matches; blended scoring shown to outperform keyword-only on a sample set.

---

## Phase 4 — Testing & Reliability

Target: ongoing, but front-load the RLS/save-flow tests since they're security-adjacent. 1 week focused effort.

| # | Task | Detail | Effort |
|---|---|---|---|
| 4.1 | Mocked integration tests: Save Job → UUID propagation | Covers the exact failure mode your `/api/internships/lookup` repair mechanism exists to patch | M |
| 4.2 | Mocked integration tests: RLS policy behavior per table | Confirm ownership checks actually reject cross-user access, not just that they exist in migrations | M |
| 4.3 | Contract test on Gemini response shape | Validate match/Copilot JSON parsing against a schema before trusting Gemini output; fail loud and fall back deterministically on mismatch | S |
| 4.4 | Circuit breaker / backoff for repeated Firecrawl failures | If Firecrawl fails N times in a row, serve cache-only for a cooldown window instead of continuing to burn budget on a degraded service | M |

**Exit criteria:** CI runs integration tests alongside existing unit tests; a Firecrawl or Gemini outage degrades gracefully and visibly rather than silently.

---

## Phase 5 — Search Infrastructure (only if/when catalog scale justifies it)

Not urgent — revisit once the `internships` table is large enough that Postgres full-text search starts straining, or you want faceted browse UX beyond current filters.

| # | Task | Detail | Effort |
|---|---|---|---|
| 5.1 | Start with Postgres `tsvector` full-text search | Zero new infra, likely sufficient for a while | S |
| 5.2 | Migrate to Meilisearch or Typesense if/when FTS strains | Self-hosted or managed; adds typo-tolerance and fast faceting (role, location, stipend, skills) | L, deferred |

**Exit criteria:** Only pursue if you observe actual query latency or UX limitations with Postgres FTS — don't pre-optimize.

---

## Suggested sequencing (rough timeline)

```text
Week 1     Phase 0 (foundational) + start Phase 1 (PDF parser)
Week 2     Finish Phase 1 + start Phase 2 (structured extraction, Gemini pinning)
Week 3     Finish Phase 2 + start Phase 4 (integration tests, since Save/RLS risk is independent of matching work)
Week 4-5   Phase 3 (semantic matching) — biggest single chunk, do once resume text is trustworthy
Ongoing    Phase 4 test coverage expands alongside every phase above
Deferred   Phase 5, revisited only when catalog scale demands it
```

## Effort key
XS = a few hours · S = 1-2 days · M = 2-4 days · L = a week+

---

## Notes on what NOT to touch yet

- Domain-cap percentage math (2.7 in the original audit's structural-detection item, and the 40%/cap-of-3 rule) — flagged as worth *monitoring*, not fixing outright. Only revisit if you observe real starvation on small result sets.
- Session-storage restoration fallback — worth confirming `search_history` can serve as a DB-backed fallback, but this is a UX polish item, not correctness-critical. Low priority.
- OCR for scanned resumes (Phase 1.4) — explicitly marked optional; a clear rejection message is an acceptable interim solution.
