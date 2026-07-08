# BirgenAI_LMS — Full Fintech SaaS Blueprint (LMS 2.0)

**Status:** APPROVED by founder · 8 July 2026 (decisions locked in §13)
**Repo:** https://github.com/emmanuel-arch/BirgenAI_LMS
**Home:** `Documents/BIRGEN AI 2.0/lms/` (standalone Next.js project, own git repo)
**Replaces:** the `/lms` route embedded in BIRGEN AI 1.0.0 (`birgen-ai-frontend/src/app/lms`)
**Companion docs:** `birgen-ai-frontend/BirgenAI-Fintech-Master-Plan-v1.pdf` (strategy), this file (build spec)

---

## 1. What we are building (one paragraph)

A standalone, multi-tenant, AI-native **loan management + origination platform** at `lms.birgenai.com`,
where **BirgenAI Hub, Micromart, Axe, and Buy Simu are the first four organizations** and any new
lender can self-onboard their own organization (branding, branches, users, roles, products,
workflows, paybill, SMS, scoring) — the same "every entity feels like its own system" model the
ServiceSuite shared DB proves with ~27 live entities segmented by EntityID — but rebuilt clean,
Tala-grade on the borrower side, with the full **Lending Intelligence Suite** (Credit Scorer,
M-Pesa Statement Cruncher, Document Parser, CRB Orchestrator, ID Verifier, Riri "Talk to your DB",
Portfolio Early Warning) wired into its menus and workflows. BirgenAI remains the technology
provider; the licensed lender is always lender-of-record.

---

## 2. What exists today (verified in code + live DB)

### 2.1 Current lms.birgenai.com (inside BIRGEN AI 1.0.0)

End-to-end flow, all server-authoritative:

1. **Lender detection** — subdomain (`micromart.birgenai.com`) or chooser; white-label branding via
   `src/lib/lms/branding.ts` (per-lender logo/accent/hero, "Powered by BirgenAI"). White background +
   glass panels (`GLASS` constant in `src/app/lms/page.tsx`).
2. **Eligibility** (`/api/lms/eligibility`) — phone (+optional national ID) matched read-only against the
   lender's ServiceSuite DB; graduation = 5+ cleared loans, 0 active.
3. **Customer-360** (`/api/lms/customer-info`) — known borrowers see their own profile (photo, risk
   score, loan limit, agent, branch, office trail, loan stats) before consenting. The trust step.
4. **Consent** (DPA-granular) — M-Pesa analysis + automated scoring mandatory; CRB, model
   improvement, cross-border, geo-tagging optional. Versioned, IP-stamped.
5. **M-Pesa statement** — 6-month PDF + password → parser → `CashflowFeatures` → thin-file score
   (server-side recompute; client never trusted).
6. **Scoring fusion** (`src/lib/scoring/fusion.ts`) — thin-file PD + origination PD blended
   (60/40 with history, 40/60 without). Engines: **v2 bespoke Micromart** (`ORIGINATION_SCORER_URL`,
   AUC 0.822), **v3.1.1 pooled** (`ORIGINATION_POOLED_URL`, AUC 0.823), **v1 behavioral** monitor.
7. **Application record** — `LmsApplication` in BirgenAI Postgres = the training row (features X now,
   outcome y backfilled by daily cron `/api/lms/outcome-backfill`). Consented geo pin → `GeoPin`
   (RO Route Planner).
8. **Posting** — graduated + verified borrowers post into ServiceSuite via `sp_InsertLoan` into the
   "BirgenAI Hub" ApprovalWorkflow (Micromart live: workflow 1021, product 30218, channel 7,
   service account 9096); loan lands at **Officer Review** with `isApproved=0`. Non-graduated stay in
   BirgenAI pipeline for officer review. Human-in-the-loop on all adverse decisions (no auto-decline).

**Keep all of this.** It is the origination funnel of the new platform — ported, not rebuilt.

