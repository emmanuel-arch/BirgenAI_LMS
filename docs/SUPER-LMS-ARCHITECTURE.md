# The Super-LMS — Architecture for 100+ Lenders

**Companion to:** `LMS-2.0-BLUEPRINT.md` (which describes the *product*). This describes the
*platform underneath it*: how one codebase serves a hundred lenders who never agree on anything.

**Reference system analysed:** `ServiceSuite-Portal` (ASP.NET MVC + SQL Server `Serviceconnect`,
~27 live entities). Read at source, not from screenshots — findings in §2 cite real files.

---

## 1. The thesis, in one line

> **ServiceSuite made the *values* per-tenant. We make the *definition* per-tenant.**

That is the whole step-up. Everything below is a consequence of it.

A lender on ServiceSuite can choose *their* minimum age, *their* interest rate, *their* logo. They
cannot invent a field, a product shape, a stage, a document type or a rule that the vendor did not
ship first. Every genuinely new requirement is a schema migration, a new form handler, a new view,
a deploy — for **all 27 entities at once**. That is why onboarding a lender is a project, not a
signup, and why the 28th lender costs as much as the 1st.

We invert it. The lender's configuration becomes **typed, versioned data** that a generic renderer
and a generic engine consume. Onboarding becomes an afternoon. The 101st lender costs nothing.

---

## 2. What the reference system actually does (evidence)

Not a criticism of the team — this is the normal shape of a system grown over a decade. It is
simply the ceiling we are buying our way past, and naming it precisely is what lets us beat it.

### 2.1 Settings are a wide table, one column per idea

`BorrowerSettings` is **one row per `EntityId`, one column per setting**
(`ServiceSuite/Models/BorrowerManager.cs:465` — `SELECT * FROM BorrowerSettings WHERE EntityId=@EntityId`).

The Borrower Settings page is served by **seven separate hand-written POST handlers**, each with
its own 40-line `MERGE` statement listing every column twice
(`Controllers/BorrowerController.cs`):

| Handler | Line | Columns merged |
| --- | --- | --- |
| `KycSettings` | 2414 | `firstName, otherName, DOB, Gender, NationalID, PhoneNumber, EmailAddress, PostalAddress, PhysicalAddress, PassportPhoto, IdentificationDoc, IdentificationDocReq, KycVerification, KycTicketType` |
| `AccountSettings` | 2518 | `AccountNo, AccountNoPrefix, AccountNoLength` |
| `LoanLimitSettings` | 2602 | `LoanLimit, defaultLoanLimit` |
| `CreditScoreSettings` | 2669 | `CreditScore, defaultCreditScore` |
| `OnboardingRules` | 2768 | `AgeLimit, minAge, maxAge, JoiningFee, Dormancy, ReactivationFee, Referees, minReferees, maxReferees` |
| `OnboardingWelcomeSms` | 2955 | `welcomeMsgTemplates` |
| `OnboardingAttachments` | 2993 | `attachments` (a **comma-joined string of IDs**, re-split in SQL via `STRING_SPLIT` — `BorrowerManager.cs:511`) |

**Cost of one new borrower setting:** `ALTER TABLE` → new column in two halves of a `MERGE` → new
`AddWithValue` → new Razor partial → redeploy → *every* entity gets it whether they want it or not.

### 2.2 Products are 60 nullable integers of magic numbers

`Models/LoanProduct.cs` — 231 lines, ~60 `int?` fields, almost all untyped codes:

```csharp
public int? RollOverOn { get; set; }          // 1? 2? 3? — meaning lives in a Razor <option>
public int? newLoanStatus { get; set; }       // approval-required vs direct-funding
public int? modeOfDisbursement { get; set; }  // M-Pesa | Bank | Cash
public int? InterestMethod { get; set; }      // no enum, no validation, no constraint
```

Three structural consequences:

1. **No product versioning.** `Loan` points at the product *row*. Edit the rate on Tuesday and
   Monday's loans silently re-describe themselves. There is no honest answer to *"what were the
   terms this borrower actually agreed to?"* — the audit answer and the screen answer differ.
