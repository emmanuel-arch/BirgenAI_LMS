// Loans List — the booked book, one row per loan, statement a click away.
// The applications queue shows what WANTS to be a loan; this shows what IS one.
//
// ── TWO BOOKS, ONE SCREEN ────────────────────────────────────────────────────
// A BRIDGED lender's loans are READ THROUGH to their own ServiceSuite, exactly
// as their borrower list already is. They are never mirrored into our Postgres:
// Micromart's entity 3005 carries 61,543 loans, and a nightly copy of a balance
// is wrong by morning — which on this particular screen means an officer quoting
// a settlement figure that is a day stale.
//
// So the source is decided once, here, and the table below renders whichever
// book answered. A NATIVE lender's loans come from our own tables and nothing
// about that path changed.
//
// ── WHAT THE LIVE PATH SHOWS THAT THE LOCAL ONE CANNOT ──────────────────────
// The next instalment and the arrears — the two columns collections actually
// work from, and the reason this screen was worth reading through rather than
// leaving on modelled data: 47 of Micromart's 96 running loans are behind, and
// none of that was visible here before.
//
// ARREARS IS THEIR NUMBER, NOT OURS. It comes from
// Transactions.dbo.LoansInArrears, the register their own dashboard reads. A
// figure derived from the schedule instead disagreed with it (33 loans vs 47),
// and a console that contradicts the system of record loses the argument in
// front of the customer. See lib/lms/servicesuite-loans.ts.
//
// ── LINKS, FOR A ROW WITH NO LMS UUID ───────────────────────────────────────
// A live loan has only a `ss:<id>` ref, so the borrower opens through the
// existing resolve step — browsing costs nothing, working a customer creates
// the local record everything else hangs off. The STATEMENT does not need that
// bargain: it is read straight from the lender's book, keyed on the borrower,
// exactly as their own sp_GetCustomerStatement is.
import { redirect } from "next/navigation";
import Link from "next/link";
import { Landmark, FileText, Radio } from "lucide-react";
import { auth } from "@/lib/auth";
import { resolveScope, loanScopeWhere } from "@/lib/rbac/scope";
import { prisma } from "@/lib/prisma";
import { portraitsFor } from "@/lib/kyc/avatars";
import { BorrowerAvatar } from "@/components/kyc/BorrowerAvatar";
import { PageHeader } from "@/components/shell/PageHeader";
import { resolveOrg } from "@/lib/tenancy";
import { listLoansLive, getLoanBookStats, type LiveLoanFilter } from "@/lib/lms/servicesuite-loans";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATUS_TONE: Record<string, string> = {
  ACTIVE: "bg-emerald-100 text-emerald-700",
  PENDING_DISBURSEMENT: "bg-amber-100 text-amber-700",
  PENDING: "bg-amber-100 text-amber-700",
  CLEARED: "bg-ash-900/5 text-ash-500",
  RESTRUCTURED: "bg-sky-100 text-sky-700",
  WRITTEN_OFF: "bg-red-100 text-red-700",
};

/** One row, whichever book it came from. */
type Row = {
  key: string;
  who: string;
  phone: string | null;
  borrowerKey: string | null;
  borrowerHref: string;
  kycVerified: boolean;
  product: string;
  principal: number;
  balance: number;
  status: string;
  bookedAt: string | null;
  statementHref: string | null;
  nextDue: { date: string; amount: number } | null;
  arrears: number;
  daysInArrears: number | null;
};

const fmt = (n: unknown) => `KES ${Math.round(Number(n)).toLocaleString()}`;

