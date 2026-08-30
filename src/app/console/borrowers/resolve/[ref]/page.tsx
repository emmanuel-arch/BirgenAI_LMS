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
import { redirect } from "next/navigation";
import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { auth } from "@/lib/auth";
import { requireRight } from "@/lib/rbac/authz";
import { prisma } from "@/lib/prisma";
import { resolveOrg } from "@/lib/tenancy";
import { originStamp } from "@/lib/rbac/scope";
import { getLiveBorrowerById } from "@/lib/lms/servicesuite";
import { normaliseBandName } from "@/lib/risk/bands";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Digits-only, the way the Borrower table stores them (2547XXXXXXXX). */
const cleanPhone = (p: string) => p.replace(/\D/g, "");

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

  const orgId = session.user.orgId;
  const { ref } = await params;

  // WHY the resolver reads a query string at all: an officer arriving from the
  // needs-location worklist came here to do ONE thing, and the resolve step is a
  // hop they never asked for. Carrying the intent across it means Customer 360
  // opens on the pin rather than on its front page. Allow-listed, because this
  // value is appended to a redirect target.
  const intent = (await searchParams)?.drop;
  const drop = intent === "location" ? "?drop=location" : "";

  // "ss:168346" — anything else is not a live ref.
  const match = decodeURIComponent(ref).match(/^ss:(\d+)$/);
  if (!match) {
    return <Problem title="That customer reference is not valid" detail={`"${decodeURIComponent(ref)}" is not a live customer reference. Open the customer from the book so the reference is carried correctly.`} />;
  }
  const serviceSuiteId = Number(match[1]);

  const org = session.user.orgSlug ? await resolveOrg(session.user.orgSlug) : null;
  if (!org?.registry || !org.bridgedReady || !org.entityId) {
    return <Problem title="This lender's book is not connected" detail="Live customers can only be opened while the connection to the lender's own system is configured and reachable. Reconnect it, then try again." />;
  }

  // `resolvedId` is set inside the try; redirect() must be called OUTSIDE it,
  // because redirect() works by throwing and a catch would swallow it.
  let resolvedId: string | null = null;
  let failure: { title: string; detail: string } | null = null;

  try {
    const seed = await getLiveBorrowerById(org.registry, org.entityId, serviceSuiteId);
    if (!seed) {
      failure = {
        title: "That customer is no longer in the lender's book",
        detail: `Customer ${serviceSuiteId} was not found in entity ${org.entityId}. They may have been moved to another entity or removed since the list was loaded.`,
      };
    } else {
      const phone = cleanPhone(seed.phone ?? "");
      if (phone.length < 9) {
        failure = {
          title: "This customer has no usable phone number",
          detail: "Their record in the lender's system has no valid mobile number, and a customer is identified by phone here. Correct it in ServiceSuite first — every message, OTP and repayment depends on it.",
        };
      } else {
        // Fields the LENDER owns are refreshed on every open; fields WE own
        // (KYC state, pins, consent) are only ever set by our own pipeline and
        // are deliberately absent from the update below.
        const lenderOwned = {
          firstName: seed.firstName,
          otherName: seed.otherName,
          nationalId: seed.nationalId,
          email: seed.email,
          dob: seed.dob ? new Date(seed.dob) : null,
          gender: seed.gender,
          creditScore: seed.creditScore != null ? Math.round(seed.creditScore) : null,
          riskBand: seed.riskCategory ? normaliseBandName(seed.riskCategory) : null,
          loanLimit: seed.loanLimit,
          previousLoanLimit: seed.previousLoanLimit,
          graduationCount: seed.graduationCount,
        };

        const existing = await prisma.borrower.findUnique({
          where: { orgId_phone: { orgId, phone } },
          select: { id: true },
        });

        if (existing) {
          await prisma.borrower.update({ where: { id: existing.id }, data: lenderOwned });
          resolvedId = existing.id;
        } else {
          // The officer who opens them owns them, so an OWN-scoped officer keeps
          // seeing their own book (lib/rbac/scope.ts).
          const me = await prisma.staffUser.findFirst({
            where: { id: session.user.id, orgId },
            select: { id: true, branchId: true },
          });
          const origin = await originStamp(orgId, me);
          const created = await prisma.borrower.create({
            data: {
              orgId,
              createdById: origin.staffId,
              branchId: origin.branchId,
              phone,
              language: "en",
              ...lenderOwned,
            },
            select: { id: true },
          });
          resolvedId = created.id;

          await prisma.auditLog.create({
            data: {
              orgId,
              actorId: session.user.id,
              actorType: "staff",
              action: "borrower.resolve",
              entity: "Borrower",
              entityId: created.id,
              meta: {
                channel: "console",
                source: "servicesuite",
                entityId: org.entityId,
                serviceSuiteBorrowerId: serviceSuiteId,
                accountNo: seed.accountNo,
                phone,
              },
            },
          }).catch(() => {});
        }
      }
    }
  } catch (err) {
    failure = {
      title: "Could not read that customer from the lender's system",
      detail: err instanceof Error ? err.message : "The lender's database did not answer. Try again in a moment.",
    };
  }

  if (failure) return <Problem {...failure} />;
  redirect(`/console/borrowers/${resolvedId}${drop}`);
}
