"use client";

// ─────────────────────────────────────────────────────────────────────────────
// The door's atmosphere.
//
// Founder's brief: "let there be something on the background, but it should not
// carry so much attention." So this is deliberately quiet — three layers that
// move at different speeds and never resolve into a thing you look AT:
//
//   1. RAYS      — long, near-black diagonal strokes sweeping left → right at
//                  2–4% opacity. The motion you sense rather than see.
//   2. AURORA    — two enormous, slow brand-tinted blooms breathing in place, so
//                  the white artwork behind the card picks up the lender's colour.
//   3. GRAIN     — a static SVG fractal noise at 3%, which is what stops a flat
//                  gradient from banding on a projector at a demo.
//
// All CSS/SVG, no canvas, no rAF loop: it costs nothing on a mid-range Android
// and it keeps painting while React is busy authenticating. Every animation is
// disabled under `prefers-reduced-motion` by the stylesheet, not by a prop.
// ─────────────────────────────────────────────────────────────────────────────

export default function AuthAmbient({ accent, accent2 }: { accent: string; accent2?: string }) {
  const a2 = accent2 || accent;
  // Staggered so the rays never form a marching band — irregular gaps read as
  // atmosphere, an even cadence reads as a loading bar.
  const rays = [
    { top: "12%", delay: "0s", dur: "19s", w: "38vw", o: 0.05 },
    { top: "27%", delay: "-6s", dur: "26s", w: "52vw", o: 0.035 },
    { top: "44%", delay: "-13s", dur: "22s", w: "30vw", o: 0.055 },
    { top: "61%", delay: "-3s", dur: "31s", w: "46vw", o: 0.03 },
    { top: "78%", delay: "-17s", dur: "24s", w: "36vw", o: 0.045 },
    { top: "90%", delay: "-9s", dur: "29s", w: "44vw", o: 0.03 },
  ];

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
      {/* The lender's colour, enormous and slow, so the white artwork is never neutral */}
      <div
        className="auth-bloom absolute -left-[20vw] -top-[25vh] h-[85vh] w-[85vw] rounded-full blur-[120px]"
        style={{ background: accent, opacity: 0.12 }}
      />
      <div
        className="auth-bloom auth-bloom-b absolute -bottom-[30vh] -right-[15vw] h-[80vh] w-[75vw] rounded-full blur-[130px]"
        style={{ background: a2, opacity: 0.1 }}
      />

      {/* Black rays, left → right */}
      {rays.map((r, i) => (
        <span
          key={i}
          className="auth-ray absolute h-px"
          style={{
            top: r.top,
            width: r.w,
            animationDuration: r.dur,
            animationDelay: r.delay,
            background: `linear-gradient(90deg, transparent, rgba(9,9,11,${r.o * 6}) 45%, rgba(9,9,11,${r.o * 9}) 55%, transparent)`,
          }}
        />
      ))}

      {/* Grain — kills banding on a projector */}
      <div
        className="absolute inset-0 opacity-[0.035] mix-blend-multiply"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3'/%3E%3C/filter%3E%3Crect width='160' height='160' filter='url(%23n)'/%3E%3C/svg%3E\")",
        }}
      />

      {/* A hairline of the lender's gradient along the very bottom of the viewport —
          the same seam the card wears, so the page and the card feel cut from one cloth. */}
      <div className="absolute inset-x-0 bottom-0 h-px" style={{ background: `linear-gradient(90deg, transparent, ${accent}, ${a2}, transparent)`, opacity: 0.5 }} />
    </div>
  );
}