export default async function LoansPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const session = await auth();
  if (!session?.user?.orgId) redirect("/login");
  const orgId = session.user.orgId;
  const { status } = await searchParams;

  // ── Which book? ───────────────────────────────────────────────────────────
  const org = session.user.orgSlug ? await resolveOrg(session.user.orgSlug) : null;
  const live = org?.mode === "BRIDGED" && org.bridgedReady && org.registry && org.entityId ? org : null;

  if (live && live.registry) {
    // The live filter vocabulary is the lender's, not ours: their book has no
    // PENDING_DISBURSEMENT or RESTRUCTURED, and "arrears" is a filter here
    // rather than a status because a loan in arrears is still ACTIVE.
    const filter: LiveLoanFilter =
      status === "CLEARED" ? "cleared"
      : status === "PENDING" ? "pending"
      : status === "ARREARS" ? "arrears"
      : status === "ALL" ? "all"
      : "active";

    let rows: Row[] = [];
    let total = 0;
    let stats: Awaited<ReturnType<typeof getLoanBookStats>> | null = null;
    let failure: string | null = null;

    try {
      const [page, book] = await Promise.all([
        listLoansLive(live.registry, live.entityId, { status: filter, take: 100 }),
        getLoanBookStats(live.registry, live.entityId),
      ]);
      total = page.total;
      stats = book;
      rows = page.loans.map((l) => ({
        key: l.ref,
        who: l.borrowerName ?? l.phone ?? `Borrower ${l.borrowerId}`,
        phone: l.phone,
        borrowerKey: null,
        borrowerHref: `/console/borrowers/resolve/${encodeURIComponent(`ss:${l.borrowerId}`)}`,
        // Their book records a verification flag we do not read here; claiming
        // VERIFIED off a loan row would put a tick beside somebody our own KYC
        // has never seen.
        kycVerified: false,
        product: l.product ?? "—",
        principal: l.principal || l.loanAmount,
        balance: l.balance,
        status: l.status,
        bookedAt: l.borrowDate ? l.borrowDate.slice(0, 10) : null,
        // Their statement IS available live — keyed on the borrower, the same
        // way sp_GetCustomerStatement is.
        statementHref: `/console/borrowers/${encodeURIComponent(`ss:${l.borrowerId}`)}/statement`,
        nextDue: l.nextDue,
        arrears: l.arrears,
        daysInArrears: l.daysInArrears,
      }));
    } catch (err) {
      // A bridged read failing is worth saying out loud. An empty table here
      // reads as "this lender has booked no loans", which is a very different
      // and much more alarming claim than "we could not reach their server".
      failure = err instanceof Error ? err.message : "unknown error";
    }

    const filters: { label: string; value?: string; count: number | null }[] = [
      { label: "active", value: undefined, count: stats?.active ?? null },
      { label: "in arrears", value: "ARREARS", count: stats?.inArrears ?? null },
      { label: "pending", value: "PENDING", count: stats?.pending ?? null },
      { label: "cleared", value: "CLEARED", count: stats?.cleared ?? null },
      { label: "all", value: "ALL", count: stats?.total ?? null },
    ];

    return (
      <main className="mx-auto max-w-6xl px-4 sm:px-6 py-8">
        <PageHeader
          icon={Landmark}
          title="Loans"
          subtitle={`Read live from ${live.name}'s own system — balance, next instalment and arrears as they stand now.`}
        />

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">
            <Radio className="h-3 w-3" /> Live · entity {live.entityId}
          </span>
          {stats && (
            <span className="t-meta text-[11px] text-[color:var(--ink-muted)]">
              {stats.total.toLocaleString()} loans · OLB {fmt(stats.olb)} ·{" "}
              {/* Straight off Transactions.dbo.LoansInArrears — the same register
                  Micromart's own dashboard reads, so this figure agrees with
                  theirs instead of being a second opinion about one book. */}
              <strong className="font-semibold text-[color:var(--ink)]">
                {stats.inArrears} in arrears ({fmt(stats.arrearsValue)})
              </strong>
              {stats.worstDpd > 0 && <> · worst {stats.worstDpd}d past due</>}
            </span>
          )}
        </div>

        {failure ? (
          <div className="glass mt-5 p-8 text-center">
            <p className="text-sm font-semibold text-[color:var(--ink)]">
              Could not read {live.name}&rsquo;s loan book
            </p>
            <p className="t-meta mx-auto mt-1.5 max-w-[52ch] text-[12px] text-[color:var(--ink-muted)]">{failure}</p>
          </div>
        ) : (
          <>
            <div className="mt-5 flex flex-wrap gap-1.5">
              {filters.map((f) => {
                const active = (status ?? undefined) === f.value;
                return (
                  <Link
                    key={f.label}
                    href={f.value ? `/console/loans?status=${f.value}` : "/console/loans"}
                    className={`rounded-full px-3 py-1 text-[11px] font-semibold capitalize ${active ? "text-white" : "border border-ash-900/10 bg-paper/70 text-[color:var(--ink-muted)] hover:bg-paper"}`}
                    style={active ? { backgroundColor: "var(--brand)" } : undefined}
                  >
                    {f.label}
                    {f.count != null ? ` · ${f.count.toLocaleString()}` : ""}
                  </Link>
                );
              })}
            </div>

            {rows.length === 0 ? (
              <div className="glass t-meta mt-5 p-8 text-center">No loans in this view.</div>
            ) : (
              <LoanTable rows={rows} portraits={{}} showArrears total={total} />
            )}
          </>
        )}
      </main>
    );
  }

  // ── The local book (NATIVE orgs) — unchanged ──────────────────────────────
  // Whose loans (src/lib/rbac/scope.ts). An OWN-scoped officer's loan list is their own
  // book; a branch manager's is their branch's.
  const scope = await resolveScope(session);
  const where = { orgId, ...loanScopeWhere(scope), ...(status ? { status: status as never } : {}) };
  const [loans, counts] = await Promise.all([
    prisma.loan.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 200,
      select: {
        id: true, principal: true, loanAmount: true, balance: true, status: true, borrowDate: true,
        borrower: { select: { id: true, firstName: true, otherName: true, phone: true, kycStatus: true } },
        product: { select: { name: true } },
      },
    }),
    prisma.loan.groupBy({ by: ["status"], where: { orgId }, _count: true }),
  ]);

  // One batch signature for every face on the page (lib/kyc/avatars).
  const portraits = await portraitsFor(loans.map((l) => l.borrower.id));

  const total = counts.reduce((s, c) => s + c._count, 0);
  const filters: { label: string; value?: string; count: number }[] = [
    { label: "All", value: undefined, count: total },
    ...counts.map((c) => ({ label: c.status.replaceAll("_", " ").toLowerCase(), value: c.status, count: c._count })),
  ];

  const rows: Row[] = loans.map((l) => ({
    key: l.id,
    who: `${l.borrower.firstName ?? ""}${l.borrower.otherName ? ` ${l.borrower.otherName}` : ""}`.trim() || l.borrower.phone,
    phone: l.borrower.phone,
    borrowerKey: l.borrower.id,
    borrowerHref: `/console/borrowers/${l.borrower.id}`,
    kycVerified: l.borrower.kycStatus === "VERIFIED",
    product: l.product.name,
    principal: Number(l.principal),
    balance: Number(l.balance),
    status: l.status,
    bookedAt: l.borrowDate.toISOString().slice(0, 10),
    statementHref: `/console/loans/${l.id}/statement`,
    nextDue: null,
    arrears: 0,
    daysInArrears: null,
  }));

  return (
    <main className="mx-auto max-w-5xl px-4 sm:px-6 py-8">
      <PageHeader
        icon={Landmark}
        title="Loans"
        subtitle="Every booked loan — balance, status, and its printable statement."
      />

      <div className="mt-5 flex flex-wrap gap-1.5">
        {filters.map((f) => {
          const active = (status ?? undefined) === f.value;
          return (
            <Link
              key={f.label}
              href={f.value ? `/console/loans?status=${f.value}` : "/console/loans"}
              className={`rounded-full px-3 py-1 text-[11px] font-semibold capitalize ${active ? "text-white" : "border border-ash-900/10 bg-paper/70 text-[color:var(--ink-muted)] hover:bg-paper"}`}
              style={active ? { backgroundColor: "var(--brand)" } : undefined}
            >
              {f.label} · {f.count}
            </Link>
          );
        })}
      </div>

      {rows.length === 0 ? (
        <div className="glass t-meta mt-5 p-8 text-center">
          No loans {status ? `with status ${status.replaceAll("_", " ").toLowerCase()}` : "booked yet"}.
        </div>
      ) : (
        <LoanTable rows={rows} portraits={portraits} showArrears={false} total={rows.length} />
      )}
    </main>
  );
}

