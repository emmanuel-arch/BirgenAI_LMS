"use client";

// ─────────────────────────────────────────────────────────────────────────────
// THE GOVERNMENT REGISTRY EMBLEM.
//
// The hero mark on every surface where an identity is settled against the national
// registry (IPRS) — the New Borrower counter, the KYC verification centre.
//
// It is drawn, not iconed, on purpose. A 24px lucide glyph blown up to 96px is a
// thin, lonely stroke; what belongs at the top of a screen that is about to check a
// human being against their government's own record is an EMBLEM — a seal, with
// weight. Concentric brand rings, a document with the person on it, and a check
// that lands last.
//
// The rings breathe (a slow, 4s pulse) while `state === "idle"`, sweep while
// "checking", and settle to a solid seal on "matched". The motion is the honest
// signal that something is actually happening across a wire to a registry, and it
// stops the moment there is an answer.
// ─────────────────────────────────────────────────────────────────────────────

export type EmblemState = "idle" | "checking" | "matched" | "failed";

export function RegistryEmblem({
  state = "idle",
  size = 96,
  className = "",
}: {
  state?: EmblemState;
  size?: number;
  className?: string;
}) {
  const brand = "var(--brand)";
  const tone = state === "failed" ? "#e11d48" : state === "matched" ? "#059669" : brand;

  return (
    <div className={`relative inline-flex items-center justify-center ${className}`} style={{ width: size, height: size }}>
      {/* The rings — the seal. */}
      <svg viewBox="0 0 96 96" width={size} height={size} className="absolute inset-0" aria-hidden>
        <defs>
          <linearGradient id="re-fill" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={tone} stopOpacity="0.18" />
            <stop offset="100%" stopColor={tone} stopOpacity="0.04" />
          </linearGradient>
        </defs>

        <circle cx="48" cy="48" r="46" fill="url(#re-fill)" />
        <circle
          cx="48" cy="48" r="46" fill="none" stroke={tone} strokeOpacity="0.18" strokeWidth="1.5"
          className={state === "idle" ? "re-breathe" : ""}
        />
        <circle cx="48" cy="48" r="38" fill="none" stroke={tone} strokeOpacity="0.28" strokeWidth="1.5" />

        {/* The sweep: a dashed arc that only turns while a registry is actually being asked. */}
        {state === "checking" && (
          <circle
            cx="48" cy="48" r="42" fill="none" stroke={tone} strokeWidth="2.5" strokeLinecap="round"
            strokeDasharray="30 234" className="re-sweep" style={{ transformOrigin: "48px 48px" }}
          />
        )}
        {state === "matched" && (
          <circle cx="48" cy="48" r="42" fill="none" stroke={tone} strokeWidth="2.5" strokeOpacity="0.85" />
        )}
      </svg>

      {/* The document, and the person on it. */}
      <svg viewBox="0 0 48 48" width={size * 0.5} height={size * 0.5} className="relative" aria-hidden>
        <rect x="7" y="9" width="34" height="27" rx="3.5" fill="none" stroke={tone} strokeWidth="2.2" />
        {/* the portrait panel */}
        <circle cx="17.5" cy="19.5" r="4" fill="none" stroke={tone} strokeWidth="1.9" />
        <path d="M11 29.5c0-3.4 2.9-5.5 6.5-5.5s6.5 2.1 6.5 5.5" fill="none" stroke={tone} strokeWidth="1.9" strokeLinecap="round" />
        {/* the record beside it */}
        <line x1="29" y1="17" x2="36" y2="17" stroke={tone} strokeWidth="1.9" strokeLinecap="round" strokeOpacity="0.75" />
        <line x1="29" y1="22" x2="36" y2="22" stroke={tone} strokeWidth="1.9" strokeLinecap="round" strokeOpacity="0.5" />
        <line x1="29" y1="27" x2="33.5" y2="27" stroke={tone} strokeWidth="1.9" strokeLinecap="round" strokeOpacity="0.35" />
      </svg>

      {/* The verdict, bottom-right — the thing that lands last. */}
      {(state === "matched" || state === "failed") && (
        <span
          className="re-pop absolute bottom-0 right-0 flex items-center justify-center rounded-full border-[3px] border-white shadow-sm"
          style={{ width: size * 0.3, height: size * 0.3, backgroundColor: tone }}
        >
          <svg viewBox="0 0 24 24" width={size * 0.18} height={size * 0.18} fill="none" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
            {state === "matched" ? <polyline points="4 12.5 9.5 18 20 6.5" /> : <><line x1="6" y1="6" x2="18" y2="18" /><line x1="18" y1="6" x2="6" y2="18" /></>}
          </svg>
        </span>
      )}

      <style jsx>{`
        .re-sweep { animation: re-spin 1.05s linear infinite; }
        @keyframes re-spin { to { transform: rotate(360deg); } }
        .re-breathe { animation: re-breathe 4s ease-in-out infinite; transform-origin: 48px 48px; }
        @keyframes re-breathe {
          0%, 100% { transform: scale(1); opacity: 0.18; }
          50%      { transform: scale(1.035); opacity: 0.4; }
        }
        .re-pop { animation: re-pop 0.34s cubic-bezier(0.34, 1.56, 0.64, 1); }
        @keyframes re-pop { from { transform: scale(0.3); opacity: 0; } to { transform: scale(1); opacity: 1; } }
        @media (prefers-reduced-motion: reduce) {
          .re-sweep, .re-breathe, .re-pop { animation: none; }
        }
      `}</style>
    </div>
  );
}
