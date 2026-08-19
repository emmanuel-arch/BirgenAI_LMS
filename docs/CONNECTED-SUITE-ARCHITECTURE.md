# The Connected Suite — six systems, one nervous system

**Written:** 18 August 2026. **Status:** the build contract for the Micromart demo.

This document is the foundation the six systems are built on. It is deliberately
written before the code, because the thing being sold is not six applications —
it is the *wiring between them*. Anyone can build six screens. The claim being
made to Micromart is that a promise-to-pay taken by a call-centre agent at 09:12
is visible in the loan officer's console, the customer's portal, the branch
manager's analytics, the accountant's ledger and the agent's own commission line
**by 09:12**, without an export, an import, or a nightly job.

---

## 1. The one-paragraph version

Micromart runs two books on one SQL Server (`services`, 100.72.35.56:4230):
**Serviceconnect** holds the lending ledger, **CollectBox** holds the collections
and call-centre floor, and **Transactions** holds the money movements. Those three
databases have never spoken to a single application at the same time. This
platform connects to all three through one read-disciplined bridge, projects them
into a single canonical domain model, and serves six front-ends off it. The
databases stay where they are. Nothing is migrated. The interconnectedness is
*computed*, not copied.

---

## 2. What is actually on the wire — verified live, 18 Aug 2026

Every number below was read from the production server during this build, not
estimated.

### 2.1 The server

```
SQL Server 2022 Enterprise · 16.0.1190.2 · host "services"
100.72.35.56,4230  (reachable over Tailscale)
Databases: Serviceconnect · CollectBox · Transactions · Notifications · IPF · Speciality
```

### 2.2 Serviceconnect — the lending ledger

| Entity | Name | Borrowers | Loans | Active | OLB (KES) |
|---:|---|---:|---:|---:|---:|
| **3002** | Micromart Africa (main book) | 141,061 | 272,789 | 69,967 | 342,237,928 |
| **3005** | **Micromart Fintech** | 17,020 | 61,503 | 1,732 | 770,850 |

3005 is the pilot entity: 17,016 borrowers were migrated into it from 3002 on
2 August 2026. It carries two live products — **Micro Eazy** (`Products.ID`
30219, 8.25% flat/week) and **Micro Eazy Monthly** (30220, 22% flat/month × 2) —
both on workflow 1022, stages 2058 (Risk) → 2059 (Customer Service).

Relationship officers live in `Borrowers.EntityAgent` → `UserMaster.ID`. Entity
3005 has **171 distinct relationship officers** carrying its book; the largest
carries 622 borrowers.

### 2.3 CollectBox — the collections and call-centre floor

This is the database that powers ConnectDesk, and it is far richer than expected:

| Table | Rows | What it is |
|---|---:|---|
| `CallLogs` | 1,342,610 | every disposition an agent has ever recorded |
| `PayedAmount` | 1,149,012 | agent-attributed collections, with M-Pesa codes |
| `PaymentHistory` | 465,624 | payment events against a tracked loan |
| `CallRings` | 448,972 | PBX ring events |
| `callcdr` | 328,253 | raw call detail records with recording URLs |
| `CallAlerts` | 318,623 | PBX alert stream |
| `ContractData` | 276,724 | the legacy per-campaign contact book |
| `CollectionTracker` | **93,376** | **the live queue — updated today at 22:43** |
| `PromisedToPay` | 150,345 | the PTP ledger |
| `Arrears` | 76,608 | arrears snapshots |
| `TaskScheduler` | 48,945 | callbacks and field visits |
| `CallCampaigns` | 18,430 | outbound campaigns |
| `SMS` | 12,603 | outbound collections SMS with delivery receipts |
| `PBXExtensions` | 44 | the physical phone floor |

96 stored procedures, 8 scalar functions, 2 views, 1 trigger.

