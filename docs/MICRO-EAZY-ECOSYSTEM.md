# MICRO EAZY — The Ecosystem Blueprint

**Status:** Proposed for founder approval · 5 August 2026
**Author:** Emmanuel Birgen, BirgenAI · engineering blueprint
**Anchor lender:** Micromart Africa Limited (BRIDGED org, live)
**Board presentation:** week of 10 August 2026
**Companion docs:** [`LMS-2.0-BLUEPRINT.md`](./LMS-2.0-BLUEPRINT.md) (the platform), [`SUPER-LMS-ARCHITECTURE.md`](./SUPER-LMS-ARCHITECTURE.md), `reports/Micro-Eazy-Ecosystem-Blueprint.docx` (board version)

---

## 0. The one-paragraph version

**Micro Eazy is a two-sided credit ecosystem.** On one side, licensed lenders run their whole
business on the Super LMS — origination, scoring, workflow, disbursement, collections, field ops,
accounting, HR, call centre — under one sign-on. On the other side, Kenyans install one app,
**Micro Eazy**, from the BirgenAI Hub app store, verify themselves once, and are routed by the
**Micro Eazy Exchange** to a licensed lender who funds them. BirgenAI never lends. BirgenAI owns
the customer relationship, the identity, the intelligence and the rails — and rents none of it.
**Micromart is lender #1 and, at launch, the sole lender**: every Micro Eazy customer in Kenya
becomes a Micromart loan, posted straight into Micromart's own live workflow.

---

## 1. Why this works, and why now

Micromart's own product screen tells the story. Their **Micro Eazy Monthly** product is live and
correctly configured — 22% flat per month, 2 months, 6% processing fee, min score 500 — and it has
**2 loans and KES 144,000 outstanding.**

They built the product. They do not have the pipeline.

That is the entire commercial proposition in one sentence, and it is why the name is theirs:

> *"You have built Micro Eazy. We have built the machine that fills it. Same name, same product,
> same workflow you already approved — and from next week, a stream of verified, scored, geo-pinned,
> CRB-checked customers arriving in it every day."*

Getting a licensed lender to pilot a credit platform is the hardest door in Kenyan fintech. It is
open. The blueprint below is about walking through it without breaking anything they already run.

---

## 2. Where we actually are (verified against code and the live database, 5 Aug 2026)

Not a summary of intentions — a probe of the running system.

### 2.1 The lender realm — Super LMS (`BIRGEN AI 2.0/lms`)

Next.js 16.2.10 · React 19.2.4 · Prisma 7.8 + Postgres with **row-level security enforced in the
database** (`app.org_id` GUC set transaction-locally on every statement — tenant isolation is a
database guarantee, not a code-review promise).

| Capability | State | Where |
|---|---|---|
| 62-model multi-tenant schema | **BUILT** | `prisma/schema.prisma` |
| Console: 13 nav groups, ~45 screens | **BUILT** | `src/lib/nav/registry.ts` |
| Decision engine — 7 stages, reason codes on every one, pure & reproducible | **BUILT** | `src/lib/decision/engine.ts` |
| Credit policy per lender (declarative, versioned) | **BUILT** | `src/lib/decision/policy.ts` |
| Product builder + versioning + published eligibility blocks | **BUILT** | `src/lib/products/` |
| Workflow engine (stage tree, access tiers, OTP, finalize caps, `crbRequired`) | **BUILT** | `Workflow` / `WorkflowStage` |
| M-Pesa statement cruncher + Internal Report | **BUILT** | `src/lib/statement/` |
| Scoring: v2 bespoke (AUC 0.822) · v3.1.1 pooled (0.823) · v1 behavioural monitor | **LIVE** | Cloud Run, `src/lib/scoring/` |
| Metropol CRB (v2_1, SHA-256 signing, E409 dedupe) | **BUILT · test creds** | `src/lib/crb/metropol.ts` |
| ServiceSuite bridge — `sp_InsertLoan` posting | **LIVE** (`LMS_POSTING_ENABLED=true`) | `src/lib/lms/servicesuite.ts` |
| Collections, PTPs, call logs, tickets | **BUILT** | `src/lib/collections/` |
| Field ops: geo pins, route planner, needs-location worklist, disbursement geo-gate | **BUILT** | `src/lib/field/`, `src/app/console/field/` |
| Riri assistant (role/book/customer aware, per-staff memory) | **BUILT** | `src/lib/riri/` |
| Connected Suite SSO — Lending · Portal · PeopleHub HR · Ledgerly Accounting · ConnectDesk Call-Centre | **BUILT** | `src/lib/suite/apps.ts` |
| ServiceSuite OS dock (phone shell, lock screen, app drawer) | **BUILT** | `src/components/os/` |
| Billing, usage metering, invoices, entitlements | **BUILT** | `src/lib/billing/` |