### 2.2 ServiceSuite-Portal (the reference LMS)

ASP.NET MVC + SQL Server `Serviceconnect`, multi-tenant by EntityID:

- **Tenancy:** 239 tables, ~80 carry `EntityId`. `BsEntity` = the org (name, contacts, currency,
  branding colors/logos/theme, Google Drive folder, paybill, `SmsProviderId`, `SmsRate`,
  `MonthlyFee`, `SubscriptionBalance`, account type/status). `NewEntity` stored proc creates org +
  admin user in one shot. Live tenants include NJB (30.6k loans), Buy Simu (12.5k), ATICO (6.5k)…
  **EntityID 7 = "SERVICE SUITE TEST AREA"** (our safe integration-test tenant).
- **Org structure:** `OrganizationLevels` → `OrganizationUnits` (branches; with
  `DisbursementLimit`, geo lat/lng/radius), users assigned to level+unit.
- **Users/roles/rights:** `UserMaster` (EntityID-scoped; `Initiator/Authorizor/Validator` flags,
  AccessLevel), `Roles` (per-entity; Rights + Menu + Reports), `RightsModules` (module registry).
- **Products:** 71 columns of config — interest method/type/period, rollover engine (penalty, grace,
  occurrence, limits), early-settlement rates, guarantor + security requirements, min credit score,
  new-vs-repeat workflow routing (`WorkflowId` / `repeatWorkflowId`), disbursement mode,
  attachments, custom fields.
- **Workflow engine:** `ApprovalWorkflow` → `ApprovalWorkflowStage` tree (ParentStage, AccessID
  1/2/3, RoleID, CanFinalize, FormItems, finalize amount caps). Approvals are **OTP-gated**
  (`sp_NewLoanManagementApproval`). Loans track `ApprovalStage`; finalize stage → disbursement.
- **Money:** per-entity Daraja credentials in `StkParams` (encrypted consumer key/secret, passkey,
  shortcode, callback) → STK Push collections; `INCOMINGC2B` paybill callbacks; repayment
  allocation via `loanSchedule` (principal/interest split, PDD class). Disbursement = approval +
  float management (`Float`, branch disbursement limits) — **no B2C API in code; money leaves via
  the lender's own M-Pesa org portal / manual float**. That's a gap we will close.
- **SMS:** DB-queued `SMS` table (status, cost, provider id, response codes) + templates,
  placeholders, campaigns, per-entity billing (`SmsBilling`, `sp_AddSmsPayment`) — gateway is an
  external worker per `SmsProviderId`. **No SMTP anywhere — email is effectively absent.**
- **Extras worth matching:** collections module (PTPs, call logs, collection agents, PBX
  click-to-call), expenses, journals, reports, tickets (ConnectBox API), device financing +
  **Trustonic device-lock** (Buy Simu), audit logs, borrower interactions, AI (Claude/Gemini)
  assistants, Google-Drive-backed documents/photos.
- **Hook to us:** `BirgenAiScoringService` already calls the Hub (`/api/enterprise/borrower-score`)
  for repeat borrowers, shared-secret auth.

### 2.3 The Master Plan (PDF) — constraints we honor

- BirgenAI **never lends**; lender-of-record is always the licensed lender (CBK positioning).
- DPA: granular consent, human-in-the-loop on adverse outcomes, DPIA, ODPC registration,
  cross-border minimization (features/aggregates out, never raw PII), SHAP reason codes.
- Tenant isolation is a **hard security boundary** (cross-tenant leak = company-ending).
- Product ladder: graduated repeat customers → school fees → personal → new-SME (RO-as-API).
- Riri 2.0 (static lender KB, RAG) vs Riri 2.5 (live tenant-scoped analytics with semantic metric
  layer + guarded text-to-SQL on a read path) — keep the line crisp.

---

## 3. Core architecture decisions (recommendations)

