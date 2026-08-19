# Demo runbook — the connected suite

**For:** Micromart. **Duration:** 20 minutes for the core, 35 with the detail.

---

## Before you start

```bash
npm run dev                      # http://localhost:3000
npm run test:collectbox          # proves the live bridge — run it in front of them if you like
npm run test:desk                # proves the desk layer, the pipeline and the shadow write
```

Both should end **ALL CHECKS PASSED**. They read live; if the Tailscale link to
`100.72.35.56` is down they will say so plainly rather than half-working.

**Sign in:** `desk.supervisor@micromart.birgenai.com` / `DeskDemo2026!`
(also `desk.agent@` and `desk.viewer@` — same password, narrower rights, useful
if somebody asks "what does an agent actually see?").

The daily OTP is emailed; in development the login response carries a
`fallbackCode` you can paste.

**Two things to check on the day**

- Open `/desk` once before the room fills. The first render of each route
  compiles; after that everything is 1.5–4s.
- Do it during **working hours**. The floor's numbers reset at midnight EAT, so
  at 09:00 you will see a day building and at 00:30 you will see almost nothing.

**Write posture:** `COLLECTBOX_POSTING_ENABLED` is unset. Everything is
interactive and nothing reaches Micromart's production database. Say this out
loud early — it is a strength, not a caveat.

---

## The 20-minute path

### 1 · `/suite` — "six systems, one live book" (2 min)

Open cold. Let them read it before you talk.

> Every figure on this page was read from your SQL Server when it rendered.
> Nothing is seeded. Six systems, six colours, one sign-in.

Point at the **pipelines strip**. Three lanes green, one amber:
`Fintech 3005 → ConnectDesk · not connected`. That amber is the whole meeting.

### 2 · `/desk` — the live floor (4 min)

> This is your collections floor, right now.

Four numbers: recovered today, book under collection, agents on the floor,
promises outstanding. Then:

- **Where the book is sitting** — their seven queues, their names, their
  commission rates. Toggle Balance / Loans / Today.
- **Today, by hour** — the shape of the shift.
- **The floor today** — their agents, by name, ranked by cash. Not by dials.
- **Across the suite** — calls, payments and disbursements from every system in
  one stream, with real M-Pesa codes.

The header pill ticks. Let it.

### 3 · `/desk/queue` → a case (5 min)

Sort by **Longest untouched**.

> Highest-value is the obvious sort. This one is the useful one — it is what
> stops a book going quietly cold while everyone works the same familiar names.

Open any case. This is the moment:

> No system you run today can show an agent this. On the left, every loan this
> customer has ever taken. In the middle, everything that has ever happened to
> them — merged from your call logs, your payments table, your PBX, your core
> ledger and this desk. On the right, the call.

Pick a disposition. Show the **"This will"** block before submitting — it lists
exactly what happens, including the shadow line. Submit it. Show the composed
SQL. Then `/desk/shadow`:

> Everything ConnectDesk would write to your database, in full, held for review.
> Arming it is one environment variable — and you read this list first.

### 4 · `/desk/pipeline` — the bridge (6 min)

**This is the close.**

> 93,366 loans on your collections floor. Zero of them are entity 3005.

Walk the six sections in order — they are laid out as the argument:

1. **The gap**, side by side.
2. **The mechanism** — the diagram's numbers are live.
3. **Why the ageing can be trusted** — 98% agreement with their own nightly job.
   > We did not invent an ageing rule. We reproduced yours and measured it.
4. **Which queues, who carries it, what it earns.**
5. **The customers who would arrive tomorrow** — real Micro Eazy borrowers,
   61 of 62 arriving with an average of 6.9 prior loans of history.
6. **Run it.** Press **Preview** — statements compose, nothing runs.

### 5 · `/books` and `/people` (3 min)

> One more thing. You have been keeping a proper double-entry journal for three
> years — 6.4 million postings — and nothing has ever read it.

`/books`, then `/people`. On PeopleHub, point at **"What this cannot show"**:

> Three empty tables, named. We will not invent a payroll figure. If we would
> make that up, you could not trust the balances either.

---

## If they ask

**"Is this really live?"** — `npm run test:collectbox` in front of them. Or
refresh `/desk` and watch the last-payment stamp move.

**"What did you have to change on our side?"** — Nothing. Read-only, one
connection, no schema change, no migration. `/desk/shadow` is empty of executed
statements.

**"Why is our data missing in places?"** — Show them; the screens say it
themselves. Promises stopped in Nov 2024, tasks in Aug 2025, CDR in Sept 2023.
These are findings about their process, not gaps in the software.

**"How fast is it really?"** — `npm run bench`. Twelve reads, each timed.

**"Can you make it faster?"** — Yes, and there is a measured plan:
`npm run db:index-advisor`. It reports that `loanSchedule` (1.95M rows),
`Loans` (338k), `CallLogs` (1.34M) and `PayedAmount` (1.15M) carry **no indexes
at all**, and proposes nine, online and reversible. **Not applied** — it is their
database. Their own reporting is almost certainly paying the same tax.

---

## After the demo

```bash
npx tsx scripts/setup-desk-demo.ts --suspend
```

Suspends the three demo sign-ins. They open a real lender's book.
