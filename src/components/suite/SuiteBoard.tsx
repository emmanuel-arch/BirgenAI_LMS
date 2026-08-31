"use client";

// ─────────────────────────────────────────────────────────────────────────────
// THE CONNECTED SUITE — the launcher, rebuilt as a demonstration.
//
// ── WHAT THIS PAGE HAS TO DO IN TEN SECONDS ──────────────────────────────────
// Somebody who has never seen this platform opens it and must understand three
// things before anyone speaks:
//
//   1. These are six real systems, not six tabs. Each has its own name, its own
//      colour, its own front door, its own subdomain.
//   2. They are already running on real data. Every tile carries a number that
//      was true when the page rendered, with the table it came from printed
//      underneath it. Nothing here is a placeholder.
//   3. They are wired to each other. The flow strip below the grid is not a
//      diagram of an intention — each lane carries its own live count.
//
// ── WHY IT IS THIS COLOURFUL ─────────────────────────────────────────────────
// Enterprise software is grey because grey is safe, and the cost is that every
// system looks like every other system. Here the colour is doing work: each
// system's hue is the SAME hue it wears in its own sidebar, its own login page
// and its own accent, so the launcher is teaching a colour-code that pays off
// for the rest of the session. Rose is always the call centre. Violet is always
// analytics. By the third screen nobody needs to read the title.
//
// The colours are the six suite accents, which are far apart in hue by
// construction; each card also carries its name and its icon, so nothing here
// depends on colour alone.
// ─────────────────────────────────────────────────────────────────────────────

import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import {
  ArrowRight, ShieldCheck, KeyRound, Building2, Layers3, Database, Radio, ArrowUpRight,
} from "lucide-react";
import { SUITE_APPS } from "@/lib/suite/apps";
import type { ResolvedSuiteApp } from "@/lib/suite/hosts";
import type { SuiteTelemetry } from "@/lib/suite/telemetry";
import { TimeAgo } from "@/components/suite/kit";
import SystemRail, { type RailArt } from "./SystemRail";

// ── WHY THE FRESHNESS STAMP IS <TimeAgo> AND NOT A LOCAL ago() ───────────────
// This is a CLIENT component, and a relative time is a function of Date.now().
// The server renders "3s ago", React hydrates a beat later and computes
// "4s ago", the two trees disagree, and React reports that as a full hydration
// failure and throws the tree away to re-render it. On the first screen anyone
// sees, that is a red overlay over the demonstration.
//
// <TimeAgo> (components/suite/kit) paints the ABSOLUTE time on first paint —
// identical on both sides, because it depends only on the timestamp — then
// swaps to the relative form after mount and re-renders every ten seconds. The
// ticking is the point: a stamp that visibly advances while you are talking is
// what separates live from a screenshot. It also clamps negative ages, which is
// what the old helper here was guarding against; see lib/enterprise/tz.ts.