### D1 — Database: **PostgreSQL (our own), not a SQL Server replica** ✅ recommended

Build the new LMS on **Postgres + Prisma** (same stack as the Hub — one operational surface):

- **Clean IP.** Re-implementing the Serviceconnect schema 1:1 replicates Techcrast's design. A
  clean-room Postgres schema designed for our features is legally safer and technically better
  (the 239-table sprawl includes MD5 passwords, stored-proc coupling, and years of legacy).
- **Fits the AI stack.** pgvector for Riri KBs, JSONB for feature snapshots, RLS for tenancy.
- **We already run it.** Supabase Postgres + Prisma powers the Hub today (LmsApplication, GeoPin,
  BorrowerScoreSnapshot already live there).
- **Dedicated database** (new Supabase project or managed Postgres), NOT the Hub's DB — the loan
  book deserves its own blast radius, backup policy, and read replica for analytics/Riri.
- SQL Server (`localhost\SQLBIRGEN`, shared DB EntityID 7) = **reference + integration testing
  against ServiceSuite only**, never the system of record for the new platform.

### D2 — ServiceSuite becomes an *adapter*, not the core

Two modes per organization:

| Mode | Who | How |
|---|---|---|
| **Native** | New orgs onboarding on LMS 2.0 (incl. BirgenAI Hub demo org) | Full loan book lives in our Postgres. |
| **Bridged** | Micromart, Axe, Buy Simu, NJB, ATICO (books live in ServiceSuite) | Today's read-only queries + `sp_InsertLoan` posting + outcome backfill, packaged as a `ServiceSuiteAdapter` behind the same interface the native book implements. Migration to native is a later, per-lender decision. |

This keeps Micromart's live pilot (workflow 1021) untouched while the new platform grows around it.

### D3 — Tenancy: `orgId` on every row + Postgres RLS + per-org encrypted config