/** One table for both books. The arrears columns only appear where the numbers
 *  are real — an empty "Arrears" column on the local path would read as "nobody
 *  is behind" rather than "this book does not compute it here". */
function LoanTable({
  rows,
  portraits,
  showArrears,
  total,
}: {
  rows: Row[];
  portraits: Record<string, string | null>;
  showArrears: boolean;
  total: number;
}) {
  return (
    <>
      <div className="glass mt-5 overflow-x-auto">
        <table className="data-table text-sm">
          <thead>
            <tr>
              <th>Borrower</th>
              <th>Product</th>
              <th className="num">Principal</th>
              <th className="num">Balance</th>
              {showArrears && <th>Next due</th>}
              {showArrears && <th className="num">Arrears</th>}
              <th>Status</th>
              <th>Booked</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <td>
                  <Link href={r.borrowerHref} className="group/b flex items-center gap-2.5">
                    <BorrowerAvatar
                      name={r.who}
                      portraitUrl={(r.borrowerKey && portraits[r.borrowerKey]) || null}
                      verified={r.kycVerified}
                      size="sm"
                    />
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-[color:var(--ink)] group-hover/b:underline">{r.who}</span>
                      <span className="block text-[11px] text-[color:var(--ink-muted)]">{r.phone}</span>
                    </span>
                  </Link>
                </td>
                <td>{r.product}</td>
                <td className="num">{fmt(r.principal)}</td>
                <td className="num font-semibold text-[color:var(--ink)]">{fmt(r.balance)}</td>
                {showArrears && (
                  <td className="t-num text-[11px]">
                    {r.nextDue ? (
                      <>
                        <span className="block text-[color:var(--ink)]">{r.nextDue.date}</span>
                        <span className="block text-[color:var(--ink-muted)]">{fmt(r.nextDue.amount)}</span>
                      </>
                    ) : (
                      <span className="text-[color:var(--ink-muted)]">—</span>
                    )}
                  </td>
                )}
                {showArrears && (
                  <td className="num">
                    {r.arrears > 0 ? (
                      <span className="font-semibold text-red-600">
                        {fmt(r.arrears)}
                        <span className="block text-[10px] font-normal text-red-500">{r.daysInArrears}d late</span>
                      </span>
                    ) : (
                      <span className="text-[color:var(--ink-muted)]">—</span>
                    )}
                  </td>
                )}
                <td>
                  <span className={`rounded-md px-2 py-0.5 text-[10px] font-semibold capitalize ${STATUS_TONE[r.status] ?? "bg-ash-900/5 text-ash-600"}`}>
                    {r.status.replaceAll("_", " ").toLowerCase()}
                  </span>
                </td>
                <td className="t-num text-[11px] text-[color:var(--ink-muted)]">{r.bookedAt ?? "—"}</td>
                <td>
                  {r.statementHref ? (
                    <Link href={r.statementHref} className="inline-flex items-center gap-1 text-[11px] font-semibold hover:underline" style={{ color: "var(--brand)" }}>
                      <FileText className="h-3.5 w-3.5" /> Statement
                    </Link>
                  ) : (
                    <Link href={r.borrowerHref} className="inline-flex items-center gap-1 text-[11px] font-semibold hover:underline" style={{ color: "var(--brand)" }}>
                      Open customer
                    </Link>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {rows.length < total && (
        <p className="t-meta mt-2 px-1 text-[11px] text-[color:var(--ink-muted)]">
          Showing {rows.length.toLocaleString()} of {total.toLocaleString()}.
        </p>
      )}
    </>
  );
}
