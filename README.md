# BirgenAI_LMS

AI-native, multi-tenant loan origination & management platform (`lms.birgenai.com`).
BirgenAI Hub, Micromart Africa, Axe Capital and Buy Simu are the first organizations;
any licensed lender can self-onboard their own — branding, branches, users, roles,
products, approval workflows, paybill, SMS and scoring, fully isolated per tenant.

**BirgenAI is the technology provider; the licensed lender is always lender-of-record.**

## The blueprint

Everything — scope, users, journeys, scoring routing, money movement, phases, and the
confirmed founder decisions — lives in **[docs/LMS-2.0-BLUEPRINT.md](docs/LMS-2.0-BLUEPRINT.md)**.
Read it first.

## Stack

- **Next.js (App Router, TypeScript, Tailwind v4)** — mobile-first borrower portal
  (white background + glass, per-org `--brand` accent) + staff console.
- **Prisma + PostgreSQL (+ RLS)** — dedicated database; every tenant row carries `orgId`.
- **Org integrations vault** — per-org encrypted configs (Daraja STK/B2C, SMS, SMTP,
  CRB, KYC, ServiceSuite bridge) in `OrgIntegration.configEnc`; no per-tenant env vars.
- **Scoring** — thin-file M-Pesa cruncher + origination engines (v2 bespoke / v3 pooled)
  fused server-side; v1 behavioral for portfolio early warning.
- **Bridged mode** — Micromart/Axe/BuySimu keep their ServiceSuite loan book; the
  adapter reads eligibility/Customer-360 and posts approved applications via
  `sp_InsertLoan` into the BirgenAI workflow (exactly like the live Micromart pilot).

## Getting started

```bash
npm install
cp .env.example .env        # fill DATABASE_URL/DIRECT_URL (dedicated Postgres) + secrets
npx prisma db push          # create schema (dev) — migrations come with Phase 2
npx prisma db seed          # seed the four launch orgs
npm run dev
```

## Project layout

- `src/app` — routes (borrower portal, staff console, API)
- `prisma/schema.prisma` — core data model (Phase 0 cut)
- `prisma/seed.ts` — launch orgs (hub · micromart · axe · buysimu)
- `docs/LMS-2.0-BLUEPRINT.md` — the approved build spec

## Phase status

- [x] Phase 0 — scaffold, schema, tokens, seed orgs
- [ ] Phase 1 — port the origination funnel (eligibility → consent → cruncher → score → post)
- [ ] Phase 2 — native LMS core (org onboarding, products, workflows, money, comms)
- [ ] Phase 3 — elite KYC + field (liveness, face match, IPRS, RO routes)
- [ ] Phase 4 — Intelligence Suite + billing
- [ ] Phase 5 — scale & migrate