### 2.2 Micromart, as the platform sees it today

```
micromart    BRIDGED   ACTIVE   PREMIUM   Micromart Africa
  borrowers 162 · loans 199 · applications 50 · offers 15 · staff 17 · branches 9
  products  5 (1 active: "MIROMART FINTECH" 5k–20k @82.5% flat / 10 weeks)   ← note the typo
  workflows 2 (3-stage, 2-stage)
  integrations  MPESA_STK = CONFIGURED · CRB = CONFIGURED
  bridge        env-driven (SERVICESUITE_CONN_MICROMART · channel 7 · service account 44356)
```

**Micro Eazy and Micro Eazy Monthly do not yet exist in our system.** That is the first build task,
and it is a configuration task, not an engineering one — which is the whole point of the product
builder.

### 2.3 The customer realm — what exists, and what the customer cannot yet do

The borrower surfaces are real and working; they are just not yet **an app**.

| Surface | State |
|---|---|
| Branded portal wizard (phone → consent → crunch → score → offer) | **BUILT** — `src/app/page.tsx`, 1,002 lines |
| OTP door + PIN door + session | **BUILT** — `src/lib/portal/` |
| Crunch theatre (the statement analysis, watchable) | **BUILT** — `CrunchTheatre` |
| Offer card + acceptance + e-sign | **BUILT** — `OfferCard`, `/api/portal/offer/[id]` |
| My loan · balance · Pay now (STK to registered phone) | **BUILT** — `/myloan` |
| Auto-repay (M-Pesa Ratiba) | **BUILT** — `AutoRepayCard` |
| Internal Report, sold to the customer | **BUILT** — `InternalReportCard` |
| Guarantor invite + consent | **BUILT** — `/guarantee/[id]` |
| **Installable app (PWA manifest, icons, service worker)** | **MISSING** |
| **Push notifications** | **MISSING** |
| **Offline shell / background sync** | **MISSING** |
| **"Why was I declined" and "how do I fix it"** | **MISSING** (engine emits the reasons; nothing shows them to the customer) |
| **Limit ladder / graduation progress** | **MISSING** (`GraduationEvent` exists server-side) |
| **Rewards, tiers, early-settlement rebate** | **MISSING** |
| **Notification inbox** | **MISSING** |
| **Multi-lender routing** | **MISSING** — this is the new invention |

### 2.4 The Hub — how Micro Eazy appears

`BIRGEN AI 1.0.0/birgen-ai-frontend`. The app store reads one table:

```
model App { slug · name · tagline · description · developer · category · icon
            appUrl · isNative · launchMode · backgroundColor · isFeatured · sortOrder }
```

`AppCategory.LENDING` renders as the **"Loans & Credit"** shelf. Icons resolve from
`public/apps/icons/<slug>.png`. `launchMode: EMBEDDED` opens the app inside the Hub's `/app/[slug]`
iframe shell, which keeps the Home button.

So the answer to *"how does Micro Eazy appear on the Hub when I drop in the logo?"* is exact:

1. `public/apps/icons/micro-eazy.png` — the logo, 512×512, transparent.
2. One row in `prisma/seeds/apps.ts` with `category: LENDING`, `sortOrder: 0`, `isFeatured: true`,
   `appUrl: 'https://microeazy.birgenai.com'`.
3. Re-run the seed. Micro Eazy is now the first tile on the Loans & Credit shelf.

