# Themes — the wallpapers the six systems stand on

Drop your own backgrounds here. Two files per theme, one per appearance mode:

```
public/themes/<id>/light.jpg
public/themes/<id>/dark.jpg
```

Then add one row to `CUSTOM_SKINS` in `src/lib/theme/skins.ts`:

```ts
{
  id: "harbour",
  name: "Harbour",
  blurb: "Cold morning water.",
  light: { image: "/themes/harbour/light.jpg", ground: "#f2f4f6", opacity: 0.50, wash: 0.16 },
  dark:  { image: "/themes/harbour/dark.jpg",  ground: "#0c1016", opacity: 0.30, wash: 0.30 },
}
```

It appears in every system's appearance menu on the next render. Nothing else
changes, and each system remembers its own choice separately — ConnectDesk can
be dressed one way and Ledgerly another.

---

## The brief

**A wallpaper is a floor, never a feature.** Nothing readable is ever laid on it
— every surface above it is a `.panel` or a `.canvas` with its own background —
so it is allowed to be a real photograph. What it is not allowed to be is loud
enough to compete with a figure sitting two layers above it.

| | light | dark |
|---|---|---|
| ground | near-white, `#f2f2f0`–`#f7f7f6` | near-black, `#0b0e14`–`#10131a` |
| opacity | 0.25–1.0 | 0.15–0.35 |
| wash | 0.14–0.22 | 0.26–0.34 |

`ground` is not a fallback colour. It is what the image is **composited onto** at
`opacity`, which is why one photograph can serve both themes: a dark skin is a
dark ground showing through a dimmed picture.

`wash` is how strongly the system's own accent bleeds in from the corners. The
accent comes from the system, not from the theme, so one theme gives six
differently-coloured floors without six files.

## Sizing

- **2000–2600px wide**, landscape. It is `background-size: cover` on a fixed
  layer, so it never scrolls and never tiles.
- **Under 400kB.** Prefer `.webp`. A branch machine in Mtwapa is loading this
  before anyone can do any work.
- **No hard edges through the middle.** A skin with a strong diagonal running
  under the canvas draws a line across the page that the canvas cannot hide.

## Checking one

Both themes, or it does not ship. Open any system, switch appearance with the
control at the top right, and look for the two failures this folder exists to
prevent:

1. a pale wallpaper still showing behind a dark page, and
2. type that landed on the artwork instead of on a surface.

A missing file is safe: the skin renders its `ground` and its accent wash, which
is a finished-looking floor rather than a broken one.
