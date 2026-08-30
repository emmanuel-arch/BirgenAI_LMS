"use client";

// ─────────────────────────────────────────────────────────────────────────────
// THE THEME SWITCH — one control, four systems.
//
// It is deliberately the SAME OBJECT as the realm switch at the other end of the
// header: `panel` shell, h-10, rounded-2xl, p-1, a thumb moved by transform. Two
// controls that behave differently while looking similar is worse than two that
// look different, and the pair reads as a set — WHERE you are on the left, HOW
// it looks on the right.
//
// What it borrows from the two component packages, and what it does not:
//
//   · From the liquid-metal button: the thumb is MACHINED, not filled. A rim
//     gradient, an inset face, a hairline along the top edge, and a specular
//     highlight that tracks the pointer across the whole control. That is the
//     entire reason it reads as an object rather than a coloured rectangle.
//   · From the glow menu: a radial wash sits under the active icon, tinted per
//     state — warm for light, cool for dark, neutral for auto — so the control
//     says which mode it is in with colour as well as position.
//
// What is dropped: the 3-D card flip. It was keyed to hover, and this control is
// 104px wide in a header that also has to work on a tablet.
//
// ── THREE SEGMENTS, NOT TWO ──────────────────────────────────────────────────
// A boolean toggle cannot express "follow the machine", and that is the state
// most people are actually in before they touch it — so a two-way switch has to
// LIE about the starting position, and once pressed there is no way back. Auto
// is a real state and it gets a real segment.
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useRef, useState } from "react";
import { Sun, Moon, MonitorSmartphone } from "lucide-react";
import { useTheme, type ThemeChoice } from "@/lib/theme/useTheme";

const OPTIONS: { id: ThemeChoice; label: string; title: string; icon: typeof Sun; wash: string }[] = [
  {
    id: "light",
    label: "Light",
    title: "Light",
    icon: Sun,
    wash: "radial-gradient(circle, rgba(251,191,36,0.55) 0%, rgba(245,158,11,0.18) 55%, transparent 75%)",
  },
  {
    id: "dark",
    label: "Dark",
    title: "Dark",
    icon: Moon,
    wash: "radial-gradient(circle, rgba(99,102,241,0.55) 0%, rgba(79,70,229,0.18) 55%, transparent 75%)",
  },
  {
    id: "system",
    label: "Auto",
    title: "Match this device",
    icon: MonitorSmartphone,
    wash: "radial-gradient(circle, rgba(148,163,184,0.5) 0%, rgba(100,116,139,0.16) 55%, transparent 75%)",
  },
];

export default function ThemeSwitch() {
  const { choice, setChoice } = useTheme();
  const ref = useRef<HTMLDivElement>(null);
  const [spec, setSpec] = useState<{ x: number; y: number } | null>(null);

  // Pointer, not mouse: the console is used on tablets in branches, and the
  // reference component's `onMouseMove` simply never fires there.
  const track = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setSpec({ x: e.clientX - r.left, y: e.clientY - r.top });
  }, []);

  const index = Math.max(0, OPTIONS.findIndex((o) => o.id === choice));
  const active = OPTIONS[index] ?? OPTIONS[0];

  return (
    <div
      ref={ref}
      role="group"
      aria-label="Appearance"
      onPointerMove={track}
      onPointerLeave={() => setSpec(null)}
      className="panel relative inline-flex h-10 items-center overflow-hidden rounded-2xl p-1"
    >
      {/* The wash. Under the thumb, tinted by state. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-1 transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
        style={{
          width: `calc((100% - 0.5rem) / ${OPTIONS.length})`,
          transform: `translateX(calc(${index} * 100%)) scale(1.9)`,
          background: active.wash,
        }}
      />

      {/* The thumb — machined, not filled. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-1 left-1 overflow-hidden rounded-xl transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
        style={{
          width: `calc((100% - 0.5rem) / ${OPTIONS.length})`,
          transform: `translateX(calc(${index} * 100%))`,
          background: "linear-gradient(180deg, var(--metal-rim-a), var(--metal-rim-b))",
          boxShadow: "0 1px 2px rgb(0 0 0 / 0.22), inset 0 -1px 2px rgb(0 0 0 / 0.16)",
        }}
      >
        <span
          className="absolute inset-[1.5px] rounded-[10px]"
          style={{
            background: "linear-gradient(180deg, var(--metal-face-a), var(--metal-face-b))",
            boxShadow: "inset 0 1px 0 rgb(255 255 255 / 0.55)",
          }}
        />
        {/* The hairline. One pixel, and the cheapest thing here. */}
        <span
          className="absolute inset-x-2 top-0 h-px rounded-full"
          style={{ background: "linear-gradient(90deg, transparent, rgb(255 255 255 / 0.8), transparent)" }}
        />
      </span>

      {/* The specular, tracked across the WHOLE control rather than the thumb, so
          it sweeps as the pointer crosses and the thumb catches it in passing. */}
      {spec && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-2xl"
          style={{
            background: `radial-gradient(70px circle at ${spec.x}px ${spec.y}px, rgb(255 255 255 / 0.85) 0%, rgb(255 255 255 / 0.25) 40%, transparent 70%)`,
            mixBlendMode: "soft-light",
          }}
        />
      )}

      {OPTIONS.map((o) => {
        const on = o.id === choice;
        return (
          <button
            key={o.id}
            type="button"
            onClick={() => setChoice(o.id)}
            aria-pressed={on}
            title={o.title}
            className={`relative z-10 flex h-8 w-8 items-center justify-center rounded-xl transition-colors duration-300 ${
              on ? "text-[color:var(--ink)]" : "text-[color:var(--ink-faint)] hover:text-[color:var(--ink-muted)]"
            }`}
          >
            <o.icon className="h-[15px] w-[15px]" strokeWidth={on ? 2.4 : 1.9} />
            <span className="sr-only">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}
