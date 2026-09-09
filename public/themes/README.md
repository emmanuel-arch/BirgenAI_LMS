# Themes — the wallpapers the seven systems stand on

Drop your own background here, encode it, and add one row.

```bash
cp ~/Downloads/harbour.jpg public/themes/harbour.jpg
npm run media          # resizes, converts to WebP, holds it under 300 KB,
                       # generates harbour-thumb.webp and its blur placeholder
```

Then add one row to `BUILT_IN_SKINS` (or `CUSTOM_SKINS`) in `src/lib/theme/skins.ts`:

```ts
{ id: "harbour", name: "Harbour", blurb: "Cold morning water.", ...photo("harbour") }
```

It appears in every system's appearance menu on the next render. Nothing else
changes, and each system remembers its own choice separately — ConnectDesk can
be dressed one way and Ledgerly another.

---

## One file, both themes

**This folder holds ONE image per skin, not a light and a dark pair.** That is
not a shortcut; it is the design.

`ground` is the flat colour the picture is **composited onto**, at `opacity`. A
light skin is a near-white ground with a third of a photograph over it. A dark
skin is the same photograph, at a fifth, over near-black. So one file gives both
faces, and there is no way for a pair to drift apart — which is exactly how the
suite once ended up painting a photograph of pale grey waves behind its dark
theme.

`photo()` and `texture()` in `skins.ts` are the two presets. Use `photo()` for
anything with a subject and `texture()` for anything without one; a texture has
nothing competing with a figure two layers above it, so it can carry three times
the strength.

## The brief

**A wallpaper is a floor, never a feature.** Nothing readable is ever laid on it
— every surface above it is a `.panel` or a `.canvas` with its own background —
so it is allowed to be a real photograph. What it is not allowed to be is loud
enough to compete with a figure sitting two layers above it.

| | light | dark |
|---|---|---|
| ground | near-white, `#f2f2f0`–`#f7f7f6` | near-black, `#0b0e14`–`#10131a` |
| opacity | 0.25–0.8 | 0.15–0.36 |
| wash | 0.14–0.22 | 0.26–0.34 |

`wash` is how strongly the system's own accent bleeds in from the corners. The
accent comes from the system, not the theme, so one theme gives seven
differently-coloured floors without seven files.

## Sizing — enforced, not requested

`npm run media` is the rule; this section is only what it does and why.

- **2560×1600**, landscape, WebP. It is `background-size: cover` on a fixed
  layer, so it never scrolls and never tiles.
- **Under 300 KB.** The encoder solves for that: it steps quality down first,
  then resolution, and only blurs as a last resort for pictures that are
  high-frequency noise edge to edge. `npm run media:check` fails if anything is
  over.
- **A `-thumb.webp` at 480×300** for the appearance menu, which renders every
  skin at once. Without it, opening that menu pulls the whole folder.
- **No hard edges through the middle.** A skin with a strong diagonal running
  under the canvas draws a line across the page that the canvas cannot hide.

Drop the original in at whatever size it arrived; the pipeline is what makes it
shippable, and `npm run media:archive` then moves the original out of `public/`
so it is never served.

## Checking one

Both themes, or it does not ship. Open any system, switch appearance with the
control at the top right, and look for the two failures this folder exists to
prevent:

1. a pale wallpaper still showing behind a dark page, and
2. type that landed on the artwork instead of on a surface.

A missing file is safe: the skin renders its `ground` and its accent wash, which
is a finished-looking floor rather than a broken one.
