// Loans List — the booked book, one row per loan, statement a click away.
// The applications queue shows what WANTS to be a loan; this shows what IS one.
import { redirect } from "next/navigation";
import Link from "next/link";
import { Landmark, FileText } from "lucide-react";
import { auth } from "@/lib/auth";
import { resolveScope, loanScopeWhere } from "@/lib/rbac/scope";
import { prisma } from "@/lib/prisma";
import { portraitsFor } from "@/lib/kyc/avatars";
import { BorrowerAvatar } from "@/components/kyc/BorrowerAvatar";
import { PageHeader } from "@/components/shell/PageHeader";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATUS_TONE: Record<string, string> = {
  ACTIVE: "bg-emerald-100 text-emerald-700",
  PENDING_DISBURSEMENT: "bg-amber-100 text-amber-700",
  CLEARED: "bg-zinc-900/5 text-zinc-500",
  RESTRUCTURED: "bg-sky-100 text-sky-700",
  WRITTEN_OFF: "bg-red-100 text-red-700",
};

export default async function LoansPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const session = await auth();
  if (!session?.user?.orgId) redirect("/login");
  const orgId = session.user.orgId;
  const { status } = await searchParams;

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
  const fmt = (n: unknown) => `KES ${Math.round(Number(n)).toLocaleString()}`;
  const filters: { label: string; value?: string; count: number }[] = [
    { label: "All", value: undefined, count: total },
    ...counts.map((c) => ({ label: c.status.replaceAll("_", " ").toLowerCase(), value: c.status, count: c._count })),
  ];

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
              className={`rounded-full px-3 py-1 text-[11px] font-semibold capitalize ${active ? "text-white" : "border border-zinc-900/10 bg-white/70 text-[color:var(--ink-muted)] hover:bg-white"}`}
              style={active ? { backgroundColor: "var(--brand)" } : undefined}
            >
              {f.label} · {f.count}
            </Link>
          );
        })}
      </div>

      {loans.length === 0 ? (
        <div className="glass t-meta mt-5 p-8 text-center">
          No loans {status ? `with status ${status.replaceAll("_", " ").toLowerCase()}` : "booked yet"}.
        </div>
      ) : (
        <div className="glass mt-5 overflow-x-auto">
          <table className="data-table text-sm">
            <thead>
              <tr>
                <th>Borrower</th>
                <th>Product</th>
                <th className="num">Principal</th>
                <th className="num">Balance</th>
                <th>Status</th>
                <th>Booked</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {loans.map((l) => {
                const who = `${l.borrower.firstName ?? ""}${l.borrower.otherName ? ` ${l.borrower.otherName}` : ""}`.trim() || l.borrower.phone;
                return (
                <tr key={l.id}>
                  <td>
                    <Link href={`/console/borrowers/${l.borrower.id}`} className="group/b flex items-center gap-2.5">
                      <BorrowerAvatar
                        name={who}
                        portraitUrl={portraits[l.borrower.id] ?? null}
                        verified={l.borrower.kycStatus === "VERIFIED"}
                        size="sm"
                      />
                      <span className="min-w-0">
                        <span className="block truncate font-medium text-[color:var(--ink)] group-hover/b:underline">{who}</span>
                        <span className="block text-[11px] text-[color:var(--ink-muted)]">{l.borrower.phone}</span>
                      </span>
                    </Link>
                  </td>
                  <td>{l.product.name}</td>
                  <td className="num">{fmt(l.principal)}</td>
                  <td className="num font-semibold text-[color:var(--ink)]">{fmt(l.balance)}</td>
                  <td>
                    <span className={`rounded-md px-2 py-0.5 text-[10px] font-semibold capitalize ${STATUS_TONE[l.status] ?? "bg-zinc-900/5 text-zinc-600"}`}>
                      {l.status.replaceAll("_", " ").toLowerCase()}
                    </span>
                  </td>
                  <td className="t-num text-[11px] text-[color:var(--ink-muted)]">{l.borrowDate.toISOString().slice(0, 10)}</td>
                  <td>
                    <Link href={`/console/loans/${l.id}/statement`} className="inline-flex items-center gap-1 text-[11px] font-semibold hover:underline" style={{ color: "var(--brand)" }}>
                      <FileText className="h-3.5 w-3.5" /> Statement
                    </Link>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