**`CollectionTracker` is the live heart.** It was last written 18 Aug 2026 at
22:43, and it takes roughly 250 new rows every day. Its `LoanId` joins
`Serviceconnect.dbo.Loans.id` with **zero orphans across all 93,376 rows** — the
two databases are already referentially consistent. Nobody had joined them.

### 2.4 The collections taxonomy — `LoanCategories`

| ID | Category | Band (days) | Commission |
|---:|---|---|---:|
| 1 | Prepayment | 1–2 | 0% |
| 2 | Due | 0 | 0% |
| 3 | Watch 1 | 1–30 | 0.25% |
| 4 | Watch 2 | 31–60 | 1.2% |
| 5 | Watch 3 | 61–90 | 10% |
| 6 | NPL | 91+ | 10% |
| 7 | Watch 1 (Matured) | 1–30 | 0% |

Current tracker distribution: NPL 40,101 loans (KES 211.3M), Watch 3 17,334,
Due 10,630, Prepayment 9,307, Watch 1 6,171, Watch 1 Matured 7,897, Watch 2 1,926.

### 2.5 The disposition vocabulary — `PaymentResponse`

| ID | Disposition | Outcome |
|---:|---|---|
| 1 | Promised to pay | success |
| 4 | Ringing with no Response | fail |
| 6 | Hang Up | success |
| 8 | Call Back | success |
| 9 | Not Reachable | fail |
| 13 | Negotiation in Progress | success |
| 18 | Disputing | fail |
| 19 | Wrong Number | fail |
| 20 | Impounding | fail |
| 21 | Third party | fail |

### 2.6 The join that makes the suite possible

```
Serviceconnect.dbo.Loans.id
        │
        ├──► CollectBox.dbo.CollectionTracker.LoanId      (live queue)
        ├──► CollectBox.dbo.CallLogs.RecordID             (via ContractData/tracker)
        ├──► CollectBox.dbo.PayedAmount.LoanId            (agent collections)
        └──► Serviceconnect.dbo.Loans.collectionAgentID ──► CollectionAgents.ID
                                                                   │
                       CollectionAgents.AgentRef ──► Serviceconnect.dbo.UserMaster.ID
                       CollectionAgents.CollectBoxRef ──► CollectBox.dbo.UserMaster.ID
```

`Serviceconnect.dbo.CollectionAgents` is the Rosetta stone: it is the only table
that carries **both** a Serviceconnect staff id (`AgentRef`) and a CollectBox
agent id (`CollectBoxRef`). It is how a call-centre agent and a loan officer
become the same human being in this platform.

### 2.7 The gap this demo closes

**CollectBox contains 93,376 tracked loans and every one of them is EntityId 3002.**
The Fintech entity 3005 — the entity Micromart are moving their future onto — has
**no presence in CollectBox at all**. Their new book has no collections engine.

That is not a problem to hide. It is the demo:

> The 3002 book proves the engine works at scale — 1.3 million calls, KES 278M
> under management. The 3005 book shows what happens when the pipeline is turned
> on: Micro Eazy arrears flow into the same queue, through the same agents, under
> the same commission bands, **via the API, with no migration**.

---

## 3. The six systems

| # | System | Route | Reads | Writes | Accent |
|---:|---|---|---|---|---|
| 1 | **Lending Console** | `/console` | Serviceconnect 3005 + 3002 | Loans (gated) | `#2a78d6` |
| 2 | **Customer Portal** | `/` | Serviceconnect (borrower-scoped) | Applications | `#0e7490` |
| 3 | **Analytics Studio** | `/analytics` | Serviceconnect + CollectBox | — | `#7c3aed` |
| 4 | **ConnectDesk Call-Center** | `/desk` | **CollectBox** + Serviceconnect | CallLogs, PTP, Tasks (gated) | `#be123c` |
| 5 | **PeopleHub HR** | `/people` | UserMaster + CollectionAgents | Leave, shifts | `#6d28d9` |
| 6 | **Ledgerly Accounting** | `/books` | Transactions + Loans | Journals | `#0f766e` |

