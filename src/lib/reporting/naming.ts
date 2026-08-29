// ─────────────────────────────────────────────────────────────────────────────
// WHAT A DOWNLOADED FILE IS CALLED.
//
// A report leaves this system and lands in somebody's Downloads folder next to
// forty other files, gets attached to an email, gets opened again in March. So
// the filename has to answer, on its own and with no context around it:
//
//     WHOSE book · WHICH book · WHICH report · OVER WHAT PERIOD · RUN WHEN
//
// `Micromart_SME_Arrears_2026-07-30_2026-08-29_20260829-1432.xlsx`
//
// Every part of that is load-bearing:
//
//   · THE BOOK IS IN THE NAME. Micromart has two, and two files called
//     "Arrears_August.xlsx" that disagree is precisely the confusion this whole
//     entity-scoping effort exists to prevent. Somebody WILL forward one.
//   · THE PERIOD IS ISO AND SORTABLE. Dates written 30-07-2026 sort by day of
//     the month, which is useless, and are ambiguous to half the world.
//   · THE RUN STAMP IS THERE because a report is a photograph of a moving book.
//     Two arrears files for the same period, taken a week apart, are both
//     correct and different, and without the stamp there is no way to tell which
//     is which — or to avoid Windows silently appending " (2)".
//   · A STOCK REPORT SAYS "as-at". An OLB is not "for August", it is what is
//     owed on the day you asked. Naming it like a period report invites somebody
//     to add two of them together.
//
// Everything is ASCII, hyphen-separated, with no spaces, no commas and no
// slashes — the four things that make a filename hostile to a shell, an email
// client and SharePoint respectively.
// ─────────────────────────────────────────────────────────────────────────────

/** Windows forbids \ / : * ? " < > | ; the rest is our own hygiene. */
function slug(v: string): string {
  return (v ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")   // strip accents rather than mangle them
    .replace(/&/g, "and")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 48) || "report";
}

const iso = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

/** Sortable to the minute. Seconds would be noise; two runs in one minute are the same run. */
const stamp = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
};

export type NameParts = {
  /** The lender. */
  org: string;
  /**
   * The books in the cut. One name, or "All-Books" when more than one — a file
   * holding two entities must not be named after either of them.
   */
  books: string[];
  /** The report or chart. */
  subject: string;
  /** Null for a stock report, which is named "as-at" instead. */
  period: { from: Date; to: Date } | null;
  ext: string;
  at?: Date;
};

export function reportFilename({ org, books, subject, period, ext, at = new Date() }: NameParts): string {
  const book = books.length === 1 ? slug(books[0]) : books.length > 1 ? "All-Books" : "Book";
  const when = period
    ? `${iso(period.from)}_${iso(period.to)}`
    // A stock report's "to" is meaningless; the day it was taken is the fact.
    : `as-at-${iso(at)}`;
  return [slug(org), book, slug(subject), when, stamp(at)].join("_") + `.${ext.replace(/^\./, "")}`;
}

/** The same convention for a chart image, which has a subject but rarely a table. */
export function chartFilename(parts: Omit<NameParts, "ext"> & { ext?: string }): string {
  return reportFilename({ ...parts, ext: parts.ext ?? "png" });
}

/**
 * The human title printed INSIDE the file — the first thing a reader sees when
 * the filename has already been lost to an email thread.
 */
export function reportTitle(org: string, books: string[], subject: string, period: { from: Date; to: Date } | null): string {
  const book = books.length ? books.join(" + ") : "";
  const when = period ? `${iso(period.from)} to ${iso(period.to)}` : `as at ${iso(new Date())}`;
  return [org, book, subject, when].filter(Boolean).join(" · ");
}

export { iso as isoDate, stamp as runStamp };
