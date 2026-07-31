"use client";

// ─────────────────────────────────────────────────────────────────────────────
// THE SUITE LAUNCHER — the room's first impression of BirgenAI as a platform
// rather than an LMS.
//
// It answers one question visually before a word is read: *these are five real
// systems, not five tabs.* Each keeps its own name, its own colour, its own front
// door and its own subdomain — and the identity rail running underneath them all
// is the thing being sold.
//
// Built on the console's own design system (the artwork background, .canvas /
// .panel surfaces, the ink scale, the t-* type ramp) so that arriving here from
// the console feels like the same product, not a marketing page bolted on.
// ─────────────────────────────────────────────────────────────────────────────
import { useState } from "react";
import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import {
  KeyRound, ArrowRight, ShieldCheck, Check, Globe, Lock, Layers, Sparkle, Building2,
} from "lucide-react";
import { SUITE_APPS, type SuiteApp } from "@/lib/suite/apps";

type Props = {
  who: string;
  orgName: string;
  /** App ids this person actually holds a role in. Others offer "request access". */
  entered: string[];
};

export default function SuiteLauncher({ who, orgName, entered }: Props) {
  const reduce = useReducedMotion();
  const [hovered, setHovered] = useState<string | null>(null);

  // Motion is a courtesy, never a requirement: with reduced-motion on, every
  // variant collapses to its settled state rather than being skipped mid-flight.
  const rise = (i: number) =>
    reduce
      ? { initial: false as const, animate: { opacity: 1, y: 0 } }
      : {
          initial: { opacity: 0, y: 14 },
          animate: { opacity: 1, y: 0 },
          transition: { delay: 0.05 * i, duration: 0.45, ease: [0.22, 1, 0.36, 1] as const },
        };

  return (
    <div className="min-h-screen text-[color:var(--ink-body)]">
      <div aria-hidden className="fixed inset-0 z-0 bg-[url('/images/white-background.png')] bg-cover bg-center" />

      <div className="relative z-10 mx-auto max-w-6xl px-4 py-5 sm:px-6 sm:py-8">
        {/* ── Identity plate ─────────────────────────────────────────────── */}
        <motion.div {...rise(0)} className="panel flex flex-wrap items-center justify-between gap-3 rounded-2xl px-4 py-3">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[color:var(--brand-soft)]">
              <KeyRound className="h-[18px] w-[18px] text-[color:var(--brand)]" />
            </span>
            <div>
              <p className="t-section">BirgenAI ID</p>
              <p className="t-meta text-[11px]">Single sign-on across every system you run</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-500/12 px-2.5 py-1.5 text-[11px] font-semibold text-emerald-700 ring-1 ring-emerald-600/20">
              <ShieldCheck className="h-3.5 w-3.5" /> {who}
            </span>
            <span className="hidden items-center gap-1.5 rounded-xl bg-[color:var(--ink)]/[0.05] px-2.5 py-1.5 text-[11px] font-semibold text-[color:var(--ink-muted)] sm:inline-flex">
              <Building2 className="h-3.5 w-3.5" /> {orgName}
            </span>
          </div>
        </motion.div>

        {/* ── Hero ───────────────────────────────────────────────────────── */}
        <motion.div {...rise(1)} className="mt-6 max-w-2xl sm:mt-9">
          <span className="t-label inline-flex items-center gap-1.5 rounded-full bg-[color:var(--brand-soft)] px-2.5 py-1 text-[color:var(--brand)]">
            <Sparkle className="h-3 w-3" /> The connected suite
          </span>
          <h1 className="t-display mt-3 text-[1.9rem] sm:text-[2.4rem]">
            One login.<br className="sm:hidden" /> Every system.
          </h1>
          <p className="t-body mt-3 text-[15px]">
            Your lending platform, customer portal, HR, accounting and call-centre each keep their own
            front door — but your BirgenAI ID carries across all of them. No second password, no
            divergent user lists. Click any system below and you are already in.
          </p>
        </motion.div>

        {/* ── The identity rail ──────────────────────────────────────────── */}
        <motion.div {...rise(2)} className="canvas mt-6 overflow-hidden rounded-2xl p-4 sm:p-5">
          <IdentityRail hovered={hovered} reduce={!!reduce} />
        </motion.div>

        {/* ── App grid ───────────────────────────────────────────────────── */}
        <div className="mt-4 grid gap-3 sm:mt-5 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3">
          {SUITE_APPS.map((app, i) => (
            <motion.div key={app.id} {...rise(3 + i)}>
              <AppCard
                app={app}
                entered={entered.includes(app.id)}
                onHover={() => setHovered(app.id)}
                onLeave={() => setHovered(null)}
              />
            </motion.div>
          ))}
        </div>

        {/* ── How the federation actually works ──────────────────────────── */}
        <motion.div {...rise(9)} className="canvas mt-4 rounded-2xl p-4 sm:mt-5 sm:p-6">
          <div className="flex items-center gap-2">
            <Layers className="h-4 w-4 text-[color:var(--brand)]" />
            <h2 className="t-section">How it holds together</h2>
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <Explainer
              icon={KeyRound}
              title="One identity, five doors"
              body="Each system has its own login page and its own brand. All five honour the same BirgenAI ID, issued once and carried on a session scoped to your whole suite."
            />
            <Explainer
              icon={Lock}
              title="Rights stay where they belong"
              body="Identity crosses; authority does not. An HR manager does not inherit disbursement powers because they share a login. Every system decides its own access, on its own routes."
            />
            <Explainer
              icon={Globe}
              title="Real subdomains, real separation"
              body="Each system deploys independently on its own subdomain. One can be upgraded, scaled or taken down without touching the others — and your people never notice a boundary."
            />
          </div>
        </motion.div>

        <motion.p {...rise(10)} className="t-meta mt-4 flex items-center gap-2 px-1 text-[11px]">
          <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
          Federated single sign-on. Sessions are signed, short-lived and revocable centrally — signing
          someone out of BirgenAI ID signs them out of every system at once.
        </motion.p>
      </div>
    </div>
  );
}

