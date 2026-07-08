# Per-lender portal assets

Drop each lender's branding here. The lms borrower portal
(`lms.birgenai.com`, `micromart.birgenai.com`, `axe.birgenai.com`) reads these
paths from `src/lib/lms/branding.ts`.

```
public/lenders/
  micromart/
    logo.png    # square, transparent background, ~512×512
    hero.jpg    # wide banner, ~1600×900 (optional — shown faint behind the header)
  axe/
    logo.png
    hero.jpg
  buysimu/
    logo.png    # ← DUMP THE BUY SIMU LOGO HERE (square, transparent ~512×512)
    hero.jpg    # optional wide banner (e.g. phones / iPhone hero)
```

If a `logo.png` is missing, Micromart/Axe fall back automatically to the existing
`public/images/MicromartLogo.png` / `public/images/AxeLogo.png`. **Buy Simu has no
fallback asset yet** — until you add `public/lenders/buysimu/logo.png`, its logo
slot stays blank (no error). If a `hero.jpg` is missing, the header simply shows no
background image.

## Brand colours (confirm with each lender)

Accent colours live in `src/lib/lms/branding.ts`:

| Lender    | Accent                |
|-----------|-----------------------|
| Micromart | `#F97316` (orange) — placeholder |
| Axe       | `#3B82F6` (blue) — placeholder    |
| Buy Simu  | `#E11D48` (red) — per founder direction (DB stores black; we override to red) |

Replace `accent` (and the matching `accentSoft` rgba) with each lender's real
brand hex once confirmed.