**The Hub has no PWA manifest either.** Both sides get one.

---

## 3. The three decisions, locked

| # | Decision | Rationale |
|---|---|---|
| **D1** | **ONE customer PWA at `microeazy.birgenai.com`.** After routing, its chrome repaints to the assigned lender. Lender subdomains survive as branded doors that deep-link into the same installed app. | One manifest, one icon on the home screen, one push channel, one install base — **owned by BirgenAI**. Lender #2 costs zero customer re-installs. Per-lender PWAs fragment the install base and hand it to the lender. |
| **D2** | **Co-branded: "Micro Eazy · Funded and serviced by Micromart Africa Ltd · Powered by BirgenAI."** Lender-of-record named on every money screen, offer, agreement and SMS. | It is the honest CBK/DPA position (BirgenAI never lends), it flatters Micromart on the screens that matter legally, and it keeps the consumer brand portable to lender #2. |
| **D3** | **Micro Eazy mirrors Micromart's product terms exactly** — same names, same rates, same fee, same workflow names. | The board must recognise their own product. Zero configuration argument in the room. Divergence is a later, negotiated conversation. |

---

## 4. The architecture: two realms, one spine

```
                        ┌──────────────────────────────────────────────┐
                        │           BIRGENAI HUB (birgenai.com)        │
                        │   App store ▸ Loans & Credit ▸ [Micro Eazy]  │
                        └───────────────────┬──────────────────────────┘
                                            │ install / launch (SSO)
                                            ▼
   ╔══════════════════════════╗   ╔══════════════════════╗   ╔══════════════════════════════╗
   ║   REALM B — CUSTOMER     ║   ║      THE SPINE       ║   ║   REALM A — LENDER           ║
   ║  microeazy.birgenai.com  ║   ║  MICRO EAZY EXCHANGE ║   ║  lms.birgenai.com/console    ║
   ║  installable PWA         ║   ║                      ║   ║  Super LMS                   ║
   ║                          ║   ║  · Listings          ║   ║                              ║
   ║  · one identity          ║◄─►║  · Allocation policy ║◄─►║  · products & workflows      ║
   ║  · one KYC, reusable     ║   ║  · Appetite ledger   ║   ║  · officer queues            ║
   ║  · apply / offer / sign  ║   ║  · RoFR + SLA        ║   ║  · disbursement / float      ║
   ║  · pay / auto-repay      ║   ║  · Routing record    ║   ║  · collections / field       ║
   ║  · limit ladder          ║   ║    (reason codes)    ║   ║  · Riri · analytics          ║
   ║  · why-declined + fix    ║   ║                      ║   ║  · HR · Accounting · Calls   ║
   ║  · Internal Report       ║   ║  ── TRUST CONTRACT ──║   ║                              ║
   ║  · rewards / tier        ║   ║  obligations BOTH    ║   ║  ServiceSuite BRIDGE ────────╫──► Micromart
   ╚══════════════════════════╝   ║  ways, in code       ║   ║  sp_InsertLoan → wf 1021     ║    live book
                                  ╚══════════════════════╝   ╚══════════════════════════════╝
                     ┌────────────────────────────────────────────────────┐
                     │  SHARED INTELLIGENCE  (API-first, separable)       │
                     │  Statement Cruncher · Internal Score · CRB         │
                     │  Decision Engine · Behavioural Monitor · Riri      │
                     └────────────────────────────────────────────────────┘
```

**Realm A is ~80% built. The spine and Realm B's shell are the new work.**

---

## 5. The Micro Eazy Exchange — the actual invention

Everything else in this document is assembly. This is the new product.

Today the decision engine's `route` stage answers *"who inside this lender may approve?"*. It does
not answer *"which lender gets this customer?"* — because until now there was only ever one.

### 5.1 Design principle: a pre-pass, not a rewrite

`engine.ts` is pure, serialisable, reproducible and covered by parity tests. **It does not change.**
The Exchange runs *before* it and picks the lender; the existing per-org engine then runs unchanged
inside that lender's policy.