// ── The rail ──────────────────────────────────────────────────────────────────
// Five systems on one spine. Hovering a card lights its node, which is the whole
// idea rendered literally: they are separate, and they are joined.
function IdentityRail({ hovered, reduce }: { hovered: string | null; reduce: boolean }) {
  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <p className="t-label">The identity spine</p>
        <p className="t-meta hidden text-[11px] sm:block">
          <span className="font-mono text-[10px]">*.birgenai.com</span> · one session, five systems
        </p>
      </div>

      <div className="relative mt-4 pb-1">
        {/* The spine itself, behind the nodes. */}
        <div aria-hidden className="absolute left-0 right-0 top-5 h-px bg-[color:var(--ink)]/10" />
        <motion.div
          aria-hidden
          className="absolute left-0 top-5 h-px"
          style={{ background: "linear-gradient(90deg, transparent, var(--brand), transparent)" }}
          initial={reduce ? { width: "100%", opacity: 0.5 } : { width: 0, opacity: 0.9 }}
          animate={reduce ? { width: "100%", opacity: 0.5 } : { width: "100%", opacity: 0.9 }}
          transition={{ duration: 1.1, ease: "easeOut", delay: 0.25 }}
        />

        <div className="relative grid grid-cols-5 gap-1">
          {SUITE_APPS.map((app) => {
            const on = hovered === app.id || hovered === null;
            return (
              <div key={app.id} className="flex flex-col items-center gap-2 text-center">
                <span
                  className="flex h-10 w-10 items-center justify-center rounded-xl ring-1 transition-all duration-300"
                  style={{
                    backgroundColor: on ? `${app.accent}1f` : "rgba(255,255,255,0.7)",
                    color: on ? app.accent : "var(--ink-faint)",
                    boxShadow: hovered === app.id ? `0 0 0 4px ${app.accent}1a` : undefined,
                    borderColor: "transparent",
                    ["--tw-ring-color" as never]: on ? `${app.accent}33` : "rgba(15,15,25,0.08)",
                  }}
                >
                  <app.icon className="h-[18px] w-[18px]" />
                </span>
                <span className="t-meta text-[10px] leading-tight sm:text-[11px]">{app.short}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── One system ────────────────────────────────────────────────────────────────
function AppCard({
  app, entered, onHover, onLeave,
}: {
  app: SuiteApp;
  entered: boolean;
  onHover: () => void;
  onLeave: () => void;
}) {
  const card = (
    <div
      onMouseEnter={onHover}
      onMouseLeave={onLeave}
      className="group canvas relative h-full overflow-hidden rounded-2xl p-4 transition-all duration-300 hover:-translate-y-0.5 sm:p-5"
      style={{ ["--card-accent" as never]: app.accent }}
    >
      {/* Accent bloom — the card's identity, felt before it is read. */}
      <span
        aria-hidden
        className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full opacity-[0.18] blur-3xl transition-opacity duration-500 group-hover:opacity-40"
        style={{ backgroundColor: app.accent }}
      />
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[3px] origin-left scale-x-0 transition-transform duration-500 group-hover:scale-x-100"
        style={{ background: `linear-gradient(90deg, ${app.accent}, ${app.accent}00)` }}
      />

      <div className="relative flex items-start justify-between gap-3">
        <span
          className="flex h-11 w-11 items-center justify-center rounded-xl ring-1 transition-transform duration-300 group-hover:scale-105"
          style={{ backgroundColor: `${app.accent}1a`, color: app.accent, ["--tw-ring-color" as never]: `${app.accent}2e` }}
        >
          <app.icon className="h-5 w-5" />
        </span>
        <StateChip app={app} entered={entered} />
      </div>

      <p className="t-section relative mt-3 text-[15px]">{app.name}</p>
      <p className="t-meta relative mt-0.5 text-[12px] font-medium" style={{ color: app.accent }}>
        {app.purpose}
      </p>
      <p className="t-body relative mt-2 text-[13px] leading-snug">{app.tagline}</p>

      <div className="relative mt-3 flex flex-wrap gap-1.5">
        {app.modules.map((m) => (
          <span
            key={m}
            className="rounded-md bg-[color:var(--ink)]/[0.04] px-2 py-0.5 text-[10px] font-medium text-[color:var(--ink-muted)] ring-1 ring-[color:var(--ink)]/[0.06]"
          >
            {m}
          </span>
        ))}
      </div>

      {app.handoff && (
        <p className="t-meta relative mt-3 flex items-start gap-1.5 border-t border-[color:var(--ink)]/[0.07] pt-3 text-[11px] leading-snug">
          <ArrowRight className="mt-[3px] h-3 w-3 shrink-0" style={{ color: app.accent }} />
          {app.handoff}
        </p>
      )}

      <div className="relative mt-3 flex items-center justify-between gap-2">
        <span className="font-mono text-[10px] text-[color:var(--ink-faint)]">{app.subdomain}</span>
        <span
          className="inline-flex items-center gap-1.5 text-[13px] font-semibold transition-transform duration-300 group-hover:translate-x-0.5"
          style={{ color: app.accent }}
        >
          {app.system ? "Open console" : entered ? "Enter — no password" : "Preview"}
          <ArrowRight className="h-4 w-4" />
        </span>
      </div>
    </div>
  );

  return (
    <Link href={app.href} className="block h-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--brand)] rounded-2xl">
      {card}
    </Link>
  );
}

function StateChip({ app, entered }: { app: SuiteApp; entered: boolean }) {
  if (app.system) {
    return (
      <span className="rounded-full bg-[color:var(--ink)]/[0.06] px-2 py-0.5 text-[10px] font-bold tracking-wide text-[color:var(--ink-muted)]">
        CORE
      </span>
    );
  }
  if (!app.live) {
    return (
      <span className="rounded-full bg-amber-500/12 px-2 py-0.5 text-[10px] font-bold tracking-wide text-amber-700 ring-1 ring-amber-600/20">
        PREVIEW
      </span>
    );
  }
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold tracking-wide ring-1 ${
        entered
          ? "bg-emerald-500/12 text-emerald-700 ring-emerald-600/20"
          : "bg-[color:var(--ink)]/[0.05] text-[color:var(--ink-muted)] ring-[color:var(--ink)]/[0.08]"
      }`}
    >
      {entered ? <><Check className="h-3 w-3" /> SIGNED IN</> : "AVAILABLE"}
    </span>
  );
}

function Explainer({
  icon: Icon, title, body,
}: {
  icon: typeof KeyRound;
  title: string;
  body: string;
}) {
  return (
    <div>
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-[color:var(--ink-faint)]" />
        <p className="t-section text-[13px]">{title}</p>
      </div>
      <p className="t-meta mt-1.5 text-[12px] leading-relaxed">{body}</p>
    </div>
  );
}