- Every tenant-scoped table carries `orgId` (uuid); **RLS policies enforce it at the DB layer**
  (defense-in-depth beyond the app's scoping — the ServiceSuite lesson, hardened).
- "Input the different environment variables when creating the entity" becomes a first-class
  **Org Integrations vault**: an `OrgIntegration` table storing per-org encrypted JSON configs
  (AES-256-GCM, master key in env) for: M-Pesa Daraja (STK consumer key/secret/passkey/shortcode,
  B2C initiator + security credential), SMS provider + sender ID, SMTP/from-address, CRB bureau
  creds, KYC provider keys, webhooks. Admin UI shows a per-integration "Connected / Test / Live"
  status; the platform never needs a redeploy to onboard a lender.
- Staff auth is org-scoped (email+password+OTP, per-org roles). Borrower identity can federate
  with birgenai.com suite SSO **but the LMS always completes its own KYC profile** — fixing
  today's gap where a Hub session is "authenticated" yet has no KYC data.

### D4 — Stack

- **Next.js 15 (App Router, TypeScript), Tailwind** — mobile-first Android borrower UI (Tala-grade),
  desktop-dense staff console. White-background + glass design language ported from the current
  portal. Contextual lucide icons (no Sparkles — house rule).
- **Prisma + Postgres (+ pgvector)**; read replica for analytics/Riri 2.5.
- **NextAuth** (staff credentials + OTP; borrower phone-OTP first-class; optional suite SSO federation).
- **Jobs:** Vercel cron (or a worker container) for outcome backfill, schedule generation, penalty
  runs, SMS queue, disbursement queue, portfolio batch scoring.
- **Python microservices (existing + new, Cloud Run):** scorer v1/v2/v3 (live), statement cruncher
  (port from Hub), + new: face-match/liveness, background removal, document parser.

---

## 4. Users & roles (the aligned list)

**Borrower side (per lender org):**
1. **New applicant** — no record anywhere → full elite KYC onboarding (§5) + thin-file scoring.
2. **Returning borrower** — record with the lender → Customer-360 confirm + fused scoring.
3. **Graduated borrower** (5+ cleared, 0 active) — self-service fast lane, direct posting to book.
4. **Guarantor** — invited by phone, consents, e-signs (product-dependent).

**Staff side (per org, role-configurable; defaults):**
5. **Relationship Officer (RO / field agent)** — mobile-first: borrower field verification (geo-pinned
   visits), photo/KYC capture assist, route planner, collections visits, PTPs.
6. **Loan Officer** — application review queue (AI pre-screen summary + SHAP reasons), verify docs,
   recommend (workflow AccessID 1 / Initiator).
7. **Team Leader / Branch Manager** — second-tier approval (AccessID 2 / Authorizer), branch
   dashboards, disbursement limits per branch.
8. **Credit / Risk Manager** — final approval (AccessID 3 / Validator), portfolio early warning,
   batch scoring, policy (limits ladder, product risk cutoffs).
9. **Finance / Disbursement officer** — maker-checker B2C disbursement queue, float top-ups,
   reconciliation (C2B vs book).
10. **Collections agent** — arrears queues, call logs, PTPs, restructure requests.
11. **Org Admin** — users/roles/branches/products/workflows/integrations/branding, SMS credits,
    subscription billing.
12. **BirgenAI Platform Admin (us)** — cross-org: org onboarding approvals, plans (Starter/Growth/
    Enterprise), usage metering, model registry, platform health. Architecturally the ONLY role that
    crosses tenants.

Every approval action is OTP-gated + audit-logged (ServiceSuite parity), with full maker-checker.

---

## 5. Borrower journeys

### 5.1 New-customer elite KYC onboarding (the 10× funnel)

Mobile-first wizard, one screen per step, resumable, Kiswahili/English:

1. **Phone + OTP** (SMS) → account stub; device fingerprint captured (fraud signal).
2. **Granular consent** (DPA): M-Pesa analysis*, automated scoring*, CRB, IPRS identity check,
   model improvement, cross-border, geo-tagging (* = required). Versioned + IP + timestamp.
3. **National ID capture** (front/back) — live camera with on-device quality gates (blur, glare,
   edges, resolution); retake loop until pass.
4. **Document Parser** — OCR the ID: ID number, names, DOB, serial; cross-check user-typed values.
5. **Selfie + liveness** — active challenge (blink/turn) + passive liveness model server-side.
6. **Face match** — ID portrait vs selfie embedding similarity; auto-pass ≥ high threshold,
   human-review band in the middle, fail → retake/RO referral. Score stored.
7. **Portrait standardization** — background removal → **universal white background**; becomes the
   canonical borrower photo (the "one clean passport photo" every lender sees).
8. **IPRS verification** — via a licensed KYC provider (Smile ID or equivalent; direct IPRS access
   requires government onboarding — provider first, IPRS direct later). Name/DOB/ID cross-check.
9. **Live location capture** — business or home (borrower chooses), GPS + accuracy + reverse
   geocoded address → GeoPin (feeds RO Route Planner + branch geo-fence in `OrganizationUnits`).
10. **CRB check** (if consented; via the lender's bureau subscription through the CRB Orchestrator;
    cached; consent trail).
11. **M-Pesa 6-month statement** upload + password → Cruncher → cashflow features (income
    stability, expenses, existing-loan repayments, gambling flags, affordability).
12. **Score + decision** — engine routing per §6; approve → product/amount/terms with **full
    schedule + pay-early-pay-less display (Tala pattern)**; refer/decline → human review + SHAP
    plain-language reasons + appeal path. Starting limits tiny, graduate on behavior.
13. **Offer acceptance** — e-sign (OTP), then loan enters the org's approval workflow.
14. **SME products only:** an RO field-verification task is auto-scheduled (geolocated, mobile
    check-in) before final approval — "the RO becomes an API".

### 5.2 Returning / graduated borrower

Phone → recognized → Customer-360 ("confirm it's you") → light re-consent → statement refresh
only if stale (> 90 days) → fused score → graduated borrowers skip officer stages the org has
marked skippable → offer → workflow → disbursement. Repeat Tala-style home: current loan card,
amount due today, pay-early slider, limit-growth tracker ("double your limit"), referral card.

### 5.3 In-life (borrower app home)

Active-loan dashboard (balance, next due, schedule), **Pay now** (STK push), statements/receipts,
limit progress + graduation %, support (Riri 2.0 lender KB chat + tickets), profile/consents.

---

## 6. Scoring engine routing (the aligned rules)

| Applicant | Engine | Notes |
|---|---|---|
| Brand-new (no borrower record) | **Thin-file cruncher only** (score /900) | Affordability-first; tiny starting limit ladder |
| Known borrower, Micromart (bridged) | **Fused: thin-file + v2 bespoke** (`ORIGINATION_SCORER_URL`) | 60% origination weight with history, else 40% |
| Known borrower, any other org | **Fused: thin-file + v3 pooled** (`ORIGINATION_POOLED_URL`) | Pooled 29-feature engine, per-lender calibration |
| Native-book borrowers (LMS 2.0 book) | **Fused with v3 pooled**, features computed from our Postgres book | Same feature contract; retrain on native data as it accrues |
| In-life monitoring (all) | **v1 behavioral monitor** | Powers Portfolio Early Warning batch + risk-trend dashboard |

Rules that never change: server-side recompute only; every score persisted with model version,
input hash, reason codes; adverse outcomes always human-reviewed; consent gates the pipeline.

---

## 7. Money movement

- **Disbursement (new — closes the ServiceSuite gap):** Daraja **B2C** per org (initiator +
  security credential in the org vault). Finalized loan → disbursement queue → maker-checker →
  B2C payout to borrower M-Pesa → callback updates loan (`DISBURSED`, transaction ref) → SMS
  receipt. Org **float ledger** with branch disbursement limits (ServiceSuite `Float` +
  `DisbursementLimit` pattern), low-float alerts. Fallback mode: "manual disburse + confirm ref"
  for orgs without B2C credentials yet. School-fees products disburse **to the school's paybill**,
  not the borrower (diversion control).
- **Collections:** per-org **STK Push** (port of the ServiceSuite `StkParams` flow + the Hub's
  existing Daraja code) + **C2B paybill callbacks** (register URLs per org) → auto-allocation to
  schedule (penalties → interest → principal order configurable per product) → receipt SMS.
  Manual receipting for cash/bank with approval.
- **Reconciliation:** daily job matches C2B/B2C logs vs book; exceptions queue for Finance.
- **Platform billing (us):** per-org subscription (plans) + usage metering (per-score, per-statement,
  per-document, per-CRB-check, per-verification, Riri seats) + SMS credits wallet — the Intelligence
  Suite pricing from the Master Plan, implemented as a `UsageEvent` ledger from day one.

## 8. Communications

- **SMS (primary, Kenya-first):** provider-agnostic adapter (Africa's Talking / Celcomafrica /
  lender's existing provider) chosen per org; DB-queued with status/cost/provider-ref (ServiceSuite
  parity); templates + placeholders + campaigns + per-org SMS billing. Transactional set: OTP,
  application received, approved (Tala-style "Congratulations, approved for KSh X"), disbursed,
  payment received, due reminders (T-3/T-1/T0), arrears ladder, PTPs.
- **Email:** platform SMTP (Zoho, already configured in the Hub) for staff/org onboarding,
  approvals, statements, reports; per-org from-address as an Enterprise option. (ServiceSuite has
  none — easy win.)
- **Push/WhatsApp:** phase 3+ (FCM token field already exists in ServiceSuite borrowers; WhatsApp
  via BSP later).

---

## 9. Lending Intelligence Suite — in the LMS menus (not a separate site)

| Menu | Module | Powered by |
|---|---|---|
| Underwrite | **Credit Scorer** (real-time, SHAP reasons on every application) | v2/v3/v1 engines |
| Underwrite | **M-Pesa Statement Cruncher** (per-application + standalone tool) | cruncher service |
| Underwrite | **Document Parser** (IDs, fee structures, invoices, permits, bank statements) | new parser service |
| Underwrite | **CRB Orchestrator** (TransUnion/Metropol/Creditinfo via lender creds; consent + cache) | new orchestrator |
| Underwrite | **ID Verifier** (IPRS + liveness + face match + white-background portrait) | new KYC service |
| Monitor | **Portfolio Early Warning** (batch scoring, risk-trend dashboard, drift) | v1 monitor + queue |
| Analytics | **Riri "Talk to your DB"** (semantic metric layer first: OLB, PAR30, disbursed-today, due-today; guarded read-replica text-to-SQL for novel questions; SQL always shown) | Claude + catalog |
| Field | **RO Route Planner** (geo pins → optimized visit routes, check-ins) | GeoPin + maps |
| Collections | **AI collections** (arrears queues, PTP prediction, best-time-to-contact) | phase 3 |

Plan gating: **Starter** (Scorer + Cruncher + Parser, usage-based) · **Growth** (+ CRB, ID Verifier,
Riri seats) · **Enterprise** (+ Early Warning, custom model tuning, priority support).

---

## 10. Core data model (Postgres, first cut)

Platform: `Org`, `OrgIntegration` (encrypted), `OrgSubscription`, `UsageEvent`, `PlatformAdmin`.
Org structure: `Branch` (levels/units tree, geo, disbursement limit), `StaffUser`, `Role`
(rights JSON + menu), `AuditLog`.
Lending: `Borrower` (KYC profile: ID data, portraits, face-match score, IPRS status, geo,
risk fields, limits, graduation), `KycCheck` (each verification event), `Consent` (versioned),
`Product` (full ServiceSuite-grade config), `Workflow` + `WorkflowStage`, `LoanApplication`
(features snapshot, scores, reasons — the training row), `Loan`, `Schedule` + `Installment`,
`Guarantor`, `Collateral`, `Document`.
Money: `PaymentIntent` (STK), `C2BReceipt`, `Disbursement` (B2C, maker-checker), `FloatLedger`,
`ReconciliationException`.
Comms: `SmsMessage`, `SmsTemplate`, `SmsCampaign`, `EmailMessage`.
Intelligence: `ScoreSnapshot`, `OutcomeLabel`, `PortfolioRun`, `MetricDefinition` (semantic layer),
`RiriQueryLog`, `GeoPin`, `FieldVisit`, `PTP`, `CallLog`, `Ticket`.

Storage: borrower documents/photos in **Supabase Storage or R2** (private buckets, signed URLs) —
not Google Drive.

---

## 11. Phased build plan

**Phase 0 — Scaffold (week 1):** new repo `lms/` (Next.js 15 + Prisma + Postgres + NextAuth),
dedicated DB, RLS harness, design tokens (white/glass, per-org brand vars), CI. Seed orgs:
BirgenAI Hub (native demo), Micromart/Axe/BuySimu (bridged).

**Phase 1 — Port the funnel (weeks 1–3):** move today's borrower portal (branding, eligibility,
Customer-360, consent, cruncher, fusion scoring, apply, geo pin, ServiceSuite posting adapter,
outcome backfill) into the new app behind the adapter interface. `lms.birgenai.com` +
white-label subdomains point at the new app; birgenai.com "Loans" redirects here.
**Exit test:** Micromart E2E application posts to workflow 1021 exactly as today.

