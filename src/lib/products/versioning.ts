// ─────────────────────────────────────────────────────────────────────────────
// PRODUCT VERSIONING — publish, diff, and know the blast radius before you press.
//
// The rule this file exists to enforce: A PRODUCT EDIT IS A NEW VERSION, NEVER AN
// OVERWRITE. In the system we are replacing, `Loan` points at the product row, so
// changing a rate on Tuesday silently rewrites what Monday's borrowers agreed to.
// Nobody is lying — the data simply cannot express the difference between "the terms
// now" and "the terms then", so the audit answer and the screen answer diverge and
// there is no way to tell which is true.
//
// Publishing does three things in ONE transaction:
//   1. writes an immutable `ProductVersion` snapshot of the whole definition,
//   2. bumps `Product.version`,
//   3. re-projects the definition onto the flat `Product` columns, so every query
//      written before versioning existed keeps working unchanged.
//
// Loans and applications stamp `productVersionId` at creation, so each one can always
// answer what it agreed to — even after the product has moved on ten versions.
// ─────────────────────────────────────────────────────────────────────────────
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { runWithOrg } from "@/lib/db/context";
import {
  BLOCK_KEYS, mergeProduct, projectToColumns, validateProduct, definitionFromColumns,
  type BlockKey, type ProductDefinition, type ProductIssue,
} from "./definition";

export type PublishResult =
  | { ok: true; productId: string; version: number; definition: ProductDefinition }
  | { ok: false; issues: ProductIssue[] };

/** Decimal columns must be handed to Prisma as Decimals, not floats. */
function toColumnData(d: ProductDefinition) {
  const c = projectToColumns(d);
  return {
    ...c,
    minPrincipal: new Prisma.Decimal(c.minPrincipal),
    maxPrincipal: new Prisma.Decimal(c.maxPrincipal),
    interestRate: new Prisma.Decimal(c.interestRate),
    penaltyRate: new Prisma.Decimal(c.penaltyRate),
    earlySettlementRate: c.earlySettlementRate == null ? null : new Prisma.Decimal(c.earlySettlementRate),
    minLoanLimit: c.minLoanLimit == null ? null : new Prisma.Decimal(c.minLoanLimit),
  };
}

/**
 * Publish a definition as the next version of a product.
 *
 * `productId` null creates the product at v1. Validation runs BEFORE anything is
 * written, and a definition that fails is rejected whole — a half-applied product is
 * a product that prices loans wrongly for however long nobody notices.
 */
export async function publishVersion(
  orgId: string,
  productId: string | null,
  incoming: unknown,
  opts: { authorId?: string | null; note?: string | null; isActive?: boolean } = {},
): Promise<PublishResult> {
  const definition = mergeProduct(incoming);

  const issues = validateProduct(definition);
  if (issues.length > 0) return { ok: false, issues };

  const columns = toColumnData(definition);

  const result = await runWithOrg(orgId, () =>
    prisma.$transaction(async (tx) => {
      const existing = productId
        ? await tx.product.findFirst({ where: { id: productId, orgId } })
        : null;
      if (productId && !existing) return null;

      // A product that predates versioning has columns and no document. Its
      // "previous" is therefore lifted from those columns, so the first diff shows
      // what genuinely changed rather than reporting every block as new.
      let previous: ProductDefinition | null = null;
      if (existing) {
        const last = await tx.productVersion.findFirst({
          where: { productId: existing.id },
          orderBy: { version: "desc" },
          select: { definition: true },
        });
        previous = last
          ? mergeProduct(last.definition)
          : definitionFromColumns(existing as unknown as Record<string, unknown>);
      }

      const nextVersion = (existing?.version ?? 0) + 1;
      const changed = previous ? changedBlocks(previous, definition) : [...BLOCK_KEYS];

      const product = existing
        ? await tx.product.update({
            where: { id: existing.id },
            data: { ...columns, version: nextVersion, ...(opts.isActive === undefined ? {} : { isActive: opts.isActive }) },
          })
        : await tx.product.create({
            data: { orgId, ...columns, version: 1, isActive: opts.isActive ?? true },
          });

      await tx.productVersion.create({
        data: {
          orgId,
          productId: product.id,
          version: nextVersion,
          definition: definition as never,
          changed: changed as never,
          note: opts.note?.trim() || null,
          authorId: opts.authorId ?? null,
        },
      });

      return { productId: product.id, version: nextVersion };
    }),
  );

  if (!result) return { ok: false, issues: [{ path: "name", message: "Product not found." }] };
  return { ok: true, productId: result.productId, version: result.version, definition };
}