```
  applicant
     │
     ▼
  ┌───────────────────────────────────────────────┐
  │  EXCHANGE PRE-PASS   src/lib/exchange/         │
  │  1. eligible listings for this applicant       │
  │  2. appetite / quota check per lender          │
  │  3. allocation policy applied                  │
  │  4. RoFR + SLA clock started                   │
  │  → { orgId, listingId, reasons[] }             │
  └───────────────────┬───────────────────────────┘
                      ▼
  candidatesFor(orgId) → engine.decide(...)   ← UNCHANGED
                      ▼
  offer · workflow · disbursement (that lender's rails)
```

### 5.2 New data model

```prisma
model MarketplaceListing {          // a lender publishes a product to the Micro Eazy shelf
  id            String   @id @default(uuid())
  orgId         String
  productId     String
  displayName   String              // "Micro Eazy Monthly"
  status        ListingStatus       // DRAFT · LIVE · PAUSED · WITHDRAWN
  priority      Int      @default(0)
  geoScope      Json                // counties / wards; empty = national
  scoreBandMin  Int?
  exclusivity   Boolean  @default(false)   // sole-lender flag (Micromart at launch)
  effectiveFrom DateTime
  effectiveTo   DateTime?
}

model LenderAppetite {              // what a lender will absorb, and by when
  id             String   @id @default(uuid())
  orgId          String
  window         AppetiteWindow     // DAY · WEEK · MONTH
  maxApplications Int?
  maxExposure    Decimal? @db.Decimal(18,2)
  maxTicket      Decimal? @db.Decimal(18,2)
  consumedCount  Int      @default(0)
  consumedValue  Decimal  @default(0) @db.Decimal(18,2)
  resetsAt       DateTime
}

model AllocationPolicy {            // platform-level; ONE active at a time
  id        String   @id @default(uuid())
  mode      AllocationMode          // SOLE · WEIGHTED · CAPACITY_FIRST · BEST_FIT · WATERFALL
  config    Json                    // weights, waterfall order, SLA minutes
  isActive  Boolean  @default(false)
  version   Int
  createdBy String
}

model AllocationDecision {          // the audit record — every routing, forever
  id            String   @id @default(uuid())
  applicantRef  String
  policyId      String
  policyVersion Int
  consideredOrgIds  Json            // [{orgId, listingId, admitted, reasonCode, detail}]
  awardedOrgId  String?
  awardedListingId String?
  reasons       Json                // ReasonCode[] — same shape the engine emits
  slaExpiresAt  DateTime?
  outcome       AllocationOutcome   // AWARDED · DECLINED_BY_LENDER · SLA_LAPSED · REASSIGNED
  createdAt     DateTime @default(now())
}
```

### 5.3 The five allocation modes

| Mode | What it does | When |
|---|---|---|
| **SOLE** | One lender takes everything. | **Launch — Micromart.** |
| **WEIGHTED** | Round-robin by capital-share weights. | Lender #2 and #3 arrive with different balance sheets. |
| **CAPACITY_FIRST** | Route to whoever has remaining appetite today. | Protects lenders from being flooded; protects customers from silent queues. |
| **BEST_FIT** | Price the applicant against every live listing; the customer gets the best affordable offer and sees why. | The endgame — this is what makes Micro Eazy a *market* rather than a funnel. |
| **WATERFALL** | First-look lender has right of first refusal for N minutes, then the customer cascades. | Sells premium first-look as a paid tier. |

`SOLE → micromart` at launch. **The other four exist in code from day one but are switched off** —
which is exactly what lets you tell the Micromart board "you are our only lender" and mean it,
without rebuilding anything when that changes.

### 5.4 Every routing explains itself

The `AllocationDecision` reuses the engine's `ReasonCode` shape (`{ code, label, detail, tone }`),
so the customer-facing "why" and the regulator-facing audit are the same object:

```
LENDER_AWARDED     Micromart Africa    Sole lender for Micro Eazy in this period
LISTING_MATCH      Micro Eazy Monthly  KES 5,000–100,000 fits your assessed limit of KES 25,000
LISTING_EXCLUDED   Micro Eazy (weekly) Your income cycle is monthly; weekly terms were not offered
APPETITE_OK        Micromart           Within today's remaining capacity
```