2. **No validation layer.** Nothing stops `MinPrincipal > MaxPrincipal`, a 6-installment weekly
   product with a monthly interest period, or a rollover penalty with no grace unit.
3. **The wizard is the schema.** The 6 steps (Details → Rollover → Options → Rules → Attachments →
   Availability) are hardcoded Razor views. A lender who wants a 7th concept waits for a release.

### 2.3 Rights gate menus, not routes

Already noted in our own `src/lib/rbac/rights.ts`: in ServiceSuite, `Update Role` checkboxes decide
which **menu items render**; the controllers themselves trust anyone with a session. A URL typed by
hand is a URL served.

### 2.4 The dashboard filter is one modal for everyone

`filter dashboard.png` — four raw `<select>`s (Organization Level, Office, Product, Agent). The
Office list is ~40 unsearchable options in a native scroll box. **A field officer, a branch manager
and the CEO are all shown the identical modal**; scoping is whatever the proc decides afterwards.
There is no notion of *"this filter is not yours to open."*

### 2.5 What it gets genuinely right (keep these)

Credit where due — these are good ideas we are porting, not replacing:

- **A single self-referencing org tree** with lender-named levels (Region → Branch → Sub-branch),
  which is what makes a regional manager expressible at all. We already mirror this in
  `src/lib/rbac/scope.ts` (`BRANCH_TREE`).
- **Three approval tiers** (Initiator / Authorizer / Validator) as a *product-level* choice, with
  separate workflows for new vs repeat loans.
- **Attachments as a per-entity catalogue** (`AttachmentFiles`) that products and onboarding both
  select from, rather than two disconnected lists.
- **Per-entity branding with a contrast guard** (`Models/Preferences.cs:265` — an entity's colour is
  WCAG-checked against white and falls back if it would render invisible). That is a thoughtful
  detail most white-label systems miss, and we should match it.

---

## 3. The step-up: four moves

### Move 1 — The Tenant Definition Layer (TDL)

One idea, applied everywhere: **a lender's configuration is a versioned, typed document, not a row
of columns.**

```
ConfigNamespace   borrower | product | application | collections | comms | field | accounting …
ConfigDefinition  the SCHEMA of a namespace: fields, types, validation, ordering, help text
ConfigVersion     an immutable, published snapshot (v1, v2, v3 …) with an author + timestamp
ConfigValue       what THIS org set, against a specific version
```

- **Schema, not columns.** A new setting is a row in `ConfigDefinition`, not an `ALTER TABLE`.
- **Versioned.** Publishing v4 does not disturb loans booked under v3. Every artefact that must be
  reproducible (a loan, an offer, a decision) stores the `configVersionId` it was made under.
- **Platform-default + org-override.** BirgenAI ships a sane default definition per namespace; a
  lender overrides only what they care about. A new platform field appears for everyone without
  overwriting anyone's choices.
- **One generic renderer.** `<ConfigForm namespace="borrower.kyc" />` renders *whatever* the
  definition says — toggle, number, select, currency, band table, attachment picker. Seven
  hand-written POST handlers collapse into **one** `PUT /api/config/:namespace`.
- **One generic validator.** The definition carries its own constraints (`min<max`,
  `requires`, `oneOf`), so the same rules run on the client, the server and the API.

**This is the foundation.** Items 4 and 5 of the founder's brief (Settings, Borrower Settings) are
its first two consumers; Products is the third.

### Move 2 — Products become versioned, composed offerings

Replace the 60-column product with a **composition of named blocks**, each independently
versioned and re-usable across products:

```
PricingBlock     method (flat|reducing|balloon), rate, basis, fees, early-settlement rebate
ScheduleBlock    cycle, installments, grace, skip-days, business-day handling
LimitBlock       fixed | range | bands | derived-from-security | derived-from-score
RolloverBlock    penalty base, grace, one-time vs recurring, cap
EligibilityBlock min score, min limit, age, KYC tier, guarantor, security cover
ProcessBlock     new-loan workflow, repeat-loan workflow, direct-funding ceiling
EvidenceBlock    required attachments, forms, geo-pin requirement
AvailabilityBlock branches/regions, channels (console|portal|USSD|API), active window
```