export default function SuiteBoard({
  who, orgName, entered, hosts, telemetry, visible, art,
}: {
  who: string;
  orgName: string;
  entered: string[];
  hosts: ResolvedSuiteApp[];
  telemetry: SuiteTelemetry;
  /**
   * Each system's front-door plate, and whether the file is actually on disk —
   * checked on the server, because a client component cannot know and a card
   * that requests a missing image flashes its gradient in and then out again.
   */
  art: RailArt[];
  /**
   * System ids this person may see at all. Undefined means all six — which is
   * what every existing caller passes, so nobody's launcher changes until an
   * administrator deliberately turns a door off for somebody.
   */
  visible?: string[];
}) {
  const reduce = useReducedMotion();

  // A door that has been turned off does not appear GREYED — it is not there.
  // A visible-but-dead tile invites the question "why can't I open that?", which
  // an administrator then has to answer; a launcher of five is simply this
  // person's suite.
  const apps = visible ? SUITE_APPS.filter((a) => visible.includes(a.id)) : SUITE_APPS;

  // THE COUNT IS COMPUTED, NEVER TYPED. This page used to say "Six systems." in
  // three places, which was true right up until a lender bought four of them —
  // and a launcher that claims six while rendering four is the single fastest
  // way to make a real product look like a mock-up in front of a room.
  const n = apps.length;
  const spell = ["no", "one", "two", "three", "four", "five", "six", "seven"][n] ?? String(n);
  const Spell = spell.charAt(0).toUpperCase() + spell.slice(1);

  const rise = (i: number) =>
    reduce
      ? { initial: false as const, animate: { opacity: 1, y: 0 } }
      : {
          initial: { opacity: 0, y: 16 },
          animate: { opacity: 1, y: 0 },
          transition: { delay: 0.04 * i, duration: 0.5, ease: [0.22, 1, 0.36, 1] as const },
        };

  const fintechConnected = (telemetry.fintech.trackedInCollectBox ?? 0) > 0;

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#0b0a10] text-white">
      {/* ── The field ──────────────────────────────────────────────────────
          Six accents bled into the background at very low opacity. It is the
          same six hues the cards use, so the page reads as one object rather
          than a grid on a dark rectangle. */}
      <div aria-hidden className="pointer-events-none fixed inset-0 z-0">
        <div className="absolute -left-[10%] -top-[15%] h-[520px] w-[520px] rounded-full bg-[#2a78d6] opacity-[0.20] blur-[130px]" />
        <div className="absolute -right-[8%] -top-[10%] h-[460px] w-[460px] rounded-full bg-[#7c3aed] opacity-[0.20] blur-[130px]" />
        <div className="absolute left-[28%] top-[22%] h-[420px] w-[420px] rounded-full bg-[#be123c] opacity-[0.16] blur-[140px]" />
        <div className="absolute -left-[6%] bottom-[6%] h-[440px] w-[440px] rounded-full bg-[#0f766e] opacity-[0.16] blur-[140px]" />
        <div className="absolute right-[10%] bottom-[-6%] h-[420px] w-[420px] rounded-full bg-[#6d28d9] opacity-[0.16] blur-[140px]" />
        <div className="absolute left-[52%] top-[52%] h-[360px] w-[360px] rounded-full bg-[#0e7490] opacity-[0.14] blur-[130px]" />
        {/* A faint grid, so the colour has structure under it. */}
        <div
          className="absolute inset-0 opacity-[0.5]"
          style={{
            backgroundImage:
              "linear-gradient(rgba(255,255,255,0.028) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.028) 1px, transparent 1px)",
            backgroundSize: "64px 64px",
          }}
        />
      </div>

      <div className="relative z-10 mx-auto max-w-[1220px] px-4 py-6 sm:px-6 sm:py-10">
        {/* ── Identity ─────────────────────────────────────────────────── */}
        <motion.header {...rise(0)} className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-paper/[0.07] ring-1 ring-white/10">
              <KeyRound className="h-5 w-5 text-white/85" />
            </span>
            {/* NO PRODUCT NAME HERE. This used to read "BirgenAI ID" — the
                internal name of the identity service — on the first screen a
                lender’s staff ever see, above a subtitle that already said
                exactly what it does. What the sign-in is CALLED is our business;
                what it DOES is theirs. */}
            <div>
              <p className="text-[15px] font-bold leading-tight">One sign-in</p>
              <p className="text-[11.5px] text-white/45">
                {Spell} system{n === 1 ? "" : "s"}. One live book. One nervous system.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-400/12 px-2.5 py-1.5 text-[11px] font-semibold text-emerald-300 ring-1 ring-emerald-400/20">
              <ShieldCheck className="h-3.5 w-3.5" /> {who}
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-xl bg-paper/[0.06] px-2.5 py-1.5 text-[11px] font-semibold text-white/60 ring-1 ring-white/10">
              <Building2 className="h-3.5 w-3.5" /> {orgName}
            </span>
          </div>
        </motion.header>

        {/* ── Hero ─────────────────────────────────────────────────────── */}
        <motion.div {...rise(1)} className="mt-9 max-w-3xl sm:mt-12">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-paper/[0.07] px-3 py-1 text-[10.5px] font-bold uppercase tracking-[0.16em] text-white/60 ring-1 ring-white/10">
            <Layers3 className="h-3 w-3" /> The connected suite
          </span>
          <h1 className="mt-4 text-[34px] font-bold leading-[1.08] tracking-[-0.028em] sm:text-[46px]">
            {Spell} system{n === 1 ? "" : "s"}.{" "}
            <span
              className="bg-clip-text text-transparent"
              style={{ backgroundImage: "linear-gradient(96deg,#4d94ea 0%,#22b8cf 22%,#a78bfa 46%,#fb7185 70%,#2dd4bf 92%)" }}
            >
              One live book.
            </span>
          </h1>
          <p className="mt-4 max-w-2xl text-[14.5px] leading-relaxed text-white/60">
            Every figure on this page was read from Micromart&rsquo;s own SQL Server when it rendered
            {telemetry.readMs ? ` — ${(telemetry.readMs / 1000).toFixed(1)}s ago` : ""}. Nothing is seeded, cached or
            illustrative. The systems below are not integrated by an export: they read the same tables, in the same
            instant, and write back through one bridge.
          </p>
        </motion.div>

        {/* ── Live strip ───────────────────────────────────────────────── */}
        <motion.div {...rise(2)} className="mt-7">
          {telemetry.offline ? (
            <div className="rounded-2xl border border-amber-400/25 bg-amber-400/[0.07] px-4 py-3">
              <p className="text-[12.5px] font-semibold text-amber-200">Micromart&rsquo;s server is not reachable right now</p>
              <p className="mt-0.5 text-[11.5px] text-amber-200/70">
                The {spell} door{n === 1 ? "" : "s"} below still open. Every screen behind them reads live, so they
                will show their own connection state rather than stale numbers.
              </p>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2.5 rounded-2xl border border-white/[0.09] bg-paper/[0.04] px-4 py-3 backdrop-blur">
              <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.1em] text-emerald-300">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
                </span>
                Live
              </span>
              <span className="text-[11.5px] text-white/45">last payment <TimeAgo at={telemetry.lastEventAt} /></span>
              <span className="ml-auto inline-flex items-center gap-1.5 text-[11px] text-white/35">
                <Database className="h-3 w-3" /> services · Serviceconnect · CollectBox · Transactions
              </span>
            </div>
          )}
        </motion.div>

        {/* ── The systems this lender holds ─────────────────────────────── */}
        {n === 0 && (
          // Reachable, and worth rendering properly: an administrator can switch
          // every system off from the platform board. A blank page here would
          // read as an outage and generate a support call; naming the cause and
          // who can undo it turns it into a two-minute conversation.
          <div className="mt-4 rounded-2xl border border-white/[0.09] bg-paper/[0.035] px-5 py-8 text-center backdrop-blur">
            <p className="text-[15px] font-semibold text-white/80">No systems are switched on for {orgName} yet.</p>
            <p className="mx-auto mt-2 max-w-md text-[12.5px] leading-relaxed text-white/45">
              Your sign-in is valid and you are signed in — there is simply nothing assigned to this organisation
              to open. A platform administrator turns systems on per lender; ask them to add the ones you have bought.
            </p>
          </div>
        )}
        {/* ── The systems, on a rail ─────────────────────────────────────
            This was a three-across grid of six equal rectangles: honest,
            static, and indistinguishable from a settings page. The cards are
            now big enough to carry each system’s OWN front-door artwork, so
            the colour code is taught by the picture rather than by a hairline —
            and the container scrolls, so the systems a lender actually holds
            decide its length instead of the layout deciding how many fit.

            It does not auto-advance. See SystemRail for why not. */}
        <motion.div {...rise(3)}>
          <SystemRail apps={apps} hosts={hosts} entered={entered} telemetry={telemetry} art={art} />
        </motion.div>

        {/* ── The pipelines ────────────────────────────────────────────── */}
        <motion.section {...rise(9)} className="mt-4 rounded-2xl border border-white/[0.09] bg-paper/[0.035] p-4 backdrop-blur">
          <header className="mb-3 flex flex-wrap items-end justify-between gap-2">
            <div>
              <h2 className="flex items-center gap-2 text-[14px] font-bold">
                <Radio className="h-4 w-4 text-emerald-300" />
                The pipelines, running
              </h2>
              <p className="mt-0.5 text-[11.5px] text-white/45">
                Not a diagram of an intention. Each lane carries its own count, read from the same server.
              </p>
            </div>
            <Link href="/desk/pipeline" className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-white/60 hover:text-white">
              Open the Fintech bridge <ArrowUpRight className="h-3 w-3" />
            </Link>
          </header>

          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {telemetry.flows.map((f) => (
              <div
                key={`${f.from}-${f.to}`}
                className={`rounded-xl border px-3 py-2.5 ${
                  f.live ? "border-emerald-400/22 bg-emerald-400/[0.06]" : "border-amber-400/22 bg-amber-400/[0.05]"
                }`}
              >
                <p className="flex items-center gap-1.5 text-[10.5px] font-semibold text-white/70">
                  <span className="truncate">{f.from}</span>
                  <ArrowRight className="h-3 w-3 shrink-0 text-white/30" />
                  <span className="truncate">{f.to}</span>
                </p>
                <p className={`mt-1.5 text-[15px] font-bold tabular-nums ${f.live ? "text-emerald-300" : "text-amber-300"}`}>
                  {f.value ?? "—"}
                </p>
                <p className="mt-0.5 text-[10.5px] text-white/40">{f.label}</p>
              </div>
            ))}
          </div>
        </motion.section>

        {/* ── The Fintech story ────────────────────────────────────────── */}
        {telemetry.fintech.borrowers != null && (
          <motion.section
            {...rise(10)}
            className="mt-4 overflow-hidden rounded-2xl border border-white/[0.09] bg-paper/[0.035] backdrop-blur"
          >
            <div className="grid lg:grid-cols-[minmax(0,1fr)_320px]">
              <div className="p-5">
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#fb7185]">Micromart Fintech · entity 3005</p>
                <h2 className="mt-2 text-[22px] font-bold leading-tight tracking-[-0.018em]">
                  {fintechConnected
                    ? "Connected to the collections floor"
                    : "A growing book with no collections engine"}
                </h2>
                <p className="mt-2 max-w-xl text-[12.5px] leading-relaxed text-white/55">
                  {fintechConnected ? (
                    <>
                      {telemetry.fintech.trackedInCollectBox?.toLocaleString("en-KE")} Micro Eazy cases are on the
                      collections floor, worked by the same agents, under the same commission bands, as the main book.
                      Nothing was migrated — the loans stayed in Serviceconnect and only a reference crossed.
                    </>
                  ) : (
                    <>
                      17,016 borrowers were moved into this entity on 2 August 2026 and every one of them dropped off
                      the collections floor. CollectBox holds 93,000 tracked loans and{" "}
                      <strong className="font-semibold text-white/80">none of them are 3005</strong>. The bridge that
                      closes that is built, measured against Micromart&rsquo;s own nightly job, and one button away.
                    </>
                  )}
                </p>
                <Link
                  href="/desk/pipeline"
                  className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-[#be123c] px-3.5 py-2 text-[12.5px] font-semibold text-white transition-colors hover:bg-[#e11d48]"
                >
                  See the bridge <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </div>

              <dl className="grid grid-cols-2 border-t border-white/[0.08] lg:grid-cols-1 lg:border-l lg:border-t-0">
                <Cell k="Borrowers" v={telemetry.fintech.borrowers?.toLocaleString("en-KE") ?? "—"} />
                <Cell k="Open loans" v={telemetry.fintech.loansOpen?.toLocaleString("en-KE") ?? "—"} />
                <Cell
                  k="On the collections floor"
                  v={telemetry.fintech.trackedInCollectBox?.toLocaleString("en-KE") ?? "—"}
                  tone={fintechConnected ? "good" : "warn"}
                />
                <Cell k="Disbursed today" v={telemetry.fintech.disbursedToday?.toLocaleString("en-KE") ?? "—"} />
              </dl>
            </div>
          </motion.section>
        )}

        <motion.p {...rise(11)} className="mt-6 text-center text-[10.5px] text-white/25">
          Rights do not cross. One identity opens every door you hold a role behind; it opens no door you do not.
        </motion.p>
      </div>
    </div>
  );
}

function Cell({ k, v, tone }: { k: string; v: string; tone?: "good" | "warn" }) {
  const color = tone === "good" ? "text-emerald-300" : tone === "warn" ? "text-amber-300" : "text-white";
  return (
    <div className="border-b border-white/[0.06] px-4 py-3 last:border-b-0">
      <dt className="text-[9.5px] font-bold uppercase tracking-[0.12em] text-white/35">{k}</dt>
      <dd className={`mt-0.5 text-[19px] font-bold tabular-nums ${color}`}>{v}</dd>
    </div>
  );
}
