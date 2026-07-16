// ─────────────────────────────────────────────────────────────────────────────
// THE SHARING POOL — the group's one borrower reality.
//
// A group that runs several lending entities (Micromart, Axe, …) needs two
// things across them: a customer with a RUNNING loan at a sibling must not be
// lent to again (the group lends once at a time), and a customer the group
// already onboarded should not re-introduce themselves at the next counter.
//
// THIS FILE IS THE ONLY PLACE THE TENANT FENCE IS CROSSED FOR IT. Every
// function here runs its sibling reads under runAsPlatform() — the same
// deliberate escape hatch the crons use — against ONLY the orgs in the
// caller's own pool, and returns the MINIMUM that the purpose needs:
//   · the elsewhere-check returns a lender name and a count. Never a balance,
//     never a product, never a schedule.
//   · pool search returns identity + KYC standing + an active-loan flag —
//     what a counter needs to serve them, nothing a competitor would want.
// The pool row carries `legalBasis` — the actual clause that makes the
// sharing lawful (DPA 2019: consent given at onboarding to the group, plus
// the legitimate interest of not over-lending). Surfaces SHOW it; a signal
// with no stated basis is a leak, not a feature.
//
// Set a pool up with:  npm run pool:setup -- "<group name>" <slug> <slug> …
// ─────────────────────────────────────────────────────────────────────────────
// The SCOPED client, always: under runAsPlatform it stamps app.platform=on,
// which is what lets the query cross tenants. rawPrisma never stamps anything,
// and FORCE'd RLS silently returns zero rows to it — the bug test:pool caught.
import { prisma } from "@/lib/prisma";
import { runAsPlatform } from "@/lib/db/context";

export type PoolInfo = {
  id: string;
  name: string;
  legalBasis: string;
  /** The OTHER members — the caller's own org is never its own sibling. */
  siblings: { orgId: string; name: string; slug: string }[];
};

/** The caller's pool, or null when they never joined one (the common case). */
export async function poolFor(orgId: string): Promise<PoolInfo | null> {
  return runAsPlatform(async () => {
    const member = await prisma.sharingPoolMember.findUnique({
      where: { orgId },
      include: { pool: { include: { members: { include: { org: { select: { id: true, name: true, slug: true } } } } } } },
    });
    if (!member) return null;
    return {
      id: member.pool.id,
      name: member.pool.name,
      legalBasis: member.pool.legalBasis,
      siblings: member.pool.members
        .filter((m) => m.orgId !== orgId)
        .map((m) => ({ orgId: m.org.id, name: m.org.name, slug: m.org.slug })),
    };
  });
}

const last9 = (phone: string | null | undefined) => (phone ?? "").replace(/\D/g, "").slice(-9);

export type ElsewhereVerdict =
  | { blocked: false }
  | { blocked: true; lender: string; activeLoans: number; legalBasis: string };

/**
 * Does this person have a RUNNING loan at a sibling entity?
 *
 * Matched by national ID when we have one (the strong key), else by the last
 * nine digits of the phone (how the funnel itself matches returning
 * borrowers). This is the "active loan elsewhere" gate both application roads
 * enforce — the answer is a name and a count, never the sibling's book.
 */
export async function activeLoanElsewhere(
  orgId: string,
  ident: { nationalId?: string | null; phone?: string | null },
): Promise<ElsewhereVerdict> {
  const pool = await poolFor(orgId);
  if (!pool || pool.siblings.length === 0) return { blocked: false };

  const phone9 = last9(ident.phone);
  const nationalId = ident.nationalId?.trim() || null;
  if (!nationalId && !phone9) return { blocked: false };

  return runAsPlatform(async () => {
    const twin = await prisma.borrower.findFirst({
      where: {
        orgId: { in: pool.siblings.map((s) => s.orgId) },
        OR: [
          ...(nationalId ? [{ nationalId }] : []),
          ...(phone9 ? [{ phone: { endsWith: phone9 } }] : []),
        ],
        loans: { some: { status: { in: ["ACTIVE", "PENDING_DISBURSEMENT"] } } },
      },
      select: {
        orgId: true,
        _count: { select: { loans: { where: { status: { in: ["ACTIVE", "PENDING_DISBURSEMENT"] } } } } },
      },
    });
    if (!twin) return { blocked: false };
    const lender = pool.siblings.find((s) => s.orgId === twin.orgId)?.name ?? "a sibling entity";
    return { blocked: true, lender, activeLoans: twin._count.loans, legalBasis: pool.legalBasis };
  });
}

export type PoolCustomer = {
  sourceBorrowerId: string;
  sourceOrg: { name: string; slug: string };
  name: string;
  phone: string;
  nationalId: string | null;
  kycVerified: boolean;
  activeLoansThere: number;
  /** Already on the caller's own book (matched by phone/ID) — pick that instead. */
  alreadyLocal: boolean;
};

/**
 * Search the group's customers at SIBLING entities. What comes back is what a
 * counter needs to recognise and serve the person — never their balances.
 */
