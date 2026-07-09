// Console shell layout. Its one job today is to mount Riri once for the whole
// console: because a layout persists across route changes, her conversation and
// position survive navigation between modules. The org accent is set here so the
// floating dock (a fixed child of this wrapper) inherits --brand everywhere.
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import RiriDock from "@/components/riri/RiriDock";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  const org = session?.user?.orgId
    ? await prisma.org.findUnique({ where: { id: session.user.orgId }, select: { name: true, accent: true, accentSoft: true } })
    : null;

  // Not signed in (the child page redirects to /login): render bare, no dock.
  if (!org) return <>{children}</>;

  return (
    <div style={{ ["--brand" as never]: org.accent, ["--brand-soft" as never]: org.accentSoft }}>
      {children}
      <RiriDock orgName={org.name} userName={session?.user?.name ?? null} />
    </div>
  );
}
