"use client";

// ─────────────────────────────────────────────────────────────────────────────
// HOW THE CUSTOMER GETS THE STATEMENT — the seven USSD steps, and the film.
//
// The cruncher is only as good as the file it is handed, and the single most
// common reason a crunch never happens is that nobody could talk the customer
// through *334#. That instruction used to be one grey sentence above the upload
// box; an officer on a call cannot read a sentence to somebody at the speed the
// customer types. So it is a rail of seven steps, each one a keypress, plus the
// film that shows the same journey on a real handset.
//
// ── WHY THE VIDEO IS A FACADE, NOT AN IFRAME ────────────────────────────────
// A YouTube iframe is ~1.2 MB of third-party JavaScript and a cookie write, paid
// on every page load whether or not anyone presses play — on a console page whose
// job is to upload a PDF. So the default state is a POSTER: YouTube's own
// thumbnail plus our play control, costing one image. The iframe is mounted on
// the first click and autoplays, which is also the moment the person has actually
// asked for a third-party frame.
//
// youtube-nocookie.com is the privacy-preserving host: no tracking cookie is
// written until playback begins. rel=0 keeps the end-screen recommendations
// inside this channel, so a training video does not end by offering an officer
// somebody else's content on a lender's console.
//
// Nothing here leaves the page — no target="_blank", no redirect to youtube.com.
// ─────────────────────────────────────────────────────────────────────────────
import { useState } from "react";
import { Play, Phone, HelpCircle, ChevronDown } from "lucide-react";

/** The Safaricom self-service path to a 6-month statement. Exported because the
 *  borrower app shows the same seven steps and they must not drift apart. */
export const USSD_STEPS: { key: string; label: string; detail?: string }[] = [
  { key: "*334#", label: "Dial the M-PESA menu" },
  { key: "7", label: "My Account" },
  { key: "3", label: "M-PESA Statement" },
  { key: "1", label: "Request Statement" },
  { key: "1", label: "Full Statement" },
  { key: "4", label: "Last 6 months", detail: "Six months is what the model scores. A shorter window is refused." },
  { key: "OK", label: "Email address, re-enter it, then M-PESA PIN", detail: "Safaricom SMSes the password that opens the PDF." },
];

const VIDEO_ID = "Q2Dc03GKGnM";

export function StatementHowTo({ defaultOpen = false }: { defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const [playing, setPlaying] = useState(false);

  return (
    <section className="glass overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-5 py-4 text-left"
      >
        <span
          className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-white"
          style={{ backgroundColor: "var(--brand)" }}
        >
          <Phone className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">How the customer gets their statement</span>
          <span className="block text-[11px] text-ash-500">
            Free on *334# — seven steps, about ninety seconds. Watch it, or read it out.
          </span>
        </span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-ash-400 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div className="grid gap-5 border-t border-ash-900/10 px-5 py-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] lg:gap-6">
          {/* ── The rail. Each step is one keypress, so the keypress IS the bullet. ── */}
          <ol className="relative space-y-0">
            {USSD_STEPS.map((s, i) => (
              <li key={i} className="relative flex gap-3 pb-4 last:pb-0">
                {/* the thread joining one keypress to the next */}
                {i < USSD_STEPS.length - 1 && (
                  <span className="absolute left-[17px] top-9 bottom-0 w-px bg-ash-900/10" aria-hidden />
                )}
                <span
                  className="z-10 grid h-9 min-w-[2.25rem] shrink-0 place-items-center rounded-lg border border-ash-900/15 bg-paper px-1.5 font-mono text-[13px] font-semibold tabular-nums shadow-sm"
                  style={{ color: "var(--brand)" }}
                >
                  {s.key}
                </span>
                <span className="min-w-0 pt-1">
                  <span className="block text-sm font-medium leading-snug">{s.label}</span>
                  {s.detail && <span className="mt-0.5 block text-[11px] leading-snug text-ash-500">{s.detail}</span>}
                </span>
              </li>
            ))}
          </ol>

          {/* ── The film. A poster until somebody asks for it. ── */}
          <div>
            <div className="relative aspect-video overflow-hidden rounded-xl border border-ash-900/15 bg-black shadow-sm">
              {playing ? (
                <iframe
                  className="absolute inset-0 h-full w-full"
                  src={`https://www.youtube-nocookie.com/embed/${VIDEO_ID}?autoplay=1&rel=0&modestbranding=1&playsinline=1`}
                  title="How to request a 6-month M-PESA statement"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  referrerPolicy="strict-origin-when-cross-origin"
                  allowFullScreen
                />
              ) : (
                <button
                  type="button"
                  onClick={() => setPlaying(true)}
                  className="group absolute inset-0 h-full w-full"
                  aria-label="Play: how to request a 6-month M-PESA statement"
                >
                  {/* YouTube's own poster. hqdefault always exists; maxres does not. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`https://i.ytimg.com/vi/${VIDEO_ID}/hqdefault.jpg`}
                    alt=""
                    className="h-full w-full object-cover opacity-85 transition duration-300 group-hover:scale-[1.03] group-hover:opacity-100"
                  />
                  <span className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />
                  <span className="absolute inset-0 grid place-items-center">
                    <span className="grid h-14 w-14 place-items-center rounded-full bg-paper/95 shadow-lg transition group-hover:scale-110">
                      <Play className="h-6 w-6 translate-x-[2px] fill-current" style={{ color: "var(--brand)" }} />
                    </span>
                  </span>
                  <span className="absolute inset-x-0 bottom-0 p-3 text-left">
                    <span className="block text-[13px] font-semibold text-white">
                      Requesting a 6-month M-PESA statement
                    </span>
                    <span className="block text-[11px] text-white/70">Plays here — nobody leaves the console.</span>
                  </span>
                </button>
              )}
            </div>
            <p className="mt-2.5 flex items-start gap-1.5 text-[11px] leading-snug text-ash-500">
              <HelpCircle className="mt-px h-3.5 w-3.5 shrink-0 text-emerald-600" />
              Safaricom emails a password-protected PDF. The password is the access code in that SMS — or, on older
              statements, the customer&apos;s ID number. Either one goes in the password box below.
            </p>
          </div>
        </div>
      )}
    </section>
  );
}

export default StatementHowTo;