export async function searchPool(orgId: string, q: string): Promise<{ pool: PoolInfo; customers: PoolCustomer[] } | null> {
  const pool = await poolFor(orgId);
  if (!pool || pool.siblings.length === 0) return null;
  const needle = q.trim();
  if (needle.length < 2) return { pool, customers: [] };
  const digits = needle.replace(/\D/g, "");

  return runAsPlatform(async () => {
    const hits = await prisma.borrower.findMany({
      where: {
        orgId: { in: pool.siblings.map((s) => s.orgId) },
        erasedAt: null,
        OR: [
          { firstName: { contains: needle, mode: "insensitive" } },
          { otherName: { contains: needle, mode: "insensitive" } },
          ...(digits.length >= 4 ? [{ phone: { contains: digits } }, { nationalId: { contains: digits } }] : []),
        ],
      },
      select: {
        id: true, orgId: true, firstName: true, otherName: true, phone: true, nationalId: true,
        kycStatus: true,
        _count: { select: { loans: { where: { status: { in: ["ACTIVE", "PENDING_DISBURSEMENT"] } } } } },
      },
      take: 8,
    });

    // Flag the ones the caller already has, so the counter picks the local row.
    const phones = hits.map((h) => last9(h.phone)).filter(Boolean);
    const ids = hits.map((h) => h.nationalId).filter((x): x is string => !!x);
    const local = phones.length || ids.length
      ? await prisma.borrower.findMany({
          where: { orgId, OR: [...phones.map((p) => ({ phone: { endsWith: p } })), ...(ids.length ? [{ nationalId: { in: ids } }] : [])] },
          select: { phone: true, nationalId: true },
        })
      : [];
    const localPhones = new Set(local.map((l) => last9(l.phone)));
    const localIds = new Set(local.map((l) => l.nationalId).filter(Boolean));

    const orgName = new Map(pool.siblings.map((s) => [s.orgId, { name: s.name, slug: s.slug }]));
    return {
      pool,
      customers: hits.map((h) => ({
        sourceBorrowerId: h.id,
        sourceOrg: orgName.get(h.orgId) ?? { name: "sibling", slug: "" },
        name: [h.firstName, h.otherName].filter(Boolean).join(" ") || h.phone,
        phone: h.phone,
        nationalId: h.nationalId,
        kycVerified: h.kycStatus === "VERIFIED",
        activeLoansThere: h._count.loans,
        alreadyLocal: localPhones.has(last9(h.phone)) || (!!h.nationalId && localIds.has(h.nationalId)),
      })),
    };
  });
}

/**
 * Bring a sibling's customer onto the caller's book so an application can be
 * taken — identity, contact, and consented location come across; KYC standing
 * comes across AS A FACT ABOUT THE GROUP (kycStatus mirrored, artifacts do
 * NOT — the images belong to the entity that captured them). Idempotent: if a
 * local twin already exists (by ID or phone), it is returned untouched.
 */
export async function importFromPool(orgId: string, sourceBorrowerId: string): Promise<
  { ok: true; borrowerId: string; imported: boolean; sourceOrg: string } | { ok: false; message: string }
> {
  const pool = await poolFor(orgId);
  if (!pool || pool.siblings.length === 0) return { ok: false, message: "This lender is not in a sharing pool." };

  const source = await runAsPlatform(() =>
    prisma.borrower.findFirst({
      where: { id: sourceBorrowerId, orgId: { in: pool.siblings.map((s) => s.orgId) }, erasedAt: null },
    }),
  );
  if (!source) return { ok: false, message: "That customer is not in the group's pool." };
  const sourceOrg = pool.siblings.find((s) => s.orgId === source.orgId)?.name ?? "a sibling entity";

  // A local twin wins over a fresh copy, always — one person, one row per book.
  const twin = await prisma.borrower.findFirst({
    where: {
      orgId,
      OR: [
        ...(source.nationalId ? [{ nationalId: source.nationalId }] : []),
        { phone: { endsWith: last9(source.phone) } },
      ],
    },
    select: { id: true },
  });
  if (twin) return { ok: true, borrowerId: twin.id, imported: false, sourceOrg };

  const created = await prisma.borrower.create({
    data: {
      orgId,
      phone: source.phone,
      nationalId: source.nationalId,
      firstName: source.firstName,
      otherName: source.otherName,
      email: source.email,
      dob: source.dob,
      gender: source.gender,
      language: source.language,
      // The group already verified this person; the standing is mirrored, the
      // artifacts are not — selfies and ID scans stay with the entity that
      // captured them, and this entity re-captures if it ever needs its own.
      kycStatus: source.kycStatus,
      kycVerifiedAt: source.kycVerifiedAt,
      iprsVerified: source.iprsVerified,
      // The consented location snapshot travels with the consent that made it.
      lat: source.lat, lng: source.lng, locationType: source.locationType, locationAddress: source.locationAddress,
      homeLat: source.homeLat, homeLng: source.homeLng, homeAddress: source.homeAddress,
      geoConsentAt: source.geoConsentAt,
    },
    select: { id: true },
  });
  return { ok: true, borrowerId: created.id, imported: true, sourceOrg };
}