**Phase 2 — Native LMS core (weeks 3–8):** org self-onboarding wizard + integrations vault;
branches/users/roles/rights; product builder; workflow engine (stage tree, OTP approvals,
maker-checker); loan book + schedules; STK/C2B collections; B2C disbursement + float; SMS adapter
+ templates; email; dashboards (officer queues, branch, org). **Exit test:** a brand-new test org
disburses and collects a loan end-to-end with EntityID-7-style isolation, on our Postgres.

**Phase 3 — Elite KYC + field (weeks 8–12):** ID capture + quality gates + OCR; liveness + face
match; white-background portrait pipeline; IPRS via KYC provider; CRB Orchestrator v1; RO mobile
flows (field verification, check-ins) + Route Planner; guarantors/collateral; school-fees
disburse-to-school.

**Phase 4 — Intelligence Suite + billing (weeks 12–16):** suite menus (all tools), portfolio early
warning batch, Riri semantic metric layer (OLB/PAR/disbursed/due first, guarded text-to-SQL after),
usage metering + plans + SMS wallet; platform admin console.

**Phase 5 — Scale & migrate (month 5+):** onboard external lenders; per-lender model calibration;
optional Micromart/Axe/BuySimu native migration (two-way sync window → cutover); WhatsApp/push;
Trustonic device-lock module for device financing; direct IPRS when approved.

