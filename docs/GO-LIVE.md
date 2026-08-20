# Go-live — the connected suite on servicesuitecloud.com

**Written:** 19 August 2026. **Status:** the execution plan for the Micromart demo.

This is the checklist that turns six systems running on one laptop into six
systems running on a public domain, all reading Micromart's live database. It is
split by **who does it**, because two tracks can run in parallel.

- [The one blocker, and what it was](#1-the-one-blocker) — solved in code
- [Your side: DNS](#2-your-side--dns)
- [Your side: Vercel environment](#3-your-side--vercel-environment)
- [Your side: the six artworks](#4-your-side--the-six-artworks)
- [Your side: Safaricom and Metropol](#5-your-side--safaricom-and-metropol)
- [One screen per person in the room](#6-one-screen-per-person-in-the-room)
- [Demo-day checklist](#7-demo-day-checklist)

---

## 1 · The one blocker

Every screen in the suite showed the same amber banner when deployed:

> Micromart's server is not reachable right now

That was **not** a configuration mistake, and no environment variable could have
fixed it. Micromart's SQL Server is at `100.72.35.56` — an address in
`100.64.0.0/10`, the Tailscale CGNAT range. It has no internet route at all.
A Vercel function cannot open a socket to it under any configuration, ever.

Locally it works because this workstation is *on* the tailnet. That is the whole
of the difference, and it is why the same code passed every local test and
failed everywhere else.

### What was built

A **SQL relay**: one small process that sits on both networks.

```
Vercel function ──HTTPS (signed) ──► relay (on the tailnet) ──TDS──► 100.72.35.56
```

- `src/lib/enterprise/relay.ts` — the codec, the signing, the client
- `scripts/sql-relay.ts` — the server that holds the real connection pool
- `scripts/verify-relay.ts` — `npm run test:relay`, an outside-in proof

All forty live-read call sites across all six systems go through one function,
`runReadOnlyQuery()`, so the application did not change. No page, no component
and no query was touched. With `SERVICESUITE_RELAY_URL` unset, the relay does not
exist and local development stays on the direct TDS path.

**Proven working, 19 Aug 2026:** 93,622 tracked loans read through the relay in a
758ms round trip, `DATETIME` values preserved as real `Date` objects, and writes
refused at the relay itself.

### Two properties worth saying out loud in the meeting

**Micromart's database password never leaves the tailnet.** With a relay
configured, `SERVICESUITE_CONN_MICROMART` does not need to be set on Vercel at
all. The cloud holds a *signing secret*, not a credential. If the hosting account
were compromised tomorrow, the attacker would hold a key that can ask a
read-only relay for numbers already on a screen.

**Read-only is enforced at the socket, not by policy.** `SQL_RELAY_ALLOW_WRITES`
lives on the relay host. Whatever the application believes, the machine that owns
the connection refuses to write. `npm run test:relay` proves this by attempting a
write and confirming the refusal.

### Running it

On a tailnet machine that stays on — the `lms` node (`100.92.236.116`) is the
right one, not a laptop that closes.

**Step 0, once per tailnet: Funnel must be switched on.** It is off by default,
and until it is, `tailscale funnel` prints this and does nothing else:

```
Funnel is not enabled on your tailnet.
To enable, visit:
    https://login.tailscale.com/f/funnel?node=…
```

Open that link, approve it, and the rest works. It also needs **HTTPS
Certificates** enabled under the tailnet's Settings → Features.

```bash
npm run relay              # holds the pool, listens on 127.0.0.1:8787
tailscale funnel --bg 8787 # publishes it, and PRINTS THE REAL URL
```

The URL it prints looks like `https://lms.tail10c441.ts.net` — that exact
string, copied from the terminal, is what `SERVICESUITE_RELAY_URL` must be.

**Funnel is enabled per NODE, and the URL is the node's name.** Enabling it for
the laptop does not enable it for the server, and moving the relay from one to
the other changes the hostname — so `SERVICESUITE_RELAY_URL` on Vercel has to
change with it. Decide which machine holds the relay *before* setting the
variable, or you will set it twice.

**Does it have to be the server?** No. The host needs three things and nothing
else: it is on the tailnet, Funnel is enabled for it, and it stays awake. A
laptop satisfies all three — measured warm round trip through Funnel is 80–134ms,
which is nothing next to the queries themselves. The reason to prefer an
always-on node is not performance, it is that a laptop which sleeps, closes or
changes network takes **all six systems degraded at once**, and the laptop is
usually the thing being carried into the meeting.

Whichever machine holds it also needs `.env` — the connection string and the
relay secret. That is the real cost of moving it, not the Funnel setup.

> ⚠ **The one mistake that looks like a total outage.** Pasting the placeholder
> `https://<host>.<tailnet>.ts.net` from this document into Vercel leaves a
> deployment that starts, signs people in, serves every route — and cannot read
> one number, because it is dialling a hostname that does not exist. Every screen
> shows its honest "not reachable" state at once, which reads like the database
> is down. `npm run test:live` names it in one line.

Tailscale Funnel gives a public HTTPS URL with a real certificate, no DNS work
and no inbound firewall rule. The URL is ugly; nobody ever sees it. Cloudflare
Tunnel works identically if preferred.

---

## 2 · Your side — DNS

### The question you asked, answered

> `servicesuitecloud.com` is mapped to a Windows/IIS server that publishes
> projects as paths (`/servicesuite`, `/buysimu`). Should ours be
> `/connectedsuite`, and will subdomains interfere?

**Subdomains do not interfere. Use subdomains.**

DNS records are per-hostname and completely independent of each other:

| Hostname | Record | Points at | Serves |
|---|---|---|---|
| `servicesuitecloud.com` | A | `102.214.69.233` | your IIS box — `/servicesuite`, `/buysimu`, … |
| `connectdesk.servicesuitecloud.com` | CNAME | Vercel | ConnectDesk |

Adding the second row does not touch the first. The IIS server never receives
subdomain traffic — it never learns those hostnames exist. Nothing you publish
under the apex today or later is affected.

### Why a path would be the worse choice

1. **It changes your production server.** `servicesuitecloud.com/connectedsuite`
   means traffic hits IIS first, which must reverse-proxy to Vercel — that needs
   ARR and URL Rewrite installed and configured on the box your other projects
   are already serving from. That is a risky change to make in the week of a
   demo, and it puts a single point of failure in front of everything.
2. **It changes every URL in this application.** Next.js would need a global
   `basePath`, which rewrites every route, asset, API path, auth callback, cookie
   path and the PWA manifest's `start_url` and `scope`.
3. **It contradicts the pitch.** The claim is six systems with six front doors
   and one identity. `servicesuitecloud.com/connectedsuite/desk` is one
   application with folders, and the room will read it that way.

### The records to add

Six CNAMEs at your DNS host (cloudoon). The apex `A` record stays exactly as it
is.

| Subdomain | Type | Value | System |
|---|---|---|---|
| `lms` | CNAME | `cname.vercel-dns.com` | Lending Console |
| `microeazy` | CNAME | `cname.vercel-dns.com` | Customer Portal |
| `analytics` | CNAME | `cname.vercel-dns.com` | Analytics Studio |
| `peoplehub` | CNAME | `cname.vercel-dns.com` | PeopleHub HR |
| `ledgerly` | CNAME | `cname.vercel-dns.com` | Ledgerly Accounting |
| `connectdesk` | CNAME | `cname.vercel-dns.com` | ConnectDesk Call-Center |

Then add each of the six as a domain on the Vercel project. Vercel issues the TLS
certificates automatically once the CNAME resolves. Confirm the exact CNAME
target in the Vercel dashboard — it tells you per domain, and it is occasionally
a different value.

Each bare host serves its own system: `connectdesk.servicesuitecloud.com` lands
directly on the collections floor, not on a launcher. That routing lives in
`src/proxy.ts`, driven by one table in `src/lib/suite/labels.ts`.

### One caveat worth deciding deliberately

`SUITE_COOKIE_DOMAIN=".servicesuitecloud.com"` is what makes one sign-in valid
across all six doors. It also means the staff session cookie is sent to **the
apex and every other subdomain on that parent** — including the IIS box and any
future project there. The cookie is `httpOnly`, and all of that is your own
infrastructure, so this is acceptable for the demo.

For production, the clean fix is to move the suite one level down —
`lms.suite.servicesuitecloud.com`, cookie domain `.suite.servicesuitecloud.com` —
so the session is never transmitted to a sibling project. That is a one-line
change to `SUITE_DOMAIN` in `src/lib/suite/labels.ts` plus the DNS records. Say
the word and I will switch it.

---

## 3 · Your side — Vercel environment

Set these on the Vercel project (Production scope), then redeploy.

```
# The relay — this is what removes the amber banner.
# NOT the placeholder below: the actual URL `tailscale funnel` printed.
SERVICESUITE_RELAY_URL       = https://<paste the real ts.net host here>
SERVICESUITE_RELAY_SECRET    = <the same value as .env locally>

# Public identity
PUBLIC_BASE_URL              = https://lms.servicesuitecloud.com
NEXTAUTH_URL                 = https://lms.servicesuitecloud.com
SUITE_COOKIE_DOMAIN          = servicesuitecloud.com

# The six front doors
SUITE_LMS_ORIGIN             = https://lms.servicesuitecloud.com
SUITE_PORTAL_ORIGIN          = https://microeazy.servicesuitecloud.com
SUITE_ANALYTICS_ORIGIN       = https://analytics.servicesuitecloud.com
SUITE_HR_ORIGIN              = https://peoplehub.servicesuitecloud.com
SUITE_ACCOUNTING_ORIGIN      = https://ledgerly.servicesuitecloud.com
SUITE_CALLCENTER_ORIGIN      = https://connectdesk.servicesuitecloud.com
```

Everything already in `.env` that is not a Micromart SQL connection string —
`DATABASE_URL`, `NEXTAUTH_SECRET`, `VAULT_MASTER_KEY`, the Metropol keys, SMTP,
Supabase — must also be present. `NEXTAUTH_SECRET` in particular must be
identical, or sessions issued on one door will not verify on the next.

**Do not set `SERVICESUITE_CONN_MICROMART` on Vercel.** It cannot work from
there, and leaving it out is what keeps Micromart's password off the internet.

Then, from anywhere:

```bash
npm run test:relay      # proves the relay itself answers and can read Micromart
npm run test:live       # proves the DEPLOYED suite does — every host, every screen
```

`test:live` is the one to run before the room fills. It signs in over the public
internet the way a supervisor will, carries the session across all six
subdomains, and grades each screen **live / degraded / broken** by reading the
markup — because every screen in this suite degrades honestly, so a page whose
database is unreachable still returns 200. It also proves single sign-on works
across origins, which nothing else checks.

---

## 4 · Your side — the six artworks

**Where the prompts live:** `src/lib/suite/artwork.ts`, next to the code that
renders them. Print them in a paste-ready form with:

```bash
npm run art:prompts
```

**All six are delivered** (20 Aug 2026) and every one of them honours the rule
that mattered most: the left third is near-empty and dark, so the sign-in card
is readable on all six doors. Composition and accent are right across the set.

Two things were fixed on receipt, and one is left for you to decide.

**Fixed — the encode.** The plates arrived as ~1.5MB PNGs and the set totalled
**8.02MB**. PNG is the wrong container for a photograph, and these load before
anything else on a login page. Re-encoded to WebP the set is **230kB — 97%
smaller**, with nothing visible through the scrim the card sits on. The workflow
is now two steps, and the second is not optional:

```bash
npm run art:prompts               # generate, save the PNGs into public/images/suite/
npm run art:optimize              # report what the encode would do
npm run art:optimize -- --write   # encode
```

The PNGs stay on disk as masters; `artwork.ts` reads the `.webp`.

**Fixed — PeopleHub had no file.** Two plates arrived for that door,
`login-people-2.png` and `login-people.jpg`, and neither had the name the code
reads — so HR was the one door still rendering a gradient in production. The
clean `.jpg` is now the master for that slot; `scripts/optimize-suite-art.ts`
holds the mapping.

**Your decision — three of the six plates carry a "Made with AI" badge**, burned
into the top-right corner:

| Plate | Badge |
|---|---|
| `login-lending` | clean |
| `login-analytics` | clean |
| `login-people` (the `.jpg`) | clean |
| `login-portal` | **"Made with AI"** |
| `login-desk` | **"Made with AI"** |
| `login-books` | **"Made with AI"** |

It sits exactly where the eye lands after the sign-in card, and it will be on a
projector in front of senior managers. Three of the six came back clean from the
same tool, so **regenerating those three is the cleanest fix** — then re-run
`art:optimize -- --write` and nothing else changes. I can crop the badge out
instead if you would rather not regenerate; say which and it is a two-minute job.

One smaller note: `login-books` reads mostly brass/gold rather than the
green-teal `#0f766e` the brief asked for. The subject is exactly right and it is
a good image — it just sits slightly outside the one-hue-per-system rule. Worth a
regeneration only if you are redoing that one anyway.

---

## 5 · Your side — Safaricom and Metropol

### Ratiba / STK — `PUBLIC_BASE_URL`

You were right that this was the remaining gap. Daraja refuses a callback that is
not a public HTTPS address, and it was falling back to `NEXTAUTH_URL`
(`http://localhost:3000`).

Setting `PUBLIC_BASE_URL=https://lms.servicesuitecloud.com` on Vercel closes it.
The URLs then derive as:

```
https://lms.servicesuitecloud.com/api/mpesa/stk-callback/micromart?key=…
https://lms.servicesuitecloud.com/api/mpesa/ratiba-callback/micromart?key=…
```

Two things to check on the day, because they are outside our control:

1. **The callback host may need registering with Safaricom** for the production
   shortcode. Test credentials are usually permissive; production is not.
2. **The `?key=` query string.** Daraja has historically rejected callback URLs
   containing query parameters on some products. If Ratiba registration fails
   with an invalid-callback error, that is the first thing to suspect — the key
   can be moved into the path instead. Worth testing before the meeting rather
   than discovering it in front of the room.

### Metropol CRB

Unchanged and still blocked on their side: the production keys authenticate
correctly but are entitled for nothing (`E003`). That is Metropol's
provisioning, not our integration — `npm run test:crb:prod` demonstrates the
distinction cleanly if it comes up.

---

## 5b · Who sees what — the access model

**One door.** `/login` takes everybody. The server decides where they land:

| Credential | Session issued | Lands on |
|---|---|---|
| the PlatformAdmin row | platform | `/platform` — the estate, then "Enter console" into any org |
| any staff row | staff (+ daily code) | `/suite` — their own doors |

The "only my account" rule is the **PlatformAdmin table**, not a hard-coded
address. It holds exactly one row. That email is *also* Org Admin in six orgs, so
the platform check runs first — otherwise the founder would land inside a
lender's console with no audit record. `/platform/login` redirects here and stays
alive for bookmarks.

### Role, then the person

Rights are role-level and org-wide, which is the right default and the wrong
ceiling: two people can share "Collections Supervisor" and still need different
halves of ConnectDesk. Every staff member now carries an **access adjustment** on
top of their role, edited in `/console/team` → **Manage**:

- **Systems & modules** — a grid of the six systems and every module inside them.
  A ticked box is something that person *can see*. **All** / **None** per system.
- **Details** — name, work email, phone, date of birth, job title, role, branch.
  Previously an administrator could change five toggles and nothing else, so
  "she's changed her number" needed a developer.

It is stored as a **deny list**, which is why nothing changed for anybody when it
shipped: a module is visible unless it has been explicitly turned off, so a new
screen appears for everyone automatically instead of being invisible until
granted twenty times. A lender narrows deliberately.

Two properties worth saying in the room:

- **It lands without a sign-out.** Rights resolve from the database on every
  request behind a 30-second cache — never frozen into the session cookie.
  `npm run test:access` proves this by changing a live account and re-reading the
  page *on the same session*.
- **You cannot grant what you do not hold.** A per-person grant is checked
  against the actor's own rights, the same anti-escalation rule role assignment
  already enforces. Denying is unrestricted; granting is not.

Hiding a module is a tidiness decision, not a security boundary, and is not sold
as one — every route behind it still checks its own right server-side.

---

## 6 · One screen per person in the room

Seven people, seven doors. Each opens on their own department and each one is
reading the same live book, which is the point being made.

| Who | Opens | What is theirs about it |
|---|---|---|
| Collections supervisor | `connectdesk…/desk/queue` | Their seven queues, their commission bands, longest-untouched sort |
| Call-centre supervisor | `connectdesk…/desk/agents` | Their floor by name, ranked by cash, with the PBX seats |
| Operations | `lms…/console` | The book being worked — origination through disbursement |
| Data & Analytics | `analytics…` | Fifteen surfaces over the whole group, plus the Explorer |
| HR | `peoplehub…/people/officers` | **New.** Every officer, their book, and what came back against it |
| Accounting | `ledgerly…/books/journal` | **New.** 6.4M postings, both sides named, each linked to its loan |
| General Manager | `…/suite` then `/desk/pipeline` | Six systems on one page; the Fintech bridge as the close |

### The four screens added for this

PeopleHub and Ledgerly each declared two sidebar routes that did not exist — the
HR and Accounting supervisors would have clicked into a 404. All four are now
built, and each one is deliberately a *join*, not a report:

- **`/people/officers`** follows `Borrowers.EntityAgent` from the officer, to
  their borrowers, to those borrowers' open loans, to which of them the
  collections floor is tracking, to what it recovered. The default sort is book
  size; the sort that changes the conversation is **Weakest coverage**.
  > It reports, live, that **13 officers have a book on the collections floor and
  > took no payment at all in thirty days.** No system in the building can
  > currently produce that number, because it needs the roster, the ledger and
  > the floor in one query.

- **`/people/branches`** puts staff, book and arrears at every node of the org
  tree, with **book per officer** — and names the branches holding a book with no
  officer on the roster.

- **`/books/journal`** pages the real journal with an account filter, and every
  row's loan id links straight to that case on the collections floor. The window,
  the page and the filter are all in the URL, so a supervisor can send a
  colleague the exact view they are looking at.

- **`/books/flows`** puts disbursement and collection on one axis, day by day —
  read from **two different databases** that nobody has ever reconciled, because
  nothing has ever read both. That they track each other is the finding.

All four read live and were verified end to end against Micromart's server:
`getOfficers` 837ms, `getBranchTree` 322ms, `getJournalPage` 939ms, `getFlows`
350ms.

---

## 7 · Demo-day checklist

**The night before**

```bash
npm run relay            # on the always-on tailnet host, not a laptop
tailscale funnel 8787
npm run test:relay       # ALL CHECKS PASSED
```

**Thirty minutes before**

- Open each of the six subdomains once. The first render of each route compiles;
  after that everything is 1.5–4s.
- Confirm `SQL_RELAY_ALLOW_WRITES` is **unset** on the relay host. Say this out
  loud early in the meeting — it is a strength, not a caveat.
- Do it during working hours. The floor's numbers reset at midnight EAT.

**If the amber banner appears**

It now means one specific thing: the relay is not answering. Either the host is
asleep or off the tailnet, or the funnel dropped. `npm run test:relay` separates
the four cases by name.

**After**

```bash
npx tsx scripts/setup-desk-demo.ts --suspend
```

See `docs/DEMO-RUNBOOK.md` for the 20-minute path through the systems
themselves, and `docs/CONNECTED-SUITE-ARCHITECTURE.md` for what is on the wire.