/** Which top-level blocks differ. Shallow by design — the history list wants names. */
export function changedBlocks(before: ProductDefinition, after: ProductDefinition): BlockKey[] {
  return BLOCK_KEYS.filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
}

// ── The diff screen ───────────────────────────────────────────────────────────

export type FieldChange = {
  block: BlockKey | "identity";
  /** Dotted path inside the block, e.g. "earlySettlement.rebatePct". */
  path: string;
  before: unknown;
  after: unknown;
};

/**
 * A field-level diff between two definitions.
 *
 * Walks only leaves, so a change to one number inside `pricing.earlySettlement`
 * reports that number rather than the whole object — which is the difference between
 * a diff someone reads and a diff someone scrolls past.
 */
export function diffDefinitions(before: ProductDefinition, after: ProductDefinition): FieldChange[] {
  const out: FieldChange[] = [];

  for (const key of ["name", "description"] as const) {
    if (before[key] !== after[key]) out.push({ block: "identity", path: key, before: before[key], after: after[key] });
  }

  for (const block of BLOCK_KEYS) {
    walk(before[block] as Record<string, unknown>, after[block] as Record<string, unknown>, "", (path, b, a) => {
      out.push({ block, path, before: b, after: a });
    });
  }
  return out;
}

function walk(
  before: Record<string, unknown> | undefined,
  after: Record<string, unknown> | undefined,
  prefix: string,
  emit: (path: string, before: unknown, after: unknown) => void,
): void {
  const b = before ?? {};
  const a = after ?? {};
  const keys = new Set([...Object.keys(b), ...Object.keys(a)]);
  for (const key of keys) {
    const bv = b[key];
    const av = a[key];
    const path = prefix ? `${prefix}.${key}` : key;
    const isPlainObject = (v: unknown) => typeof v === "object" && v !== null && !Array.isArray(v);

    if (isPlainObject(bv) || isPlainObject(av)) {
      walk(bv as Record<string, unknown>, av as Record<string, unknown>, path, emit);
      continue;
    }
    // Arrays are compared whole: a repayment waterfall or a band ladder only makes
    // sense as a sequence, and "item 2 changed" would be less readable than both.
    if (JSON.stringify(bv) !== JSON.stringify(av)) emit(path, bv, av);
  }
}

// ── Reading versions ──────────────────────────────────────────────────────────

/** The live definition of a product, lifting legacy column-only products forward. */
export async function currentDefinition(orgId: string, productId: string): Promise<ProductDefinition | null> {
  const product = await runWithOrg(orgId, () =>
    prisma.product.findFirst({ where: { id: productId, orgId } }),
  );
  if (!product) return null;

  const latest = await runWithOrg(orgId, () =>
    prisma.productVersion.findFirst({
      where: { productId, orgId },
      orderBy: { version: "desc" },
      select: { definition: true },
    }),
  );
  return latest
    ? mergeProduct(latest.definition)
    : definitionFromColumns(product as unknown as Record<string, unknown>);
}

export type VersionRow = {
  version: number;
  changed: BlockKey[];
  note: string | null;
  createdAt: Date;
  /** How many loans were booked under these exact terms. The blast radius. */
  loanCount: number;
};

/**
 * The published history of a product, newest first, each row carrying how many loans
 * are held to it. That count is the question a credit manager actually asks before
 * changing a rate: *who is still on the old terms?*
 */
export async function listVersions(orgId: string, productId: string, take = 25): Promise<VersionRow[]> {
  const rows = await runWithOrg(orgId, () =>
    prisma.productVersion.findMany({
      where: { orgId, productId },
      orderBy: { version: "desc" },
      take,
      select: {
        id: true, version: true, changed: true, note: true, createdAt: true,
        _count: { select: { loans: true } },
      },
    }),
  );
  return rows.map((r) => ({
    version: r.version,
    changed: (r.changed ?? []) as BlockKey[],
    note: r.note,
    createdAt: r.createdAt,
    loanCount: r._count.loans,
  }));
}

/** Two versions' definitions, for the diff screen. Either may be missing. */
export async function definitionsAt(
  orgId: string,
  productId: string,
  versions: number[],
): Promise<Map<number, ProductDefinition>> {
  const rows = await runWithOrg(orgId, () =>
    prisma.productVersion.findMany({
      where: { orgId, productId, version: { in: versions } },
      select: { version: true, definition: true },
    }),
  );
  return new Map(rows.map((r) => [r.version, mergeProduct(r.definition)]));
}
