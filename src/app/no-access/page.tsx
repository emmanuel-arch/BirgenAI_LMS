// ─────────────────────────────────────────────────────────────────────────────
// SIGNED IN, AND NOWHERE TO GO.
//
// Reached only when somebody authenticates successfully and holds no system
// this deployment can put them inside — every one switched off for their
// organisation, or every one denied for them personally. It is rare and it is
// real, and before this page existed it had no landing: the launcher used to
// absorb the case by rendering an empty grid.
//
// ── WHY IT IS A PAGE AND NOT A REDIRECT TO SIGN-IN ───────────────────────────
// The person IS authenticated. Bouncing them back to a login card to tell them
// their administrator has switched everything off reads as a rejected password,
// which sends them round the loop again and produces the wrong support ticket.
// It also gates nothing, which is what makes it safe as the terminal fallback in
// lib/suite/landing.ts — every other candidate landing is a guarded layout, and
// a guard that redirects to a guard is how an infinite loop gets built.
//
// It says who they are signed in as, because the commonest cause is signing in
// with the wrong one of two accounts.
// ─────────────────────────────────────────────────────────────────────────────
import Link from "next/link";
import { redirect } from "next/navigation";
import { ShieldOff } from "lucide-react";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import SignOut from "./SignOut";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function NoAccess() {
  const session = await auth();
  // Not signed in at all — this page has nothing to tell them.
  if (!session?.user?.orgId) redirect("/login");

  const org = await prisma.org.findUnique({
    where: { id: session.user.orgId },
    select: { name: true, slug: true },
  });

  const who = session.user.name ?? session.user.email ?? "You";

  return (
    <main className="grid min-h-screen place-items-center bg-ash-50 px-5 py-12">
      <div className="w-full max-w-md rounded-3xl border border-ash-900/10 bg-paper p-7 shadow-xl shadow-ash-900/5">
        <span className="grid h-11 w-11 place-items-center rounded-2xl bg-amber-500/12 text-amber-700">
          <ShieldOff className="h-5 w-5" />
        </span>

        <h1 className="mt-4 text-[19px] font-bold leading-tight tracking-tight text-ash-900">
          No systems are open to you yet
        </h1>
        <p className="mt-2 text-[13.5px] leading-relaxed text-ash-600">
          You are signed in as <strong className="font-semibold text-ash-800">{who}</strong>
          {org ? <> at <strong className="font-semibold text-ash-800">{org.name}</strong></> : null}, and the
          password was right — but no system in the suite is switched on for this account.
        </p>
        <p className="mt-3 text-[13px] leading-relaxed text-ash-500">
          Your organisation&apos;s administrator sets this, per person, under Team &amp; Access. If you
          hold a second account, sign out and use that one.
        </p>

        <div className="mt-6 flex flex-wrap items-center gap-2">
          <SignOut backTo={org?.slug ? `/${org.slug}` : "/login"} />
          <Link
            href={org?.slug ? `/${org.slug}` : "/login"}
            className="rounded-xl border border-ash-900/12 px-4 py-2.5 text-[13px] font-semibold text-ash-600 transition-colors hover:text-ash-900"
          >
            Back to sign in
          </Link>
        </div>
      </div>
    </main>
  );
}
