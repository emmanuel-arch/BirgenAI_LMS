// ─────────────────────────────────────────────────────────────────────────────
// Organization → ServiceSuite connection registry.
//
// Each launch org maps to (a) the ServiceSuite EntityId used for tenant scoping
// and (b) a SQL Server connection string supplied via env. EntityIds and conn
// strings are resolved SERVER-SIDE only — the client picks an org slug, never a
// raw EntityId or credential.
//
// Provide the connection strings in .env.local using the SAME .NET-style strings
// ServiceSuite uses, e.g.:
//   SERVICESUITE_CONN_MICROMART="Data Source=<host>,<port>;Initial Catalog=Serviceconnect;user id=<user>;password=<password>;MultipleActiveResultSets=True"
//   SERVICESUITE_CONN_AXE="..."
//   SERVICESUITE_CONN_HUB="..."
// Optionally override the EntityId per org (Axe/Hub live on their own servers and
// may not be 3003/0 there):
//   SERVICESUITE_ENTITYID_AXE=...   SERVICESUITE_ENTITYID_HUB=0
//
// SECURITY: ideally each string points at a READ-ONLY, least-privilege SQL login
// with SELECT on Serviceconnect + Transactions only. The guard layer enforces
// read-only regardless, but defence-in-depth starts at the credential.
// ─────────────────────────────────────────────────────────────────────────────

import type { config as MssqlConfig } from "mssql";

export type OrgSlug = "micromart" | "axe" | "buysimu" | "njb" | "atico" | "hub" | "micromart-fintech" | "techcrast";

export type OrgDef = {
  slug: OrgSlug;
  name: string;
  /** Default ServiceSuite EntityId (overridable via env). */
  defaultEntityId: number;
  /** Env var holding the .NET-style connection string. */
  connEnv: string;
  /** Env var optionally overriding the EntityId. */
  entityEnv: string;
  /** Hub (EntityId 0) / admin orgs may query across all entities. */
  isAdmin: boolean;
};

export const ORGS: Record<OrgSlug, OrgDef> = {
  micromart: {
    slug: "micromart",
    name: "Micromart Africa",
    defaultEntityId: 3002,
    connEnv: "SERVICESUITE_CONN_MICROMART",
    entityEnv: "SERVICESUITE_ENTITYID_MICROMART",
    isAdmin: false,
  },
  axe: {
    slug: "axe",
    name: "Axe Capital",
    defaultEntityId: 3003,
    connEnv: "SERVICESUITE_CONN_AXE",
    entityEnv: "SERVICESUITE_ENTITYID_AXE",
    isAdmin: false,
  },
  buysimu: {
    // Device financing (e.g. iPhone on credit) on the SHARED ServiceSuite DB
    // (213.148.17.198,4420 / Serviceconnect). Each device sold = a loan + schedule,
    // same mechanics as the lenders. EntityId 8 = "Buy Simu" (verified live).
    slug: "buysimu",
    name: "Buy Simu",
    defaultEntityId: 8,
    connEnv: "SERVICESUITE_CONN_BUYSIMU",
    entityEnv: "SERVICESUITE_ENTITYID_BUYSIMU",
    isAdmin: false,
  },
  njb: {
    // Established microlender on the SHARED ServiceSuite DB (EntityId 3, ~30k loans).
    // Long track record → ideal for validating the origination engine + call centre.
    slug: "njb",
    name: "NJB",
    defaultEntityId: 3,
    connEnv: "SERVICESUITE_CONN_BUYSIMU", // shared DB (213.148.17.198,4420 / Serviceconnect)
    entityEnv: "SERVICESUITE_ENTITYID_NJB",
    isAdmin: false,
  },
  atico: {
    // ATICO AFRICA on the SHARED ServiceSuite DB (EntityId 23, ~6.4k loans).
    slug: "atico",
    name: "ATICO Africa",
    defaultEntityId: 23,
    connEnv: "SERVICESUITE_CONN_BUYSIMU", // shared DB
    entityEnv: "SERVICESUITE_ENTITYID_ATICO",
    isAdmin: false,
  },
  hub: {
    slug: "hub",
    name: "BirgenAI Hub",
    defaultEntityId: 0,
    connEnv: "SERVICESUITE_CONN_HUB",
    entityEnv: "SERVICESUITE_ENTITYID_HUB",
    isAdmin: true,
  },
  techcrast: {
    // Techcrast Software Solutions. It USED to share the retired test box at
    // 102.214.69.233,4410 with the fintech pilot; that server is no longer the
    // live deployment, so this org now has its own connection env and stays
    // UNCONFIGURED until it is pointed at Techcrast's real book. Leaving it on
    // the old shared var would have it silently reading a test ledger.
    // TODO(founder): supply SERVICESUITE_CONN_TECHCRAST + confirm the EntityId.
    slug: "techcrast",
    name: "Techcrast Software Solutions",
    defaultEntityId: 7,
    connEnv: "SERVICESUITE_CONN_TECHCRAST",
    entityEnv: "SERVICESUITE_ENTITYID_TECHCRAST",
    isAdmin: false,
  },
  "micromart-fintech": {
    // MICROMART FINTECH — verified live 12 Aug 2026 on Micromart's OWN server
    // (reachable over Tailscale at 100.72.35.56,4230 / Serviceconnect).
    //
    // EntityId 3005, org unit 129, paybill 4116125. Two active products —
    // Micro Eazy (30219, 8.25% flat/week, customer-selected tenor up to 10) and
    // Micro Eazy Monthly (30220, 22% flat/month x 2) — both on workflow 1022
    // "Micro Eazy" (stage 2058 Risk -> stage 2059 Customer Service). 17,016
    // borrowers were migrated here from 3002 on 2 Aug 2026.
    //
    // HISTORY, so nobody repoints this by mistake again: this entry used to
    // describe EntityId 7 / product 31418 / workflow 55 on a Techcrast box at
    // 102.214.69.233,4410. None of those objects exist on the live server — that
    // deployment was a TEST environment, and every rehearsal against it proved a
    // pipe into the wrong building.
    //
    // Still a POSTING TARGET rather than a portal lender, and the split is now
    // cross-ENTITY on one server rather than cross-server: eligibility and
    // history are read from Micromart's main book (3002, 140k borrowers) while
    // pilot loans BOOK into the Fintech entity (3005). See getPostingOrg, and
    // note that collapsing the two would resolve a Micro Eazy customer's phone
    // against 3002 — where 13 of those numbers belong to a DIFFERENT borrower.
    slug: "micromart-fintech",
    name: "Micromart Fintech",
    defaultEntityId: 3005,
    connEnv: "MICROMART_FINTECH",
    entityEnv: "MICROMART_FINTECH_ENTITYID",
    isAdmin: false,
  },
};

