// ─────────────────────────────────────────────────────────────────────────────
// Tenant resolution — DB-first, registry-second.
//
// The funnel routes were ported resolving lenders from the STATIC ServiceSuite
// registry (src/lib/enterprise/connections.ts). That breaks for NATIVE orgs
// (self-onboarded lenders whose book lives in our Postgres). This helper makes
// the Org table the source of truth; the static registry is only consulted for
// BRIDGED orgs that need a ServiceSuite connection.
// ─────────────────────────────────────────────────────────────────────────────
import { prisma } from "@/lib/prisma";
import { getOrg, getEntityId, isOrgConfigured, type OrgDef } from "@/lib/enterprise/connections";

export type ResolvedOrg = {
  id: string;
  slug: string;
  name: string;
  mode: "NATIVE" | "BRIDGED";
  status: "PENDING" | "ACTIVE" | "SUSPENDED";
  /** ServiceSuite EntityId (bridged only; 0 for native). */
  entityId: number;
  /** Static registry entry — set ONLY for bridged orgs with a usable registry. */
  registry: OrgDef | null;
  /** Bridged AND the ServiceSuite connection string is configured. */
  bridgedReady: boolean;
};

export async function resolveOrg(slug: string): Promise<ResolvedOrg | null> {
  const s = (slug ?? "").trim().toLowerCase();
  if (!s) return null;
  const row = await prisma.org.findUnique({
    where: { slug: s },
    select: { id: true, slug: true, name: true, mode: true, status: true, serviceSuiteEntityId: true },
  });
  if (!row) return null;

  const registry = row.mode === "BRIDGED" ? getOrg(row.slug) : null;
  const entityId =
    row.serviceSuiteEntityId ?? (registry ? getEntityId(registry) : 0);

  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    mode: row.mode,
    status: row.status,
    entityId,
    registry,
    bridgedReady: row.mode === "BRIDGED" && !!registry && isOrgConfigured(registry),
  };
}