**What is identical across all six:** the `Shell`, the `Sidebar`, the letterhead
card in the top-left corner carrying the Micromart mark, the canvas, the identity
pill, the type scale, the panel treatment, the motion language.

**What differs:** the login page artwork, the accent colour, and the nav tree.
Nothing else. A user who learns one system has learned all six.

---

## 4. The spine — how interconnectedness is actually achieved

Six systems sharing a database is not interconnectedness; it is a shared
database. Interconnectedness is three specific mechanisms:

### 4.1 One identity — BirgenAI ID

Already built (`src/lib/suite/`). A session carries identity, org and branch
across all six. **Rights do not cross**: an HR manager does not inherit
disbursement authority. Each app declares the right that admits you.

### 4.2 One canonical subject — the Interaction Timeline

`src/lib/interactions/` is new and is the centrepiece. Every system writes
interactions into one shape, and every system reads the same merged stream:

```ts
type Interaction = {
  id: string;                  // stable, source-qualified
  at: Date;
  source: "collectbox" | "serviceconnect" | "lms" | "portal" | "desk" | "sms";
  kind: "call" | "ptp" | "payment" | "sms" | "task" | "note" | "loan" | "visit";
  actor: { id: string; name: string; system: string } | null;
  subject: { borrowerId?; loanId?; phone? };
  headline: string;
  detail?: string;
  amount?: number;
  outcome?: "success" | "fail" | "pending";
}
```

The merge reads live from `CollectBox.CallLogs`, `CollectBox.PromisedToPay`,
`CollectBox.SMS`, `CollectBox.TaskScheduler`, `CollectBox.PayedAmount`,
`Serviceconnect.Loans` and our own Postgres. **One function, six consumers.**
A call logged in ConnectDesk appears in the console's Customer 360, the portal's
activity feed, and the analytics agent screen — because all four call the same
function.

### 4.3 One arithmetic — the metric layer

The console tile, the analytics chart and the ConnectDesk KPI must never disagree.
Every measure resolves through one catalogue so OLB is OLB everywhere.

---

## 5. The write discipline

CollectBox is a **live production database** for a business that is running right
now. The write path is therefore:

```
Agent action
     │
     ├──► ALWAYS: our Postgres            (immediate, authoritative for us)
     │
     └──► IF COLLECTBOX_POSTING_ENABLED:  mirror into CollectBox
                                           (CallLogs / PromisedToPay / TaskScheduler)
```

Shadow mode is the default and the demo runs in it. Every screen is fully
interactive; the timeline builds up as you demo; nothing touches Micromart's
production tables until one environment variable is flipped. Every shadowed write
records the exact SQL it *would* have run, so arming it is a verification, not a
leap.

`src/lib/collectbox/write.ts` is the only module permitted to write to CollectBox.

---

## 6. Build order

| Phase | Deliverable |
|---:|---|
| 0 | CollectBox bridge · interaction timeline · shared chrome |
| 1 | **ConnectDesk** — floor, queues, agents, PTP, campaigns, dispositions |
| 2 | Lending Console on live 3005 borrowers + relationship officers |
| 3 | Analytics Studio pointed at the live book |
| 4 | `/suite` — the colourful launcher with live pipeline telemetry |
| 5 | PeopleHub + Ledgerly on live staff and money |
| 6 | Six login artworks |

---

## 7. Standing rules

1. **Read-only unless gated.** `runReadOnlyQuery` for everything; writes go
   through a flag and a single module.
2. **Three-part qualification.** `CollectBox.dbo.X` — one pool, three databases.
   Never a second connection string for the same server.
3. **No number without a source.** Every figure on every screen traces to a query
   in a file. Simulated figures are labelled as such, on screen, in words.
4. **Entity is an identity boundary.** 3002 and 3005 share phone numbers that
   belong to different people. Never resolve a borrower across entities by phone.
5. **The chrome is shared.** Any change to the sidebar is a change to six systems.

---

## 8. What was built — final state, 19 August 2026

All six systems read Micromart's live SQL Server. None is a mock.

