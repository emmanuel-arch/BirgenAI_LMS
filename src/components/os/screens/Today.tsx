"use client";

// ─────────────────────────────────────────────────────────────────────────────
// THE MORNING THREE — Due Today, Arrears, Promises.
//
// Alerts tells a lender that three promises fall due today. This tells them WHOSE,
// HOW MUCH, and gives them the phone. That gap is the entire reason this screen
// exists: a tray is a summons, and a summons without a worklist attached just moves
// the work of finding the work onto the person who was already busy.
//
// ONE COMPONENT, THREE APPS. They share a shape — a headline figure, an optional
// breakdown, then people with money against their names — so they share a renderer.
// A second and third variant of "list of customers with an amount" is how six
// screens stop looking like one operating system, and the kit exists to stop that.
// What differs between them is stated once, in FACES below, and nowhere else.
//
// EVERY ROW IS TWO ACTIONS, NOT ONE. Tapping the row opens the conversation pinned
// to that customer — their file, their history, what to say. The phone glyph dials
// them. Both matter: a collections agent wants the number, a manager wants the
// story, and making either of them go through the other is how a screen gets
// described as "fine, but I still use the spreadsheet".
//
// THE FIGURE IS NEVER COMPUTED HERE. Amounts arrive formatted from
// /api/console/riri/today, because a currency rounded in the browser is a currency
// that will eventually disagree with the report it was read beside.
// ─────────────────────────────────────────────────────────────────────────────
import { motion } from "framer-motion";
import {
  ArrowRight, CalendarClock, CheckCircle2, Handshake, Loader2, Lock, Phone,
  RefreshCw, TrendingDown, type LucideIcon,
} from "lucide-react";
import { Screen, SectionLabel, EmptyState } from "../kit";
import type { TodayPayload, TodayRow } from "@/app/api/console/riri/today/route";

export type TodayKind = "due" | "arrears" | "promises";

type Face = {
  icon: LucideIcon;
  /** What the big number is. */
  headline: string;
  /** Under the number — what it means, in the lender's words. */
  caption: (d: TodayPayload) => string;
  tint: string;
  soft: string;
  ring: string;
  /** Where the full queue lives on the console. */
  href: string;
  hrefLabel: string;
  emptyTitle: string;
  emptyDetail: string;
  /** The right that was missing when the section came back unavailable. */
  denied: string;
};

const FACES: Record<TodayKind, Face> = {
  due: {
    icon: CalendarClock,
    headline: "Due today",
    caption: (d) => `across ${d.due.count} installment${d.due.count === 1 ? "" : "s"} falling due before close of business`,
    tint: "text-teal-700",
    soft: "bg-teal-50/70",
    ring: "border-teal-200",
    href: "/console/repayments",
    hrefLabel: "Open repayments",
    emptyTitle: "Nothing falls due today",
    emptyDetail: "No installment on your book is dated today. The next one will appear here on its morning.",
    denied: "Due Today reads the loan book, and your role does not include it.",
  },
  arrears: {
    icon: TrendingDown,
    headline: "In arrears",
    caption: (d) => `over ${d.arrears.count} account${d.arrears.count === 1 ? "" : "s"} — oldest and largest first`,
    tint: "text-orange-700",
    soft: "bg-orange-50/70",
    ring: "border-orange-200",
    href: "/console/collections",
    hrefLabel: "Work the queue",
    emptyTitle: "Nothing is late",
    emptyDetail: "Every installment on your book is either paid or not yet due. That is the number you want here.",
    denied: "Arrears reads the loan book, and your role does not include it.",
  },
  promises: {
    icon: Handshake,
    headline: "Promised today",
    caption: (d) => `from ${d.promises.count} customer${d.promises.count === 1 ? "" : "s"} who said they would pay by today`,
    tint: "text-violet-700",
    soft: "bg-violet-50/70",
    ring: "border-violet-200",
    href: "/console/collections?tab=ptp",
    hrefLabel: "Open promises",
    emptyTitle: "Nobody promised today",
    emptyDetail: "No promise to pay is dated today. They are taken on a call and land here on the day they fall due.",
    denied: "Promises are part of collections, and your role does not include it.",
  },
};

