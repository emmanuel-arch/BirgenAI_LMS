// ─────────────────────────────────────────────────────────────────────────────
// THE CONFIG STORE — read and publish a tenant's definition documents.
//
// One namespace registry, one reader, one writer. Where the reference system has a
// bespoke MERGE per settings form, everything here goes through `publish()`, which
// merges forward, validates, writes an immutable revision and bumps the version in
// a single transaction.
//
// FAILING TO CONFIGURE IS NOT AN ERROR. `read()` on an org that has never opened the
// screen returns the platform defaults, so every consumer can assume a complete,
// valid document exists and none of them needs a null branch.
// ─────────────────────────────────────────────────────────────────────────────
import { prisma } from "@/lib/prisma";
import { runWithOrg } from "@/lib/db/context";
import {
  BORROWER_DEFAULTS, mergeBorrowerConfig, validateBorrowerConfig,
  type BorrowerConfig, type ConfigIssue,
} from "./borrower";

/** Every namespace the platform knows, and how each is filled forward + checked. */
const NAMESPACES = {
  borrower: {
    label: "Borrower settings",
    defaults: BORROWER_DEFAULTS as unknown,
    merge: mergeBorrowerConfig as (stored: unknown) => unknown,
    validate: validateBorrowerConfig as (c: unknown) => ConfigIssue[],
  },
} as const;

export type Namespace = keyof typeof NAMESPACES;

export const isNamespace = (v: string): v is Namespace => v in NAMESPACES;

export type ConfigDoc<T> = {
  value: T;
  version: number;
  updatedAt: Date | null;
  /** True when nothing has ever been published — the screen shows platform defaults. */
  isDefault: boolean;
};

/** The live document for a namespace, always complete and always valid to read. */
export async function read<T = unknown>(orgId: string, ns: Namespace): Promise<ConfigDoc<T>> {
  const spec = NAMESPACES[ns];
  const row = await runWithOrg(orgId, () =>
    prisma.orgConfig.findUnique({ where: { orgId_namespace: { orgId, namespace: ns } } }),
  );
  if (!row) {
    return { value: spec.merge(undefined) as T, version: 0, updatedAt: null, isDefault: true };
  }
  // Merged on READ as well as write: a document published before a field existed
  // still hands the caller today's complete shape.
  return { value: spec.merge(row.value) as T, version: row.version, updatedAt: row.updatedAt, isDefault: false };
}

/** Typed convenience for the namespace every screen touches. */
export const readBorrowerConfig = (orgId: string) => read<BorrowerConfig>(orgId, "borrower");

export type PublishResult =
  | { ok: true; version: number; value: unknown }
  | { ok: false; issues: ConfigIssue[] };

/**
 * Publish a new version of a namespace.
 *
 * Merge forward → validate → write revision + bump version, atomically. A document
 * that fails validation is REJECTED WHOLE rather than partially applied: half-saved
 * settings are how a lender ends up with an age rule whose maximum is below its
 * minimum and no idea when it happened.
 */
export async function publish(
  orgId: string,
  ns: Namespace,
  incoming: unknown,
  authorId?: string | null,
): Promise<PublishResult> {
  const spec = NAMESPACES[ns];
  const value = spec.merge(incoming);

  const issues = spec.validate(value);
  if (issues.length > 0) return { ok: false, issues };

  const version = await runWithOrg(orgId, () =>
    prisma.$transaction(async (tx) => {
      const existing = await tx.orgConfig.findUnique({
        where: { orgId_namespace: { orgId, namespace: ns } },
        select: { id: true, version: true, value: true },
      });
      const next = (existing?.version ?? 0) + 1;
      const changed = existing ? changedSections(existing.value, value) : Object.keys(value as object);

      const config = existing
        ? await tx.orgConfig.update({
            where: { id: existing.id },
            data: { value: value as never, version: next, updatedById: authorId ?? null },
          })
        : await tx.orgConfig.create({
            data: { orgId, namespace: ns, value: value as never, version: next, updatedById: authorId ?? null },
          });

      await tx.orgConfigRevision.create({
        data: {
          configId: config.id, orgId, namespace: ns, version: next,
          value: value as never, changed: changed as never, authorId: authorId ?? null,
        },
      });
      return next;
    }),
  );

  return { ok: true, version, value };
}

/** The published history of a namespace, newest first. */
export async function history(orgId: string, ns: Namespace, take = 20) {
  return runWithOrg(orgId, () =>
    prisma.orgConfigRevision.findMany({
      where: { orgId, namespace: ns },
      orderBy: { version: "desc" },
      take,
      select: { version: true, changed: true, authorId: true, createdAt: true },
    }),
  );
}

/**
 * Which top-level sections differ. Shallow by design — the history list wants
 * "kyc, rules", not a field-level diff nobody reads.
 */
function changedSections(before: unknown, after: unknown): string[] {
  const a = (before ?? {}) as Record<string, unknown>;
  const b = (after ?? {}) as Record<string, unknown>;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
}