/**
 * Orgs whose loans are POSTED into a different ledger than the one their book is
 * read from. The Micromart pilot: eligibility/history reads stay on Micromart's
 * main book (entity 3002), while the booked loan goes to the Fintech entity
 * (3005), where the "Micro Eazy" workflow takes over.
 *
 * This is deliberately NOT collapsed. Both sides are now the same SQL server, so
 * it is tempting to delete the indirection — but the two entities hold different
 * borrower populations, and 13 phone numbers exist in BOTH. Resolving a Micro
 * Eazy customer against 3002 can hand back a different human being, and the
 * posting path looks borrowers up by phone. The split is the safety property.
 */
const POSTING_TARGETS: Partial<Record<OrgSlug, OrgSlug>> = {
  micromart: "micromart-fintech",
};

/**
 * Where a lender's approved loans are booked. When a posting target is DECLARED
 * but its connection is not configured, this is null — posting must stay off
 * rather than silently booking into the wrong ledger.
 */
export function getPostingOrg(slug: string): OrgDef | null {
  const targetSlug = POSTING_TARGETS[slug as OrgSlug];
  if (targetSlug) {
    const target = ORGS[targetSlug];
    return isOrgConfigured(target) ? target : null;
  }
  return getOrg(slug);
}

export function getOrg(slug: string): OrgDef | null {
  return (ORGS as Record<string, OrgDef>)[slug] ?? null;
}

/** The EntityId for an org (env override → default). */
export function getEntityId(org: OrgDef): number {
  const raw = process.env[org.entityEnv];
  const n = raw != null ? Number(raw) : NaN;
  return Number.isInteger(n) ? n : org.defaultEntityId;
}

/** Is this org's connection string configured? */
export function isOrgConfigured(org: OrgDef): boolean {
  return !!process.env[org.connEnv]?.trim();
}

/**
 * Parse a .NET-style connection string into an mssql config object.
 * Handles: Data Source=host,port | Server=… ; Initial Catalog=db ; User ID ;
 * Password ; Encrypt ; TrustServerCertificate. Unknown keys are ignored.
 */
export function parseDotNetConnString(connStr: string): MssqlConfig {
  const parts = connStr.split(";").map((s) => s.trim()).filter(Boolean);
  const kv: Record<string, string> = {};
  for (const part of parts) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const key = part.slice(0, eq).trim().toLowerCase();
    const val = part.slice(eq + 1).trim();
    kv[key] = val;
  }

  const dataSource = kv["data source"] ?? kv["server"] ?? "";
  let server = dataSource;
  let port: number | undefined;
  // "host,port" (SQL Server) or "host:port"
  const sep = dataSource.includes(",") ? "," : dataSource.includes(":") ? ":" : "";
  if (sep) {
    const [h, p] = dataSource.split(sep);
    server = h.trim().replace(/^tcp:/i, "");
    const pn = Number(p);
    if (Number.isInteger(pn)) port = pn;
  }

  const truthy = (v?: string) => /^(true|yes|1)$/i.test((v ?? "").trim());

  return {
    server,
    port,
    user: kv["user id"] ?? kv["uid"] ?? kv["user"],
    password: kv["password"] ?? kv["pwd"],
    database: kv["initial catalog"] ?? kv["database"],
    connectionTimeout: 20000,
    requestTimeout: 30000,
    options: {
      // Default to unencrypted unless the string explicitly asks for it — this
      // matches the on-prem ServiceSuite servers (self-signed / no TLS cert).
      encrypt: kv["encrypt"] != null ? truthy(kv["encrypt"]) : false,
      trustServerCertificate: kv["trustservercertificate"] != null ? truthy(kv["trustservercertificate"]) : true,
      enableArithAbort: true,
    },
  } as MssqlConfig;
}

/** Resolve an org slug to its mssql config (throws a clear error if unconfigured). */
export function getMssqlConfig(org: OrgDef): MssqlConfig {
  const raw = process.env[org.connEnv]?.trim();
  if (!raw) {
    throw new Error(
      `${org.name} is not connected yet. Set ${org.connEnv} in .env.local to the ServiceSuite connection string.`,
    );
  }
  return parseDotNetConnString(raw);
}