Every booked loan stores `productVersionId`. **"What were the terms?" becomes a lookup, not an
argument.** A product edit is a *new version* with a diff screen showing exactly what changed and
how many live loans reference the old one.

The wizard stays a wizard on screen — but it is *generated* from the blocks, so adding a concept
adds a step everywhere at once, including the public API.

### Move 3 — The decision fabric

Rules stop being scattered `if` statements in controllers and become one evaluated pipeline:

```
Application → [Eligibility] → [Limit engine] → [Score gate] → [Product match]
            → [Workflow route] → [Approval] → [Disbursement rail]
```

Each stage is declarative, each emits **reason codes**, and the whole trace is stored on the
application. This is what makes the internal-score → starting-limit → product-match centrepiece
demonstrable rather than assertable: you can point at *why*, per borrower, in plain language.

It also makes the engines sellable separately (see `birgenai-api-first-productization`): the same
pipeline behind `POST /v1/decisions` is what the console calls.

### Move 4 — Federation, not a monolith

Five systems, five subdomains, one identity — detailed in §5.

---

## 4. The layer cake

```
┌──────────────────────────────────────────────────────────────────────┐
│  SURFACES   console · customer portal · USSD/app · partner API       │
├──────────────────────────────────────────────────────────────────────┤
│  RENDERERS  ConfigForm · ProductWizard · FilterSurface · Launcher    │  ← generic, definition-driven
├──────────────────────────────────────────────────────────────────────┤
│  DECISION   eligibility · limit · score · product-match · workflow   │  ← reason-coded, versioned
├──────────────────────────────────────────────────────────────────────┤
│  TDL        ConfigDefinition · ConfigVersion · ConfigValue           │  ← the lender's own schema
├──────────────────────────────────────────────────────────────────────┤
│  CORE       Org · Branch tree · Role+DataScope · Staff · Borrower    │  ← universal, never per-lender
├──────────────────────────────────────────────────────────────────────┤
│  ISOLATION  Postgres RLS (prisma/rls.sql) + orgId on every row       │  ← the tenancy guarantee
└──────────────────────────────────────────────────────────────────────┘
```

**The rule that keeps this honest:** anything a lender might reasonably want *different* lives in
the TDL. Anything that must be true for *every* lender (a loan has a balance; a payment reduces it;
RLS holds) lives in CORE and is not configurable. Confusing the two is how configurable systems rot
into unmaintainable ones.

---

## 5. Federation — five front doors, one BirgenAI ID

```
lms.birgenai.com          Lending Console      (the anchor — this repo)
my.birgenai.com           Customer Portal      (borrower self-service)
people.birgenai.com       PeopleHub HR
books.birgenai.com        Ledgerly Accounting
desk.birgenai.com         ConnectDesk Call-Center
```

**Identity spine.** One session cookie scoped to `.birgenai.com` (the same mechanism already proven
in `birgenai-suite-sso` for hub + Movies). Each system keeps its own login page — brand, colour,
copy — and each honours the same BirgenAI ID. No second password, no divergent user lists.

**What crosses the boundary, and what does not:**

| Crosses | Stays home |
| --- | --- |
| Identity (who you are) | Rights (what you may do *here*) |
| Org + branch tree | That system's own data |
| Role *assignment* | Role *definition* per system |
| Audit stream | — |

Rights are **per-system**, deliberately. An HR manager with full PeopleHub access must not inherit
disbursement authority in the LMS because they share an ID. The switcher shows every system; it
shows *entered* only for the ones the person actually holds a role in, and offers "request access"
for the rest.

**Why it demos well.** The lender sees a chrome app-switcher (⌘K, or the grip in the top bar), picks
Accounting, and is *already in* — with their name, their org and their branch already correct. That
is the exact experience of Google Workspace or Atlassian, and no LMS vendor in this market has it.

