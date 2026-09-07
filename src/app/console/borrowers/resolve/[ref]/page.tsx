// Open a customer from the LENDER'S live book.
//
// A bridged lender's borrower list is read through to their ServiceSuite, so its
// rows carry `ss:<id>` refs rather than LMS uuids. Customer 360 cannot be rendered
// from such a ref: the whole page is our machinery — KYC gallery, early warning,
// the graduation ladder, field visits, applications, consent history — and none of
// that exists for someone who has never been through our funnel.
//
// So opening a live customer is an explicit RESOLVE step, not a silent lookup:
// seed a local record from the lender's own data, then hand off to the canonical
// /console/borrowers/<uuid> page, which is unchanged.
//
// WHY A WRITE HAPPENS HERE, AND WHY IT IS NOT A MIRROR. We deliberately do NOT copy
// 17,017 borrowers into Postgres — the book is read live so it can never go stale.
// A record is created only for a customer an officer actually opens to work, which
// is the same bargain `ensureBorrower` strikes in the other direction when it
// registers OUR customer in THEIR ledger. Browsing costs nothing; working a
// customer creates the record that KYC, applications and pins hang off.
//
// Idempotent: keyed on (orgId, phone), so re-opening finds the existing record and
// refreshes the lender-owned fields rather than duplicating anyone.
//
// THE RESOLUTION ITSELF NO LONGER LIVES HERE. It moved to
// lib/lms/resolve-live-borrower.ts when Apply for a Borrower needed the same step
// and could not call a page; this file is now the Customer-360 door onto it.
import { redirect } from "next/navigation";
import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { auth } from "@/lib/auth";
import { requireRight } from "@/lib/rbac/authz";
import { resolveOrg } from "@/lib/tenancy";
import { parseLiveRef, resolveLiveBorrower } from "@/lib/lms/resolve-live-borrower";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function Problem({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="mx-auto max-w-lg px-6 py-16">
      <div className="glass rounded-2xl p-6">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full bg-amber-100 text-amber-700">
            <ShieldAlert className="h-4.5 w-4.5" aria-hidden />
          </span>
          <div className="min-w-0">
            <h1 className="text-base font-semibold text-ash-900">{title}</h1>
            <p className="mt-1 text-sm leading-relaxed text-ash-600">{detail}</p>
            <Link
              href="/console/borrowers"
              className="mt-4 inline-flex items-center rounded-lg bg-invert px-3.5 py-2 text-xs font-semibold text-invert-fg hover:bg-invert-2"
            >
              Back to the customer book
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

export default async function ResolveLiveBorrower({
  params,
  searchParams,
}: {
  params: Promise<{ ref: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const session = await auth();
  if (!session?.user?.orgId) redirect("/login");
  const denied = await requireRight(session, "borrowers.view");
  if (denied) redirect("/console/borrowers");

  const { ref } = await params;

  // WHY the resolver reads a query string at all: an officer arriving from the
  // needs-location worklist came here to do ONE thing, and the resolve step is a
  // hop they never asked for. Carrying the intent across it means Customer 360
  // opens on the pin rather than on its front page. Allow-listed, because this
  // value is appended to a redirect target.
  const intent = (await searchParams)?.drop;
  const drop = intent === "location" ? "?drop=location" : "";

  // "ss:168346" — anything else is not a live ref.
  const serviceSuiteId = parseLiveRef(ref);
  if (serviceSuiteId == null) {
    return <Problem title="That customer reference is not valid" detail={`"${decodeURIComponent(ref)}" is not a live customer reference. Open the customer from the book so the reference is carried correctly.`} />;
  }

  const org = session.user.orgSlug ? await resolveOrg(session.user.orgSlug) : null;
  if (!org) {
    return <Problem title="This lender's book is not connected" detail="Live customers can only be opened while the connection to the lender's own system is configured and reachable. Reconnect it, then try again." />;
  }
  // The resolution itself lives in lib/lms/resolve-live-borrower.ts, because the
  // Apply-for-a-Borrower screen has to perform exactly the same step and cannot
  // call a page. redirect() must be reached OUTSIDE any try, since it works by
  // throwing and a catch would swallow it — so the outcome is inspected first.
  const outcome = await resolveLiveBorrower(org, serviceSuiteId, { id: session.user.id });
  if (!outcome.ok) return <Problem title={outcome.title} detail={outcome.detail} />;

  redirect(`/console/borrowers/${outcome.borrowerId}${drop}`);
}
