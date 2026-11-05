# Operation Center uten nye abonnementer — Implementation Plan

> For agentic workers: execute inline with superpowers:executing-plans. No new subscriptions or automatic paid upgrades.

**Goal:** One case workspace for follow-up, email, checked quotes, customer acceptance and direct delivery. Invoice integration remains paused.
**Architecture:** Add a separate workbench to existing Access-protected /ops. Existing inquiries, catalogue and history remain authoritative. Additive 0051 tables hold work state, immutable offer snapshots, email delivery and audit events. Resend remains the mail transport. Customer links use a dedicated HMAC secret; access does not grant administrator privileges.
**Tech Stack:** Existing Workers, D1, browser JavaScript, Resend Free; Web Crypto, no new package.
**Spec:** User approved the workflow in this chat and clarified: no new subscriptions; use existing included quotas.

## Global constraints
- Reuse /tmp/fbg-architect; preserve main dirty tree and /tmp/fbg-vinfix.
- Production changes require a reviewed isolated release; new work goes to local/staging first.
- No new CRM, invoicing provider, AI calls, paid automation, cron or billable addon.
- Do not change support mailbox MX or activate inbound routing without a verified route.
- A draft is not an invoice; accepted offer does not automatically buy from supplier.
- Money is integer ore. Confirm glass, price, freight and delivery before sending.
- Webhooks: verified signatures, replay window, deduplication, nonregressing delivery state.
- Existing quote/history is preserved and visible.

## Review focus
- Double click/retry must not send twice or create duplicate offer versions.
- Old/expired offers cannot be accepted; no mutation on link GET.
- Customer message HTML never executes. Unknown case/sender goes to unmatched queue.
- Test cases excluded by default; evidence-only records labelled as such, never #—.
- Actor from verified session, never client-supplied name. Offer totals do not trust client totals.

## Tasks
- [x] 1. Add domain logic, 0051 additive schema and business-rule tests.
- [x] 2. Implement Access-gated workbench API, immutable quotes, acceptance and audit.
- [x] 3. Add send/outbox tracking, signed Resend events and safe inbound ingestion. No live mailbox migration.
- [x] 4. Build responsive workspace with priority queue, next task, templates, quotes and delivery.
- [x] 5. Local E2E with synthetic mail, concurrency/expiry/security tests; run relevant QA.
- [x] 6. Apply only 0051 to staging, configure dedicated staging secrets, deploy and browser-test. Do not send to customers.
- [x] 7. Commit report, exact limitations and production integration instructions. Keep old production unchanged until this package is reviewed.

Ruling: Code and staging complete. Live mailbox/provider routing stays disconnected until the production package is integrated; do not route real customers to staging. Browser Access handoff completed and actual staging save verified. No new paid subscriptions.

## Production continuation 2026-11-05
User: finish through production, ready for CRM and invoices; existing quotas only.
- [x] Preserve current production source: downloaded Worker compared to main dry-run, exact match except existing local VIN plausibility patch. 16 public files + facts page byte-match live; min-side.html protected redirects to login. Imported only these production source changes into isolated tree.
- [x] Structured case customer, optimistic locking, accepted frozen offer export (not invoice). New additive 0052.
- [x] Independent review; country validation and draft-send timing findings fixed with RED/GREEN tests. 646 full QA PASS, 31 workbench tests, typecheck/syntax green.
- [x] Database backup taken before migrations; full Worker source/settings snapshot retained locally.
- [ ] Apply only 0051 + 0052 in production after same-dump rehearsal; set scoped feature vars/secrets; deploy tagged exact SHA.
- [ ] Replace old root-domain ops repair UI by fixed redirect; keep Access policies intact.
- [ ] Verify live browser, customer flow, signed provider event and invoice basis.
No real invoice, new subscription, 0050, catalogue mutation or mailbox MX change.