const timeOf = (iso: string) => new Date(iso).toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit", hour12: false });
const dateOf = (iso: string) => new Date(iso).toLocaleDateString("en-KE", { day: "numeric", month: "short" });

export function TodayScreen({
  kind, data, loading, onRefresh, onOpenCustomer, onNavigate,
}: {
  kind: TodayKind;
  data: TodayPayload | null;
  loading: boolean;
  onRefresh: () => void;
  onOpenCustomer: (id: string, name: string) => void;
  onNavigate: (href: string) => void;
}) {
  const face = FACES[kind];
  const Glyph = face.icon;

  if (!data && loading) {
    return (
      <Screen>
        <div className="flex flex-1 items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-zinc-300" />
        </div>
      </Screen>
    );
  }
  if (!data) {
    return (
      <Screen>
        <EmptyState
          icon={<Glyph className="h-6 w-6" />}
          title="Couldn't read your book"
          detail="The figures come off the live database and it did not answer. Nothing here is cached, on purpose."
          action={
            <button onClick={onRefresh} className="inline-flex items-center gap-1.5 rounded-xl border border-zinc-900/10 bg-white px-3 py-1.5 text-[11.5px] font-semibold text-zinc-600 hover:text-zinc-900">
              <RefreshCw className="h-3 w-3" /> Try again
            </button>
          }
        />
      </Screen>
    );
  }

  const section = data[kind];

  // A section the caller has no right to is stated, not hidden. A screen that
  // silently renders zero when the answer is "you may not see this" teaches an
  // officer that their book is empty.
  if (!section.available) {
    return (
      <Screen>
        <EmptyState icon={<Lock className="h-6 w-6" />} title="Not on your role" detail={face.denied} />
      </Screen>
    );
  }

  const rows = section.rows;

  return (
    <Screen>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pb-3 pt-1">
        {/* THE FIGURE. One number, big, with the count under it — the thing the
            person opened the app to find out. */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.22 }}
          className={`rounded-2xl border ${face.ring} ${face.soft} px-3.5 py-3`}
        >
          <p className={`flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.14em] ${face.tint}`}>
            <Glyph className="h-3 w-3" /> {face.headline}
          </p>
          <p className={`mt-1 text-[26px] font-bold leading-none tracking-tight tabular-nums ${face.tint}`}>
            {section.amount}
          </p>
          <p className="mt-1.5 text-[10.5px] leading-snug text-zinc-600">{face.caption(data)}</p>

          {kind === "promises" && data.promises.broken > 0 && (
            <p className="mt-1.5 text-[10px] leading-snug text-zinc-500">
              <span className="font-semibold text-rose-600">{data.promises.broken} broken</span> in the last 30 days —
              a promise nobody follows up on is one the customer learns they can break.
            </p>
          )}
          {kind === "due" && data.collected.amountRaw > 0 && (
            <p className="mt-1.5 flex items-center gap-1 text-[10px] leading-snug text-emerald-700">
              <CheckCircle2 className="h-3 w-3 shrink-0" />
              {data.collected.amount} already receipted today across {data.collected.count} payment{data.collected.count === 1 ? "" : "s"}.
            </p>
          )}
        </motion.div>

        {/* THE AGEING. Only arrears has one, and it is the whole argument for the
            app: 1–7 days is a phone call, past 60 is a decision. One total hides
            the difference and sends a team at the least collectable money first. */}
        {kind === "arrears" && data.arrears.buckets.some((b) => b.count > 0) && (
          <div>
            <SectionLabel>How old it is</SectionLabel>
            <div className="mt-1.5 grid grid-cols-2 gap-1.5">
              {data.arrears.buckets.map((b) => (
                <div key={b.key} className="rounded-xl border border-zinc-900/[0.07] bg-white/75 px-2.5 py-2">
                  <p className="text-[9.5px] font-medium uppercase tracking-wide text-zinc-500">{b.label}</p>
                  <p className="mt-0.5 text-[13px] font-bold leading-tight tabular-nums text-zinc-900">{b.amount}</p>
                  <p className="text-[9.5px] leading-tight text-zinc-400">
                    {b.count} installment{b.count === 1 ? "" : "s"}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* THE PEOPLE. */}
        {rows.length > 0 ? (
          <div>
            <SectionLabel>
              {kind === "arrears" ? "Worst first" : kind === "due" ? "Owing today" : "Said they would pay"}
              {section.count > rows.length && ` · top ${rows.length} of ${section.count}`}
            </SectionLabel>
            <div className="mt-1.5 space-y-1.5">
              {rows.map((r, i) => (
                <TodayRowCard
                  key={`${r.loanId}-${i}`}
                  row={r}
                  kind={kind}
                  index={i}
                  tint={face.tint}
                  onOpen={() => onOpenCustomer(r.borrowerId, r.name)}
                />
              ))}
            </div>
          </div>
        ) : (
          <div className="rounded-2xl border border-zinc-900/[0.07] bg-white/75 px-3.5 py-6 text-center">
            <p className="text-[12.5px] font-semibold text-zinc-700">{face.emptyTitle}</p>
            <p className="mx-auto mt-1 max-w-[250px] text-[10.5px] leading-snug text-zinc-500">{face.emptyDetail}</p>
          </div>
        )}

        {/* OUT TO THE REAL SCREEN. The phone is where you find out; the console is
            where you record what you did about it. */}
        <button
          onClick={() => onNavigate(face.href)}
          className="flex w-full items-center justify-between gap-2 rounded-2xl border border-zinc-900/[0.07] bg-white/75 px-3.5 py-2.5 text-left transition-all hover:border-[color:var(--brand)] active:scale-[0.985]"
        >
          <span className="min-w-0">
            <span className="block text-[12px] font-semibold leading-tight text-zinc-800">{face.hrefLabel}</span>
            <span className="mt-0.5 block text-[10px] leading-tight text-zinc-500">
              Log a call, take a promise, allocate a payment.
            </span>
          </span>
          <ArrowRight className="h-4 w-4 shrink-0 text-zinc-300" />
        </button>

        <div className="rounded-xl border border-zinc-900/[0.06] bg-white/60 px-3 py-2">
          <p className="text-[9.5px] leading-snug text-zinc-500">
            Counted off your live book at the moment you opened this — nothing here is a projection.
          </p>
          <button
            onClick={onRefresh}
            className="mt-1 inline-flex items-center gap-1 text-[9.5px] font-semibold text-zinc-400 hover:text-zinc-700"
          >
            <RefreshCw className={`h-2.5 w-2.5 ${loading ? "animate-spin" : ""}`} /> Read it again
          </button>
        </div>
      </div>
    </Screen>
  );
}

function TodayRowCard({
  row, kind, index, tint, onOpen,
}: {
  row: TodayRow;
  kind: TodayKind;
  index: number;
  tint: string;
  onOpen: () => void;
}) {
  const meta =
    kind === "arrears"
      ? `${row.daysLate} day${row.daysLate === 1 ? "" : "s"} late · missed ${dateOf(row.dueDate)}`
      : kind === "due"
        ? `Due today · scheduled ${timeOf(row.dueDate)}`
        : row.note?.trim()
          ? `“${row.note.trim()}”`
          : "Promised by today";

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index, 8) * 0.03 }}
      className="flex items-center gap-2 rounded-2xl border border-zinc-900/[0.07] bg-white/75 pl-3 pr-2 transition-all hover:border-[color:var(--brand)] hover:bg-white"
    >
      <button onClick={onOpen} className="min-w-0 flex-1 py-2.5 text-left" title={`Open ${row.name}`}>
        <span className="flex items-baseline gap-2">
          <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold leading-tight text-zinc-800">{row.name}</span>
          <span className={`shrink-0 text-[12px] font-bold tabular-nums ${tint}`}>{row.amount}</span>
        </span>
        <span className="mt-0.5 block truncate text-[10.5px] leading-tight text-zinc-500">{meta}</span>
      </button>
      {/* The handset, not a dialler. We hand the OS a tel: URI and stay out of the
          path of somebody's voice call — the same rule the Calls app follows. */}
      <a
        href={row.tel}
        onClick={(e) => e.stopPropagation()}
        title={`Call ${row.phone}`}
        aria-label={`Call ${row.name}`}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 transition-colors hover:bg-emerald-100"
      >
        <Phone className="h-3.5 w-3.5" />
      </a>
    </motion.div>
  );
}