| System | Route | Reads | State |
|---|---|---|---|
| Lending Console | `/console` | Serviceconnect | pre-existing, live |
| Customer Portal | `/` | Serviceconnect | pre-existing, live |
| Analytics Studio | `/analytics` | Serviceconnect | pre-existing, live |
| **ConnectDesk** | `/desk` | **CollectBox + Serviceconnect** | **new — 11 screens** |
| **PeopleHub** | `/people` | UserMaster + CollectionAgents + Borrowers | **new** |
| **Ledgerly** | `/books` | **Journals + Accounts** | **new** |

### 8.1 The three databases, joined

```
Serviceconnect          CollectBox              Transactions
  Loans      ──────────► CollectionTracker        Payments
  Borrowers               CallLogs                Disbursments
  loanSchedule            PayedAmount
  Journals                PromisedToPay
  Accounts                TaskScheduler
  UserMaster ◄─ CollectionAgents ─► UserMaster
```

### 8.2 Findings that changed the build

**Every one of these was a bug or a wrong assumption caught by measuring.**

1. **`useUTC` was three hours wrong.** SQL Server `datetime` carries no timezone;
   node-mssql tagged Nairobi wall-clock as UTC. Every timestamp arrived three
   hours in the future. Fixed at the connection; `lib/enterprise/tz.ts` asserts
   the process timezone at boot.

2. **Ageing off `ExpectedClearDate` was wrong** by up to 242%. A collections book
   ages on the INSTALMENT SCHEDULE, not final maturity. Switched to the earliest
   unpaid `loanSchedule` row: 97.3% agreement with Micromart's own nightly job
   within 7 days, 74.6% within 3.

3. **The production schema is almost entirely unindexed.** `loanSchedule` (1.95M
   rows) and `Loans` (338k) both lack an index on the column every join uses.
   Correlated lookups became full table scans. Four queries were rewritten from
   join-inside to page-then-enrich:

   | Query | Before | After |
   |---|---:|---:|
   | `getQueue` | 12,500ms | 840ms |
   | `listRecoveries` | 39,218ms | 673ms |
   | `projectFintechPipeline` | 8,623ms | 726ms |
   | `reconcileBands` | 6,992ms | 199ms |
   | `getRoster` | 17,205ms | 754ms |
   | `listTasks` | 7,579ms | 601ms |

4. **`IsLocked = 1` on every agent**, including the 26 who recovered KES 2.5M
   that day. The column does not mean what it says; presence is derived from
   activity instead.

5. **Relative timestamps caused hydration mismatches.** `ago()` is a function of
   the current time, so server and client rendered different strings. `TimeAgo`
   renders a stable absolute value until mounted, then ticks.

### 8.3 Operational findings for Micromart

Surfaced on the screens rather than hidden behind empty states:

- **`PromisedToPay` last written 21 Nov 2024.** Twenty months of calls and
  payments with nothing captured about what customers commit to.
- **`TaskScheduler` last written Aug 2025; 30,713 tasks still open.** Nothing
  closes them, so the list became unusable and stopped being used.
- **`callcdr` last written Sept 2023.** The PBX integration exists but no longer
  points at CollectBox — ring time, talk time and recordings are missing.
- **Entity 3005 has no collections presence at all.** 17,016 borrowers and
  61,503 loans moved there on 2 Aug 2026 and left the floor entirely.

### 8.4 What is deliberately not shown

Payroll, leave, contracts and appraisals. `AgentPerformanceHistory`,
`LoanAgentMetrics` and `UserProfile` all exist and are all empty. PeopleHub names
those tables instead of inventing figures — a demo that fabricates a salary
cannot be trusted about the balances either.

### 8.5 Write posture

`COLLECTBOX_POSTING_ENABLED` is unset. Every desk action is recorded in our
Postgres and the CollectBox statement is composed, rendered with values inlined,
and held at `/desk/shadow` for review. Nothing has been written to Micromart's
production database.