**Cross-system flows that only federation makes possible** — and which are the real sales argument:

- A **field officer's leave** in PeopleHub auto-reassigns their collections queue in the LMS.
- Every **disbursement** posts a journal to Ledgerly; the trial balance is never re-keyed.
- A **missed installment** opens a ConnectDesk task with the borrower's 360 already attached.
- **Payroll** and **loan-book cash** reconcile against the same M-Pesa float ledger.

---

## 6. Onboarding a lender without touching code

The measure of the whole architecture. Target: **a lender is live the same day, unattended.**

1. **Claim** — name, subdomain, country, currency. `Org` row + RLS in force from the first insert.
2. **Brand** — logo upload → accent auto-derived → contrast-checked (port ServiceSuite's WCAG guard,
   §2.5) → live preview of the console *and* the portal.
3. **Structure** — name your levels ("Region / Branch"), draw the tree, or paste a CSV.
4. **Package** — plan picks entitlements; entitlements gate features (already built:
   `src/lib/billing/entitlements.ts`).
5. **Products** — start from a **template pack** (Micro Business, Salary Advance, Asset Finance,
   Logbook, Group/Chama), then tune. Templates are TDL documents, so "start from" is a copy.
6. **Rules** — Borrower Settings (KYC fields, account numbering, limits, scoring cadence, onboarding
   rules, attachments) via one generic ConfigForm.
7. **People** — invite staff, assign roles + data scope; credentials mailed.
8. **Rails** — Daraja, SMS, CRB in the vault; each with a **Test connection** button that proves it.
9. **Go live** — the checklist flips green and activation is automatic, not a support ticket.

Nothing on that list is a developer task. That is the point.

---

## 7. Holding 100+ lenders

| Concern | Approach |
| --- | --- |
| **Isolation** | Postgres RLS + `orgId` on every row. Already in place — the database, not the app, is the boundary. |
| **Noisy neighbours** | Per-org rate limits (`RateLimit` model exists); heavy analytics on a read replica (open item 22). |
| **Config reads** | TDL definitions cached per `(org, namespace, version)` — immutable versions make caching trivially safe. |
| **Schema drift** | There is none. One schema; per-lender variation is *data*. |
| **Rollout risk** | Definition versions ship dark, publish per-org, roll back by pointing at the previous version. |
| **Support** | Platform admin impersonation (built) + per-org audit stream. |
| **Cost per lender** | Marginal. Onboarding is self-serve; the 101st costs storage. |

---

## 8. Phase plan

| Phase | Deliverable | Unlocks |
| --- | --- | --- |
| **0** | Suite launcher + console app-switcher, console theme | The demo narrative |
| **1** | Role-aware Filter Surface | Item 2 — visible sophistication, no schema change |
| **2** | TDL core (`ConfigDefinition/Version/Value`) + `ConfigForm` renderer | The foundation |
| **3** | Settings & Vault on the launcher grid, live-apply | Item 4 |
| **4** | Borrower Settings — 6 namespaces on the TDL | Item 5 |
| **5** | Product blocks + versioning + template packs | Beats their wizard outright |
| **6** | Decision fabric with reason codes | The Mular centrepiece |
| **7** | Real subdomain split for the satellites | Federation in production |

Phases 0–1 are demo-facing and land first. Phase 2 is the load-bearing one; 3–5 are then fast
because they are all the same renderer.

---

## 9. The demo argument, compressed

Three sentences, for the room:

1. *"Your current system lets you choose your values. Ours lets you define your own system —
   your fields, your products, your rules — without waiting for us."*
2. *"Every product has a version, so every loan can tell you exactly what it agreed to, forever."*
3. *"Your lending, your customers, your people, your books and your call floor are five systems with
   five front doors and one login — click any of them and you are already in."*

---

*Author: Emmanuel Birgen · Serve Well Co. · drafted 31 July 2026*
