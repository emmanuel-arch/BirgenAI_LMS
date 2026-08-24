# The login artworks

Three steps: generate a PNG, encode it, score it. The code reads the **`.webp`**
files; the PNGs beside them are the masters and nothing serves them.

```bash
npm run art:prompts             # print the prompts, and where each file goes
#   … generate, save the PNGs into this folder …
npm run art:optimize            # report what the encode would do, writes nothing
npm run art:optimize -- --write
npm run art:check               # score the result — non-zero exit on a failure
```

Until a `.webp` exists, that system's login page renders a gradient in the same
accent — so a partly-generated set never looks like a partly-finished product.
Add a file and it appears on the next render; delete it and the gradient comes
back. No rebuild, no code change.

| master (drop here) | served | system | accent |
|---|---|---|---|
| `login-lending.png` | `login-lending.webp` | Lending Console | `#2a78d6` |
| `login-portal.png` | `login-portal.webp` | Customer Portal | `#0e7490` |
| `login-analytics.png` | `login-analytics.webp` | Analytics Studio | `#7c3aed` |
| `login-desk.png` | `login-desk.webp` | ConnectDesk | `#be123c` |
| `login-people.png` | `login-people.webp` | PeopleHub HR | `#6d28d9` |
| `login-books.png` | `login-books.webp` | Ledgerly Accounting | `#0f766e` |

The Interchange has no plate here and does not need one: it is a separate
deployment and its own member gate is its door. See `src/lib/suite/apps.ts`.

---

## Current state — what to regenerate, and why

Scored 24 Aug 2026 with `npm run art:check`. Four pass, two fail.

| system | px | left third | chroma | hue vs accent | |
|---|---|---|---|---|---|
| lms | 1586×992 | 3.1% | 28.0% | 2° off | ok |
| portal | 1536×944 | 1.1% | 17.3% | 8° off | ok |
| analytics | 1586×992 | 1.0% | 26.2% | 7° off | ok |
| callcenter | 1536×944 | 1.0% | 7.1% | 20° off | ok — the weakest pass |
| **hr** | **1344×768** | 4.7% | **1.1%** | 12° off | **regenerate** |
| **accounting** | 1536×944 | 0.6% | 2.8% | **140° off** | **regenerate** |

### `login-people` — no colour, and the smallest file in the set

1.1% saturated pixels against 17–28% for the good plates. It renders as a black
rectangle with four flat violet bars pasted on, because the generator took *"most
dark, some glowing"* literally. It is also 1344px wide — the lowest resolution
here, upscaled on any normal desktop.

The prompt in `src/lib/suite/artwork.ts` has been rewritten for exactly that
failure: a third of the compartments lit rather than four, light spilling onto
the wood and pooling below, and an explicit instruction that it must **not** be a
near-black image with a few bright rectangles.

### `login-books` — a beautiful photograph of the wrong colour

Dominant hue 35° (gold) against Ledgerly's 175° (green-teal). A 140° miss, an
order of magnitude worse than anything else in the set.

One word caused it. *"Antique brass"* is a colour instruction as much as a
material one, and every generator weights it far above a rim-light qualifier
eleven words later. The rewritten prompt makes the scale blackened steel and
names brass, gold, bronze and copper as things to avoid.

This matters past taste. The accent is a **code** — the same teal Ledgerly wears
in its sidebar, its launcher tile and its header rule — and a gold front door
teaches the wrong one at the moment somebody is learning the suite.

### `login-desk` — passes, but it is the one to redo next

7.1% chroma (half the good plates) and 20° off toward pure red rather than
ConnectDesk's crimson-rose. Fine on its own; visibly thinner than lending and
analytics when the six are seen together.

---

## What else is missing — the shopping list

Beyond the two regenerations above, four assets would lift the whole estate.
None of them are login plates.

### 1. `public/images/white-background.png` at 2560×1600 — **highest value**

This is the single most-used image in the product: it is the canvas behind the
lending console, the platform board, the staff sign-in card, the borrower portal,
onboarding, `/verify`, `/myloan` and the demo — **and now behind all five
satellite systems too** (see `SuiteShell`). It is currently **740×465**.

On a 2560-wide monitor that is a 3.5× upscale. It survives because it is a soft
gradient with no hard edges, but it is soft where it should be crisp, and it is
the floor under everything.

> Prompt: *Abstract soft white and pale-grey flowing silk-like waves, extremely
> smooth gradients, no hard edges, no texture grain, very high key, subtle cool
> grey shadows in the troughs, seamless studio lighting, 2560×1600, landscape.
> No text, no logos, no objects.*

Save as `public/images/white-background.png`. Same filename — nine call sites
pick it up with no code change.

### 2. A dark counterpart — `public/images/dark-background.png`, 2560×1600

The suite launcher (`SuiteBoard`) builds its dark field out of seven CSS blur
circles. It works, and it costs a lot of compositing on a mid-range laptop. One
plate would be cheaper and richer.

> Prompt: *Abstract near-black flowing waves, deep charcoal (#0b0a10) with very
> faint cool highlights in the crests, extremely smooth gradients, no hard edges,
> cinematic, 2560×1600, landscape. No text, no logos, no objects.*

### 3. The Interchange needs its own set — `interchange/apps/interchange-console/public/`

That repo's `public/` still holds the Next.js starter SVGs (`next.svg`,
`vercel.svg`, `window.svg`) and nothing else. It needs:

- `og.png` — 1200×630 social card. Every link anyone shares of it is currently blank.
- `icon-512.png` / `apple-touch-icon.png` — it has only the default `favicon.ico`.
- Optionally `gate-bg.webp` — though the member gate's aurora is now CSS, and
  that is the better answer: nothing to load, nothing to keep in sync.

### 4. Open-graph cards for the suite — `public/og/`

`og-suite.png`, `og-lending.png`, `og-analytics.png`, … 1200×630 each, in the
system's accent. Every WhatsApp and Slack link to any of these systems currently
previews as nothing at all, which is the cheapest credibility to buy back.

The login plates crop to this ratio well — take the right two thirds of each
existing `.png` master and set the system's name over it.

---

## Two things to check on a new plate

- **The left third must stay near-empty and dark.** That is where the sign-in
  card sits. A beautiful image with its subject on the left is an unreadable
  login page. `art:check` measures this; the eye cannot, because the eye is
  looking at the plate rather than at the card on top of it.
- **No burned-in watermark.** Some generators stamp a "Made with AI" badge into
  the top-right corner, which is exactly where the eye lands after the card.
  Three of the six arrived with one. `scripts/optimize-suite-art.ts` detects and
  crops it, but regenerating is better than cropping where you can.

## Why the encode step is not optional

The generator returns ~1.5MB PNGs. PNG is the wrong container for a photograph —
it is lossless, so it pays full price for film grain nobody can see — and **these
load before anything else on a login page.** The set as generated was 8.02MB;
encoded it is 230kB, with no difference visible through the scrim the sign-in
card sits on. Nine megabytes of door art on conference wi-fi, in front of a room,
is a visible stagger every time somebody opens a system.

`scripts/optimize-suite-art.ts` holds the source→target mapping. If a plate is
regenerated under a different filename, change it there rather than renaming
files to match.

The prompts live in `src/lib/suite/artwork.ts`, next to the code that renders
them, so the paths here and the paths the app reads cannot drift apart.