That last block is also a sales asset: it is the report you show a lender to sell them a bigger quota.

---

## 6. The Trust Contract — what makes it an ecosystem and not a lead funnel

Both sides owe each other something, and both sets of obligations are **enforced in code, not in a
brochure.** This is the section to read aloud to the Micromart board.

### 6.1 What the customer gives

Mandatory to receive money through Micro Eazy — stated plainly, once, before anything is collected:

- verified identity (national ID capture, selfie + liveness, IPRS cross-check)
- consent to **CRB check**, **M-Pesa statement analysis**, **automated scoring** — versioned, IP-stamped
- a **location pin** that can be visited (already a hard disbursement gate: `LOCATION_NOT_CAPTURED`)
- device fingerprint (fraud signal)
- repayment on the agreed schedule

### 6.2 What the ecosystem owes back — seven enforceable promises

| # | Promise | Mechanism |
|---|---|---|
| 1 | **No silent decline.** | Engine reason codes surfaced verbatim to the customer, in English and Kiswahili, with a named path to fix each one. |
| 2 | **A visible ladder.** | "Rung 2 of 7. Clear this on time → KES 15,000. Clear it early → KES 18,000." Driven by `GraduationEvent`. |
| 3 | **Pay early, pay less — priced live.** | Early-settlement rebate as a slider on the loan card, not buried in a call to the office. |
| 4 | **Your data, your report.** | The Internal Report — the same analysis the lender bought — given to the customer free once per cycle. |
| 5 | **Portability.** | Good behaviour travels to the next lender in the ecosystem via `SharingPool` (which already carries a `legalBasis` field). Reward is not locked in one lender's book. |
| 6 | **A human answers appeals**, on a clock the customer can see. | Adverse decisions are never fully automatic; the appeal SLA is displayed and counted down. |
| 7 | **Nothing collected without a stated purpose and a retention window.** | Per-data-class retention; per-org export and deletion workflows (`ComplianceRequest`). |

### 6.3 Rewards — the ladder up

Clean cycle → limit graduation · rate step-down · processing-fee waiver at rung 4 · instant re-borrow
(skips the officer stages the lender marked skippable) · early-settlement rebate · **Micro Eazy Gold**
(priority routing to the best-priced listing) · referral credit.

### 6.4 Consequences — proportionate, disclosed up front, never a surprise

Missed instalment → reminder ladder (T-3 / T-1 / T0) → PTP → agent call → geo-pinned field visit →
limit freeze → limit reduction → rate step-up → CRB listing **at the disclosed threshold, by the
lender-of-record** → ecosystem stop-flag shared through `SharingPool` under its stated legal basis.

Every rung is written into the agreement the customer signs, and every rung is visible in the app
*before* it is reached. A consequence the customer was warned about is collections. A consequence
they were not is a complaint to the ODPC.

### 6.5 Responsible AI — non-negotiable, ecosystem-wide

- Every model output carries **model version + input hash + reason codes**, persisted.
- **Server-side recompute only.** The client is never trusted with a score.
- **No fully-automatic adverse decision** beyond the lender's disclosed floor.
- Every decision is **reproducible**: "why was I declined in March?" is answerable in March's terms
  (policy version + product version + inputs + full stage trace, all stored).
- **Cross-border minimisation**: features and aggregates leave, raw PII does not.
- Bias monitoring on the closed ML loop: the 300-outcome gate, Wilson intervals, priced errors.

---

## 7. Realm B — the Micro Eazy PWA, screen by screen

Same Next.js app, new route group and host. **No new repository.**

### 7.1 What has to be built vs. re-shelled

