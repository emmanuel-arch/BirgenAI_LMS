// ─────────────────────────────────────────────────────────────────────────────
// THE PAPER EVERY STATEMENT IS PRINTED ON.
//
// Three documents leave this console and end up in somebody's hands — the
// customer statement, the loan statement, and the master file. They were three
// separate pieces of markup that had drifted: one carried the lender's logo, one
// did not; one said who generated it, one did not; and all three signed off with
// a platform name that is not the one on this product.
//
// So the letterhead, the reference block and the sign-off live HERE, once. A
// document that goes to a customer must look like it came from THEIR lender —
// their mark, their colour, their name — and must say, in small type at the
// bottom, exactly when it was produced and by whom, because that is the line an
// auditor reads first and the line a customer quotes when two copies disagree.
//
// ── WHY PRINT CSS AND NOT A PDF LIBRARY ─────────────────────────────────────
// "Save as PDF" is a first-class destination in every browser print dialog, and
// the output is always current with what the officer is looking at. A server-
// rendered PDF is a second implementation of the same page that can silently
// disagree with the first — and it would have to re-fetch every photograph
// through credentials the browser already has.
// ─────────────────────────────────────────────────────────────────────────────
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PrintButton } from "./PrintButton";

export type Lender = {
  name: string;
  accent: string | null;
  logoUrl: string | null;
};

const day = (d: Date) => d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

/**
 * The sheet: screen chrome that disappears when printed, and A4 paper that does
 * not. `print-doc` and `print-exact` are defined in globals.css — the second is
 * what keeps the accent rule and the status pills their real colours instead of
 * the grey a printer defaults them to.
 */
export function DocumentSheet({
  backHref,
  backLabel,
  downloadLabel = "Download PDF",
  children,
  wide,
}: {
  backHref: string;
  backLabel: string;
  downloadLabel?: string;
  children: React.ReactNode;
  /** A ledger of 300 rows needs the width; a one-loan statement does not. */
  wide?: boolean;
}) {
  const max = wide ? "max-w-5xl" : "max-w-3xl";
  return (
    <div className="min-h-screen rounded-2xl bg-paper text-ash-900 print-doc">
      <div className="no-print sticky top-0 z-10 rounded-t-2xl border-b border-ash-900/10 bg-paper/80 backdrop-blur">
        <div className={`mx-auto ${max} flex h-14 items-center justify-between px-4 sm:px-6`}>
          <Link href={backHref} className="inline-flex items-center gap-1.5 text-sm text-ash-500 hover:text-ash-800">
            <ArrowLeft className="h-4 w-4" /> {backLabel}
          </Link>
          <PrintButton label={downloadLabel} />
        </div>
      </div>
      <main className={`mx-auto ${max} px-4 py-8 sm:px-6 print-exact`}>{children}</main>
    </div>
  );
}

/**
 * The lender's mark, and what this document is.
 *
 * A wordmark already says the name, so we do not say it twice; the initial tile
 * is the fallback for an org that has not uploaded one.
 */
export function Letterhead({
  lender,
  title,
  reference,
  issued,
  extra,
}: {
  lender: Lender;
  title: string;
  reference: string;
  issued?: Date;
  extra?: string;
}) {
  const accent = lender.accent ?? "#000";
  return (
    <header className="flex items-start justify-between gap-4 border-b-2 pb-4" style={{ borderColor: accent }}>
      {lender.logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={lender.logoUrl} alt={`${lender.name} logo`} className="h-12 max-w-[220px] object-contain object-left" />
      ) : (
        <div className="flex items-center gap-3">
          <div
            className="flex h-11 w-11 items-center justify-center rounded-xl text-lg font-bold text-white"
            style={{ backgroundColor: accent }}
          >
            {lender.name.slice(0, 1)}
          </div>
          <p className="text-base font-bold leading-tight">{lender.name}</p>
        </div>
      )}
      <div className="text-right">
        <h1 className="text-lg font-bold tracking-tight">{title}</h1>
        <p className="text-[11px] text-ash-500">
          Ref {reference} · issued {day(issued ?? new Date())}
        </p>
        {extra && <p className="text-[11px] text-ash-500">{extra}</p>}
      </div>
    </header>
  );
}

/**
 * The sign-off.
 *
 * Says when, by whom, and against what reference — the three things somebody
 * holding two copies of a statement needs in order to tell which is current.
 */
export function DocumentFooter({
  lender,
  by,
  reference,
  note,
}: {
  lender: Lender;
  by: string;
  reference: string;
  note?: string;
}) {
  return (
    <footer className="mt-8 border-t border-ash-900/10 pt-3 text-[10px] leading-relaxed text-ash-500">
      <p>
        This document was generated on {new Date().toLocaleString("en-GB")} by {by} for {lender.name}.
        {note ? ` ${note}` : ""} Verify against reference <span className="font-mono font-semibold">{reference}</span>.
      </p>
      <p className="mt-1">Powered by Micro Eazy</p>
    </footer>
  );
}

/** A figure with its name over it. The unit of every summary strip on paper. */
export function DocStat({
  label,
  value,
  sub,
  accent,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: string | null;
  tone?: string;
}) {
  return (
    <div className="rounded-lg border border-ash-900/10 px-2.5 py-2">
      <p className="text-[9px] uppercase tracking-wide text-ash-500">{label}</p>
      <p className={`text-sm font-bold ${tone ?? "text-ash-800"}`} style={accent ? { color: accent } : undefined}>
        {value}
      </p>
      {sub && <p className="text-[9px] leading-tight text-ash-500">{sub}</p>}
    </div>
  );
}
