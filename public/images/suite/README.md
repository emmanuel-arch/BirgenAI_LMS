# The six login artworks

Two steps: generate a PNG, then encode it. The code reads the **`.webp`** files;
the PNGs beside them are the masters and nothing serves them.

```bash
npm run art:prompts      # print the six prompts, and where each file goes
#   … generate, save the PNGs into this folder …
npm run art:optimize     # report what the encode would do, writes nothing
npm run art:optimize -- --write
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

## Why the encode step is not optional

The generator returns ~1.5MB PNGs. PNG is the wrong container for a photograph —
it is lossless, so it pays full price for film grain nobody can see — and **these
six load before anything else on a login page.** The set as generated was 8.02MB;
encoded it is 230kB, with no difference visible through the scrim the sign-in
card sits on. Nine megabytes of door art on conference wi-fi, in front of a room,
is a visible stagger every time somebody opens a system.

`scripts/optimize-suite-art.ts` holds the source→target mapping. If a plate is
regenerated under a different filename, change it there rather than renaming
files to match.

## Two things to check on a new plate

- **The left third must stay near-empty and dark.** That is where the sign-in
  card sits. A beautiful image with its subject on the left is an unreadable
  login page.
- **No burned-in watermark.** Some generators stamp a "Made with AI" badge into
  the top-right corner, which is exactly where the eye lands after the card.
  Three of the six arrived with one. Regenerate rather than crop where you
  can — the other three came back clean from the same tool.

The prompts live in `src/lib/suite/artwork.ts`, next to the code that renders
them, so the paths here and the paths the app reads cannot drift apart.
