// Riri's first words. GET → the welcome, and the next thing worth doing.
//
// The founder's ask, and it is the right one: a new admin lands in a console with
// eleven menus and no idea which one comes first. Nobody reads a setup guide. But
// almost everybody will read one sentence from someone who appears to know where they
// are — so Riri greets them by name and offers the ONE next step, in the order that
// actually works (you cannot invite staff into branches that do not exist).
//
// Read live from the org, never from a stored "onboarding step" counter: a checklist
// that claims you have no products when you just made one is worse than no checklist,
// and the founder will do things out of order precisely because they are the founder.
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { setupState, welcome } from "@/lib/riri/support";

export const runtime = "nodejs";

export async function GET() {
  const session = await auth();
  if (!session?.user?.orgId) return NextResponse.json({ success: false, message: "Sign in." }, { status: 401 });
  const orgId = session.user.orgId;

  const [org, setup] = await Promise.all([
    prisma.org.findUnique({ where: { id: orgId }, select: { name: true } }),
    setupState(orgId),
  ]);

  const first = session.user.name?.trim().split(/\s+/)[0] ?? null;
  const r = welcome(first, org?.name ?? "your lender", setup);

  return NextResponse.json({
    success: true,
    model: "support",
    mode: "live",
    route: "knowledge",
    kind: "welcome",
    answer: r.answer,
    actions: r.actions,
    suggestions: r.suggestions,
    setupComplete: !setup.next,
  });
}
