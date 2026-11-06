# Release 2026-11-06: integrated production candidate

Base: 638b1ed0 (published homepage), retaining existing body/model-matching and CRM workbench fixes.

## Validation
- TypeScript typecheck passed.
- Full npm run qa passed; 651 tests, zero failures.
- Additional auth/admin/ownership/payment checks: 42 passed.
- Additional mail and staging migration checks: 24 passed.
- Staging: public health 200; payment methods card/klarna; unauthenticated customer/admin 401; unsigned webhook 400. Ops and legacy payment test case inspected in authenticated Chrome.
- Staging journal 0001–0004 was already applied. Applied only missing 0005 staff invite tables and 0006 mail metadata.
- Actual production schema exported without data, migration rehearsed in SQLite, integrity_check passed.
- Production migration: migrations/production-release/0001_payment_ownership_staff_mail.sql, separate fbg_release_migrations journal. Adds only columns/tables/indexes. Existing inquiries were not assigned owners by email.

## Boundaries
Live Stripe Checkout explicitly disabled. Gmail folder sync explicitly disabled pending sender/case isolation review. Available payment logos are feature gated and do not advertise active live methods. End-to-end sandbox completion and refunds have not been demonstrated in this release. Existing active CRM offer model still needs a payment adapter; legacy confirmed glass_quotes can create sandbox payment links.

## Recovery
Pre-migration D1 Time Travel bookmark: 0000134b-00000004-0000511b-a395a0519dd8162fb3297f0c218c28e9
Prior production worker version: a11c80fc-9495-4732-a42d-1315e9b8e0cd.
Roll back Worker version first; all schema changes are additive and compatible with the prior worker. Do not restore D1 blindly: a restore overwrites later customer writes. Schema export contains no customer data.

## Original work
Source worktree /Users/taj/finnbilglass-release preserved. Only reviewed application code/assets/migrations/tests copied into a separate release branch. No customer database, PDF, screenshots or credentials included.
