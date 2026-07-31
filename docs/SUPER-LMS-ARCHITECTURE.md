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

| Phase | Deliverable | Status | Unlocks |
| --- | --- | --- | --- |
| **0** | Suite launcher + console app-switcher, console theme | ✅ done | The demo narrative |
| **1** | Role-aware Filter Surface | ✅ done | Item 2 — visible sophistication, no schema change |
| **2** | TDL core (`OrgConfig` / `OrgConfigRevision`) + one `/api/config/:ns` | ✅ done | The foundation |
| **3** | Settings & Vault on the launcher grid, live-apply | ✅ done | Item 4 |
| **4** | Borrower Settings — 6 sections on the TDL | ✅ done | Item 5 |
| **5** | Product blocks + versioning + template packs | ✅ done | Beats their wizard outright |
| **6** | Decision fabric with reason codes | ✅ done | The Mular centrepiece |
| **7** | Real subdomain split for the satellites | ✅ done | Federation in production |

Phases 0–1 are demo-facing and landed first. Phase 2 is the load-bearing one; 3–5 followed fast
because they are all the same idea.

### What Phase 5 actually shipped

- `ProductVersion` — immutable snapshot per publish; `Product.version` counts, the flat columns
  become a **projection** of the live version (`projectToColumns`) so every pre-existing query
  keeps working unchanged.
- `Loan.productVersionId` / `LoanApplication.productVersionId` — stamped at booking
  (`lib/lending/book.ts`), so a loan can name the catalogue entry it came off forever.
- Eight blocks (`lib/products/definition.ts`) replacing 60 untyped `int?` columns, with
  **cross-block validation** their model cannot express — a monthly rate on a sub-monthly loan, a
  security-derived limit on a product requiring no security, an uncapped recurring rollover penalty.
- Five template packs (`lib/products/templates.ts`) — Micro Business, Salary Advance, Asset
  Finance, Logbook, Group/Chama — verified by `npm run test:products`, which also round-trips the
  column projection to prove a legacy product's first publish cannot corrupt its own terms.
- `POST /api/console/products/publish` is now the **only** write path for terms; the old
  field-by-field `POST`/`PUT` is gone rather than deprecated, because a bypass that exists is a
  bypass that will be used. `PUT` keeps shelving only — that changes nothing anyone agreed to.
- Version history with **loan counts per version** — the blast radius, which is the question a
  credit manager actually asks before moving a rate — plus a field-level diff between any two.

### What Phase 6 actually shipped

The centrepiece already existed — `lib/lending/qualify.ts` turns an internal score into a starting
limit, a matched product and reason codes. But it was **Mular's underwriting compiled into the
platform**: a hardcoded `SCORE_CEILING` table, the INUKA/KUZA/FADHILI ladder, product matching by
*name prefix*, and a 6-week/37.5% reference loan. The second lender needs different ceilings; the
third does not name their products INUKA; the fourth lends monthly. On that shape each is a code
change shipped to everyone.

- **`credit` — a new TDL namespace** (`lib/decision/policy.ts`). Score ceilings, capacity model,
  hard stops, haircuts, matching mode and verdict bands are now a lender's own document. What
  deliberately did *not* move: how a statement becomes a score. A score a lender can dial is not a
  score — policy decides what to *do* with it.
- **A seven-stage pipeline** (`lib/decision/engine.ts`):
  `capacity → stops → limit → match → price → route → verdict`. Pure and serialisable — same
  context, same decision, always. Every stage emits reason codes; the full trace is returned and
  stored on the application.
- **Rules-mode matching** reads each product's own published `eligibility` block — minimum score,
  cleared loans, age, one-at-a-time — instead of a name prefix. A lender writes the rule once, on
  the product, and the engine obeys it without knowing anything about that lender.
- **`POST /api/decisions`** — the same `decide()` the console calls, no second implementation to
  drift. Persists verdict, reason codes and the priced product **version** when given an
  `applicationId`.
- **Parity is proven, not asserted.** `npm run test:decisions` runs the new engine under a
  `MULAR_POLICY` preset against the live `qualify()` over ten borrower profiles and diffs limit,
  tier, ceilings, recommendation, per-shilling pricing and decline reasons. It also exercises what
  the old path could never do: product-level eligibility gating, policy haircuts, and reachable
  auto-approve bands with an amount cap.

The parity run caught one genuine defect on the way in: a declined applicant was still being
reported with a tier, which reads on screen as an offer that was withdrawn.

`qualify.ts` remains the live Mular path until `/api/enterprise/statement-cruncher` is cut over,
and now carries a header saying so, so no new rule is added to the wrong engine.

### What Phase 7 actually shipped

Phase 7 found that **the federation story was not yet true in production**, and made it true.

- **The session cookie had no `domain`.** A cookie set on `lms.birgenai.com` with no domain
  attribute is *host-only* — the browser will not send it to `people.birgenai.com`. Single sign-on
  "worked" purely because all five systems were one deployment. `SUITE_COOKIE_DOMAIN` now scopes it
  to the parent domain, which is the entire mechanism the suite rests on.
- **Set and clear are built from one `cookieIdentity()`.** A cookie is identified by
  `(name, domain, path)`; clearing with a different domain writes a *second, empty* cookie beside
  the live one and the browser keeps sending the original — a signed-out user who is still signed
  in. This is now structurally impossible.
- **The reserved-label lists were unified.** `src/proxy.ts` and `api/orgs` each kept their own hand-
  maintained list and had **already drifted**, and neither carried the satellite labels — so a
  lender could have signed up as `desk` and taken `desk.birgenai.com` out from under the
  call-centre. There is now one list (`lib/suite/hosts.ts`), derived partly from `SUITE_APPS`, so
  adding a system to the launcher reserves its subdomain automatically.
- **`SUITE_<ID>_ORIGIN` moves a system onto its own host, one at a time.** Unset means it keeps its
  in-app route; a malformed value degrades to that route rather than a dead link. No flag day.
- **Cross-origin links use plain anchors,** since the client router cannot soft-navigate off the
  current origin — `Link` would only add a failed prefetch before the full load happens anyway.
- **The launcher's copy was corrected** to say only what is mechanically true of the build, and the
  subdomain on each card now reads as *live* (green dot) or *reserved*, never as a split that has
  not happened.

`npm run test:federation` covers domain normalisation and rejection (`.localhost`, empty, `.`),
set/clear symmetry, every reserved label including case-insensitivity, that real lender slugs
(`mular`, `micromart`) stay available, origin resolution with trailing slashes, and malformed-origin
fallback.

### Deployment contract

| Variable | Purpose |
| --- | --- |
| `SUITE_COOKIE_DOMAIN` | Parent domain for the session cookie. Blank in dev/preview. |
| `SUITE_PORTAL_ORIGIN` etc. | Move one system onto its own origin. Blank = in-app route. |
| `NEXTAUTH_SECRET` | **Must be identical across every satellite** — it is what lets them verify a BirgenAI ID issued here. |

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