| Screen | Status | Source |
|---|---|---|
| Splash + install coaching (Android prompt · iOS "Add to Home Screen") | **NEW** | — |
| Phone + OTP door | re-shell | `OtpCard`, `/api/portal/otp` |
| National ID + PIN door | re-shell | `/api/portal/pin` |
| Consent (granular, versioned) | re-shell | portal wizard |
| KYC: ID capture, quality gates, selfie, liveness, face match | **finish** | `src/lib/kyc/`, `KycSession`, `KycCheck` |
| Crunch theatre | re-shell | `CrunchTheatre` |
| Offer + full schedule + e-sign | re-shell | `OfferCard` |
| Home: current loan, due today, pay slider | re-shell | `/myloan` |
| Auto-repay (Ratiba) | re-shell | `AutoRepayCard` |
| Internal Report | re-shell | `InternalReportCard` |
| **Why declined + how to fix** | **NEW** | engine reasons already exist |
| **Limit ladder / graduation** | **NEW** | `GraduationEvent` already exists |
| **Rewards + tier** | **NEW** | — |
| **Notification inbox + push** | **NEW** | Web Push (VAPID) |
| **Offline shell + background sync** | **NEW** | service worker |
| Support: Riri chat + tickets | **port** | Riri exists console-side |

**Ten of sixteen screens already exist as working code.** The PWA is mostly a re-shell plus six new
screens — which is why a two-week path to a demo is realistic rather than delusional.

### 7.2 The install path, end to end

```
Hub app store ▸ Loans & Credit ▸ [Micro Eazy]  ── install ──▶  microeazy.birgenai.com
        │                                                             │
        └── SSO: BirgenAI ID already signed in ───────────────────────┘
                                    │
                          Android: beforeinstallprompt → home-screen icon
                          iOS: Safari share-sheet coaching card
                                    │
                        standalone app, Micro Eazy icon, no browser chrome
```

### 7.3 PWA specification

- `app/manifest.ts` (Next 16 metadata route): `display: "standalone"`, `start_url: "/?src=pwa"`,
  `theme_color`, `background_color`, `orientation: "portrait"`, icons **192 · 512 · 512-maskable**,
  shortcuts (Pay now · My loan · Apply).
- Service worker: app-shell precache, network-first for API, **background sync** for pending
  repayments and consent submissions — Kenyan network reality, not a nicety.
- Web Push (VAPID): approved · disbursed · payment received · due T-3/T-1/T0 · limit increased.
- Mobile-first Android, per the house rule. Every touch target ≥ 44px; the whole flow works
  one-handed on a 360px viewport.

---

## 8. Realm A — the lender console, and what Micro Eazy adds to it

Already built (§2.1). Micro Eazy adds four things:

1. **Marketplace tab** (`/console/marketplace`) — publish a product to the Micro Eazy shelf, set
   appetite (per day / week / month, max exposure, max ticket, counties, score bands), see the
   inbound pipeline, accept or release within the SLA.
2. **Pipeline attribution** — every application tagged with its `AllocationDecision`, so a lender
   sees exactly what BirgenAI sent them and what it converted to. This is the invoice.
3. **Final-step disbursement choice** — at the finalize stage, each lender chooses:
   *(a)* **Bridge** — post into their own ServiceSuite workflow (Micromart, live today), or
   *(b)* **Native B2C** — Daraja B2C out of our maker-checker queue.
   One switch, per lender, at the workflow's finalize stage.
4. **The Connected Suite stays the frame** — Lending · Customer Portal · PeopleHub HR · Ledgerly
   Accounting · ConnectDesk Call-Centre, one sign-on, the app drawer preserved exactly as it is.

---

## 9. Micromart — the exact configuration, mirrored

### 9.1 Micro Eazy Monthly (MEM) — from their live screen

| Field | Value |
|---|---|
| Principal | KES 5,000 – 100,000 |
| Interest method | Flat rate |
| Interest rate | 22.00% per month |
| Repayment | 2 (Month) |
| Rollover penalty | 20.00% |
| New loans | Approval required · workflow **Micro Eazy** |
| Repeat loans | Approval required · workflow **Micro Eazy** |
| Guarantor | Not required · in-active guarantors cannot borrow |
| Security | Not required |
| Min credit score | 500.00 |
| Min loan limit | KES 5,000 |
| Charge | **PROCESSING FEE (PF)** · before disbursement · 6.00% · capped KES 650 – 6,000 · range KES 5,000 – 100,000 · mandatory · active |

Worked example the board will do in their heads — get it right on the first screen:

```
Principal            KES 25,000
Processing fee 6%    KES  1,500   (inside the 650–6,000 cap)   → deducted before disbursement
Net to customer      KES 23,500
Interest 22% flat/mo × 2 months on 25,000   = KES 11,000
Total repayable      KES 36,000
Monthly instalment   KES 18,000 × 2
Rollover penalty     20% if rolled
```

### 9.2 Micro Eazy (the base product) — **OPEN**

Micromart has two Micro Eazy products; only Monthly's screen was supplied. **Needed before the
demo:** principal range, interest rate and unit, repayment count and unit, rollover penalty, min
credit score, min loan limit, charge structure, workflow name.

Until it arrives, Micro Eazy Monthly alone carries the demo, and the base product is seeded from the
same template the moment the spec lands.

### 9.3 What gets configured, not coded

- Two `Product` rows in the Micromart org, exact mirrors, `isActive: true` (activating them is what
  puts them on Micromart's live Micro Eazy shelf — a bridged org's active products *are* its portal shelf).
- One `Charge` row: PF, 6%, min 650, max 6,000, before disbursement, mandatory.
- One `Workflow` titled **"Micro Eazy"**, stages mirroring theirs, mapped to their ServiceSuite
  `ApprovalWorkflow`.
- `CreditPolicy`: `autoDeclineBelow` aligned to their min score 500, `autoApproveAbove` set
  conservatively so **every launch loan is officer-reviewed** — human-in-the-loop, and the board sees
  their officers still in control.
- Two `MarketplaceListing` rows, `exclusivity: true`.
- One `AllocationPolicy`: `SOLE → micromart`.

---

## 10. The demo — what happens in the room

**Do not present slides. Present a loan.**

```
 1  Open birgenai.com on the projector. App store ▸ Loans & Credit.
    Micro Eazy is the first tile, with the logo they are about to see everywhere.

 2  Install it on a real Android phone, on stage. The icon lands on the home screen.

 3  Apply as a real customer: phone → OTP → consent → ID + selfie →
    M-Pesa statement → watch the crunch theatre run → CRB pull → decision.

 4  The offer appears:  "Micro Eazy Monthly · KES 25,000 · 2 months ·
    KES 18,000/month · Funded and serviced by Micromart Africa Ltd."
    Beside it, the reason codes that produced it.

 5  Accept. E-sign by OTP.

 6  Turn the projector to MICROMART'S OWN SERVICESUITE SCREEN.
    The loan is sitting in their Micro Eazy workflow, at Officer Review,
    with isApproved = 0. Their loan. Their workflow. Their officer.

 7  A Micromart officer approves it live, in their own system.

 8  Back to the phone: disbursed. SMS receipt. Balance showing.

 9  Repay by STK push from the phone. Balance drops.
    The limit ladder moves: "Rung 2 → KES 30,000 next."

10  Show the customer's "why" screen and their Internal Report.
    Then show the lender's side: the pipeline, the attribution, the reason trace.
```

Then the one sentence that closes it:

> *"Your Micro Eazy Monthly has two loans on it. Everything you just watched took four minutes and
> did not touch a single line of your system. Give us the shelf, and we fill it."*

---

## 11. Build plan

### Sprint 0 — Demo-critical (this week → board meeting)

| # | Task | Where |
|---|---|---|
| 0.1 | Micro Eazy logo — 3 concepts, SVG + PNG at 192/512/maskable/Hub-tile | `lms/public/brand/micro-eazy/` |
| 0.2 | Seed Micro Eazy + Micro Eazy Monthly into the Micromart org, exact mirror | `scripts/seed-micro-eazy.ts` |
| 0.3 | Mirror the "Micro Eazy" workflow; map to their ServiceSuite `ApprovalWorkflow` | same script |
| 0.4 | Exchange v1: schema + `src/lib/exchange/allocate.ts` + `SOLE → micromart` policy | new |
| 0.5 | PWA: `manifest.ts`, icons, service worker, install prompt, iOS coaching card | `src/app/manifest.ts`, `public/sw.js` |
| 0.6 | `microeazy.birgenai.com` host routing + co-branded chrome (D2) | middleware + `brand-server.ts` |
| 0.7 | Hub tile: icon + `apps.ts` seed row, `LENDING`, featured, sortOrder 0 | Hub repo |
| 0.8 | Customer "why declined / how to fix" screen from existing reason codes | new |
| 0.9 | Limit-ladder screen from `GraduationEvent` | new |
| 0.10 | **End-to-end rehearsal on the real Micromart bridge**, twice, with a reversible test loan | `scripts/rehearse-micro-eazy.ts` |
| 0.11 | Fix `MIROMART FINTECH` → `Micromart Fintech` | data fix |