---

## 12. Compliance guardrails (build-time, not bolt-on)

ODPC registration + DPIA before external pilot · granular versioned consent everywhere · human
review on every adverse decision · cross-border minimization (features only to foreign APIs; face
images processed in-region where possible) · retention windows per data class · full audit trail
(who/what/when + OTP) on money and approvals · per-org data export + deletion workflows · read
replica for all analytics/Riri (never the transactional primary) · secrets encrypted at rest with
key rotation.

---

## 13. Decisions — CONFIRMED (founder, 8 July 2026)

1. **DB:** ✅ Postgres-native + ServiceSuite adapter (§D1/D2). Dedicated Postgres; SQL Server is
   reference/integration-test only.
2. **Project name/repo:** ✅ **BirgenAI_LMS** — https://github.com/emmanuel-arch/BirgenAI_LMS,
   living at `BIRGEN AI 2.0/lms/`.
3. **KYC provider:** ✅ Smile ID for IPRS-backed identity, liveness + face match (in-house
   quality-gate + portrait pipeline still ours; direct IPRS later if approved).
4. **Default SMS provider:** ✅ Africa's Talking for native orgs; per-org override in the vault.
5. **B2C scope:** ✅ RESOLVED — bridged orgs need NO B2C credentials from the lender.
   Rationale: for a bridged org (Micromart/Axe/BuySimu) the loan enters the lender's live
   ServiceSuite workflow, and disbursement stays the lender's existing process. (Note:
   ServiceSuite has no Daraja B2C integration in code — approval finalizes the loan and staff
   disburse via float / the lender's own M-Pesa Org Portal, then the system records
   `LoanDisbursmentDate`.) Our vault's B2C slot exists ONLY for **native-book orgs**, where
   BirgenAI_LMS itself must move the money (maker-checker queue → Daraja B2C → callback →
   auto-reconciliation). A bridged lender would only ever hand us B2C credentials if they
   (a) migrate native, or (b) explicitly want the LMS to take over their disbursement ops as an
   upgrade (automated payout + callback + reconciliation instead of manual portal work) — both
   are opt-in, later, per-lender conversations, not launch requirements.
6. **Buy Simu device-locking (Trustonic):** ✅ PARKED — out of scope for now (revisit post-launch
   if device financing needs it).

---

*Sources analyzed for this blueprint: `birgen-ai-frontend/src/{app/lms, app/api/lms, lib/lms,
lib/scoring, lib/statement, lib/enterprise}`, `servicesuite/birgenai_workflow.sql`,
`ServiceSuite-Portal/ServiceSuite/{Controllers, Models, Service, appsettings.json}`, live
read-only schema probe of the shared Serviceconnect DB (213.148.17.198), and
`BirgenAI-Fintech-Master-Plan-v1.pdf`.*
