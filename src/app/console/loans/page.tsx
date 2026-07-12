// Loans List — the booked book, one row per loan, statement a click away.
// The applications queue shows what WANTS to be a loan; this shows what IS one.
import { redirect } from "next/navigation";
import Link from "next/link";
import { Landmark, FileText } from "lucide-react";
import { auth } from "@/lib/auth";
import { resolveScope, loanScopeWhere } from "@/lib/rbac/scope";
import { prisma } from "@/lib/prisma";

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
        borrower: { select: { firstName: true, otherName: true, phone: true } },
        product: { select: { name: true } },
      },
    }),
    prisma.loan.groupBy({ by: ["status"], where: { orgId }, _count: true }),
  ]);

  const total = counts.reduce((s, c) => s + c._count, 0);
  const fmt = (n: unknown) => `KES ${Math.round(Number(n)).toLocaleString()}`;
  const filters: { label: string; value?: string; count: number }[] = [
    { label: "All", value: undefined, count: total },
    ...counts.map((c) => ({ label: c.status.replaceAll("_", " ").toLowerCase(), value: c.status, count: c._count })),
  ];

  return (
    <main className="mx-auto max-w-5xl px-4 sm:px-6 py-8">
      <h1 className="text-xl font-bold flex items-center gap-2">
        <Landmark className="h-5 w-5" style={{ color: "var(--brand)" }} /> Loans
      </h1>
      <p className="mt-1 text-sm text-zinc-500">Every booked loan — balance, status, and its printable statement.</p>

      <div className="mt-4 flex flex-wrap gap-1.5">
        {filters.map((f) => {
          const active = (status ?? undefined) === f.value;
          return (
            <Link
              key={f.label}
              href={f.value ? `/console/loans?status=${f.value}` : "/console/loans"}
              className={`rounded-full px-3 py-1 text-[11px] font-semibold capitalize ${active ? "text-white" : "bg-white/70 text-zinc-600 border border-zinc-900/10 hover:bg-white"}`}
              style={active ? { backgroundColor: "var(--brand)" } : undefined}
            >
              {f.label} · {f.count}
            </Link>
          );
        })}
      </div>

      {loans.length === 0 ? (
        <div className="glass mt-5 p-8 text-center text-sm text-zinc-500">
          No loans {status ? `with status ${status.replaceAll("_", " ").toLowerCase()}` : "booked yet"}.
        </div>
      ) : (
        <div className="glass mt-5 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-900/10 text-[10px] uppercase tracking-wide text-zinc-500">
                <th className="px-4 py-3">Borrower</th>
                <th className="px-4 py-3">Product</th>
                <th className="px-4 py-3 text-right">Principal</th>
                <th className="px-4 py-3 text-right">Balance</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Booked</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {loans.map((l) => (
                <tr key={l.id} className="border-b border-zinc-900/5 last:border-0 hover:bg-white/60">
                  <td className="px-4 py-2.5">
                    <p className="font-medium">{l.borrower.firstName}{l.borrower.otherName ? ` ${l.borrower.otherName}` : ""}</p>
                    <p className="text-[11px] text-zinc-500">{l.borrower.phone}</p>
                  </td>
                  <td className="px-4 py-2.5 text-zinc-600">{l.product.name}</td>
                  <td className="px-4 py-2.5 text-right">{fmt(l.principal)}</td>
                  <td className="px-4 py-2.5 text-right font-semibold">{fmt(l.balance)}</td>
                  <td className="px-4 py-2.5">
                    <span className={`rounded-md px-2 py-0.5 text-[10px] font-semibold capitalize ${STATUS_TONE[l.status] ?? "bg-zinc-900/5 text-zinc-500"}`}>
                      {l.status.replaceAll("_", " ").toLowerCase()}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-[11px] text-zinc-500">{l.borrowDate.toISOString().slice(0, 10)}</td>
                  <td className="px-4 py-2.5">
                    <Link href={`/console/loans/${l.id}/statement`} className="inline-flex items-center gap-1 text-[11px] font-semibold hover:underline" style={{ color: "var(--brand)" }}>
                      <FileText className="h-3.5 w-3.5" /> Statement
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