### Sprint 1 — The Trust Contract, made real (2 weeks post-demo)

Push notifications (VAPID) · notification inbox · offline shell + background sync · rewards and tiers ·
early-settlement rebate slider · appeal flow with a visible SLA clock · Internal Report free once per
cycle · full Kiswahili pass on every new screen.

### Sprint 2 — The Exchange opens (weeks 3–6)

Lender marketplace console · appetite ledger + quota enforcement · WEIGHTED and CAPACITY_FIRST modes ·
right-of-first-refusal with SLA lapse · attribution reporting and lender invoicing · lender
self-onboarding to the shelf.

### Sprint 3 — One workspace (weeks 6–9)

The Connected Suite as the lender's whole back office — HR, Accounting, Call-Centre, Analytics
Studio — under one sign-on, with the app drawer intact. Riri across all five.

### Sprint 4 — Scale (month 3+)

BEST_FIT and WATERFALL modes · per-lender model calibration · lender #2 and #3 · national coverage
via the risk map · direct IPRS · WhatsApp channel.

---

## 12. Risks, and what to do about them

| Risk | Reality | Mitigation |
|---|---|---|
| **Live posting is armed** | `LMS_POSTING_ENABLED=true` against Micromart's production ServiceSuite | Every rehearsal uses a reversible test borrower and a documented rollback. Never rehearse blind. |
| **Real Africa's Talking credentials sit in `.env`** | A test run can send real SMS and spend real money | Blank them in every verify/rehearsal script. Standing rule. |
| **Metropol production keys pending** | Only test credentials today | Demo on test creds; the integration is already proven (`npm run test:crb` green). Chase the production keys this week. |
| **The bridge is env-driven, not vaulted** | No `SERVICESUITE` `OrgIntegration` row for Micromart | Migrate the bridge config into the encrypted vault so it is per-org and console-managed. Sprint 1. |
| **Micro Eazy (base) spec missing** | Only Monthly was supplied | Ask Micromart for the screen. Monthly carries the demo alone if it does not arrive. |
| **Sole-lender concentration** | One lender's appetite caps the whole ecosystem | The other four allocation modes ship dark from day one. Lender #2 is a config change, not a project. |
| **Regulatory posture** | BirgenAI is not a licensed lender | Lender-of-record named on every money screen (D2). ODPC registration + DPIA before external scale. |

---

## 13. Open items for the founder

1. **Micro Eazy (base product) full spec** — the second product screen from Micromart.
2. **Micromart's "Micro Eazy" workflow stages** — names, order, and who approves at each.
3. **`microeazy.birgenai.com`** — DNS record + Vercel domain.
4. **VAPID keypair** for Web Push (generated once, stored in the vault).
5. **Metropol production keys** — chase this week.
6. **Micromart's appetite for launch** — loans/day and maximum exposure. This is a commercial number
   and it belongs in the board conversation, not in a config file chosen by us.
7. **Commercial model** — per-loan origination fee, revenue share, or SaaS + usage. Needed before
   the attribution reporting in Sprint 2 has anything to invoice against.

---

*Grounded in: a live read of the LMS Postgres (11 orgs, Micromart 162 borrowers / 199 loans / 5 products
/ 2 workflows / MPESA_STK + CRB configured), `src/lib/decision/engine.ts`, `src/lib/lms/servicesuite.ts`,
`src/lib/nav/registry.ts`, `src/lib/suite/apps.ts`, `prisma/schema.prisma` (62 models), the Hub's
`prisma/seeds/apps.ts` and `src/types/app.ts`, and Micromart's own Micro Eazy Monthly product screen.*
