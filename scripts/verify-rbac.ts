// Tests for the rights vocabulary, the nav registry, and the resolver's pure
// paths — the contract between "what the sidebar shows" and "what the API lets
// through".
//
//   npm run test:rbac        (pure — no database, no server)
//
// The danger this suite guards: the RBAC rollout silently changing what an
// existing org can do. Staff with no role must resolve to EXACTLY the set of
// surfaces that were reachable before roles were enforced — that historical
// guard map is pinned here, item by item, and the vocabulary must partition
// cleanly around it. The second danger is drift between menu and enforcement:
// every nav item's right and feature must exist, or a role could be granted a
// menu the API rejects (or worse, the reverse).
import {
  ALL_RIGHTS, ALL_RIGHTS_SET, LEGACY_DEFAULT_RIGHTS, ADMIN_ONLY_RIGHTS, RESERVED_RIGHTS,
  RIGHT_LABELS, WILDCARD, type Right,
} from "@/lib/rbac/rights";
import { rightsSetFrom, getRights, requireRight } from "@/lib/rbac/authz";
import { NAV_REGISTRY, navFor } from "@/lib/nav/registry";
import { AVAILABLE_FEATURES, PLANS } from "@/lib/billing/plans";
import type { Session } from "@/lib/auth";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, extra = "") => {
  if (cond) { pass++; console.log(`  PASS  ${name}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.log(`  FAIL  ${name}${extra ? ` — ${extra}` : ""}`); }
};

/**
 * The guard map as it stood the day before RBAC (commit b44244e): which rights
 * were admin-gated via hasAdminAccess, verbatim. Do not "tidy" this — it is
 * history, and LEGACY_DEFAULT_RIGHTS is defined as its complement.
 */
const HISTORICAL_ADMIN_ONLY: Right[] = [
  "products.manage", // api/console/products POST/PUT
  "workflows.manage", // api/console/workflows POST/PUT
  "team.view", "team.manage", // api/console/team GET/POST/PUT (all admin)
  "roles.view", "roles.manage", // new surface, admin by construction
  "branding.manage", // new surface, admin by construction
  "settings.view", "settings.manage", // api/orgs/integrations GET/PUT
  "float.manage", // api/console/float POST
  "billing.manage", // api/console/billing POST actions
  "intelligence.tune", // api/console/intelligence/tuning PUT
  "documents.manage", // api/console/documents/[id] DELETE
];

async function main() {
  console.log("1. The vocabulary partitions cleanly");
  ok("no duplicate rights", new Set(ALL_RIGHTS).size === ALL_RIGHTS.length);
  ok("every right has a plain-language label", ALL_RIGHTS.every((r) => (RIGHT_LABELS[r] ?? "").length > 10));
  const legacy = new Set<string>(LEGACY_DEFAULT_RIGHTS);
  const admin = new Set<string>(ADMIN_ONLY_RIGHTS);
  const reserved = new Set<string>(RESERVED_RIGHTS);
  ok("legacy ⊆ all", LEGACY_DEFAULT_RIGHTS.every((r) => ALL_RIGHTS_SET.has(r)));
  ok("admin-only ⊆ all", ADMIN_ONLY_RIGHTS.every((r) => ALL_RIGHTS_SET.has(r)));
  ok("reserved ⊆ all", RESERVED_RIGHTS.every((r) => ALL_RIGHTS_SET.has(r)));
  ok("legacy ∩ admin-only = ∅", LEGACY_DEFAULT_RIGHTS.every((r) => !admin.has(r)));
  ok("legacy ∩ reserved = ∅", LEGACY_DEFAULT_RIGHTS.every((r) => !reserved.has(r)));
  ok("admin-only ∩ reserved = ∅", ADMIN_ONLY_RIGHTS.every((r) => !reserved.has(r)));
  ok(
    "legacy ∪ admin-only ∪ reserved = all (nothing unaccounted for)",
    ALL_RIGHTS.every((r) => legacy.has(r) || admin.has(r) || reserved.has(r)) &&
      legacy.size + admin.size + reserved.size === ALL_RIGHTS.length,
  );

  console.log("\n2. LEGACY_DEFAULT_RIGHTS is exactly the pre-RBAC reachable set");
  ok(
    "admin-only matches the historical guard map, item for item",
    ADMIN_ONLY_RIGHTS.length === HISTORICAL_ADMIN_ONLY.length &&
      HISTORICAL_ADMIN_ONLY.every((r) => admin.has(r)),
  );
  for (const r of HISTORICAL_ADMIN_ONLY) {
    ok(`legacy staff still cannot ${r}`, !legacy.has(r));
  }
  ok("legacy staff still see the applications queue", legacy.has("applications.view"));
  ok("legacy staff still decide applications", legacy.has("applications.decide"));
  ok("legacy staff still run disbursements (tiers gate inside)", legacy.has("disbursements.manage"));
  ok("legacy staff still collect repayments", legacy.has("repayments.collect"));
  ok("legacy staff still resolve reconciliation", legacy.has("reconciliation.resolve"));
  ok("legacy staff still dispatch field agents", legacy.has("field.manage"));
  ok("legacy staff still parse documents", legacy.has("documents.parse"));
  ok("legacy staff still use Riri", legacy.has("riri.use"));

  console.log("\n3. Registry integrity — menu and enforcement cannot drift");
  const moduleKeys = NAV_REGISTRY.map((m) => m.key);
  ok("module keys unique", new Set(moduleKeys).size === moduleKeys.length);
  const items = NAV_REGISTRY.flatMap((m) => m.items);
  const itemKeys = items.map((i) => i.key);
  ok("item keys unique across the whole tree", new Set(itemKeys).size === itemKeys.length);
  ok("every item right exists in the vocabulary", items.every((i) => !i.right || ALL_RIGHTS_SET.has(i.right)));
  const features = new Set<string>(AVAILABLE_FEATURES);
  ok("every item feature is actually built", items.every((i) => !i.feature || features.has(i.feature)));
  ok(
    "every ready item goes somewhere (href or dock), every unready item nowhere",
    items.every((i) => (i.ready === false ? !i.href : !!i.href || !!i.open)),
  );
  ok("no reserved right sits on a ready item", items.every((i) => i.ready === false || !i.right || !reserved.has(i.right)));
  ok("hrefs all live under /console", items.every((i) => !i.href || i.href.startsWith("/console")));

  console.log("\n4. navFor — the sidebar is rights × features");
  const allFeatures = features as ReadonlySet<string>;
  const everything = navFor(new Set(ALL_RIGHTS), allFeatures);
  ok("wildcard staff on the top plan see every module", everything.length === NAV_REGISTRY.length);

  const officer = navFor(
    new Set(["borrowers.view", "applications.view", "applications.decide", "loans.view", "products.view", "riri.use"]),
    allFeatures,
  );
  const officerItems = new Set(officer.flatMap((m) => m.items.map((i) => i.key)));
  ok("officer sees the products list", officerItems.has("products"));
  ok("officer does NOT see branding", !officerItems.has("branding"));
  ok("officer does NOT see roles or team", !officerItems.has("roles") && !officerItems.has("team"));
  ok("officer does NOT see billing", !officerItems.has("billing"));
  ok("empty modules vanish for the officer", officer.every((m) => m.items.length > 0));

  const starterFeatures = new Set<string>(PLANS.STARTER.features);
  const starterAdmin = navFor(new Set(ALL_RIGHTS), starterFeatures);
  const starterItems = new Set(starterAdmin.flatMap((m) => m.items.map((i) => i.key)));
  ok("Starter admin loses early-warning (plan, not role)", !starterItems.has("early-warning"));
  ok("Starter admin loses model tuning", !starterItems.has("model-tuning"));
  ok("Starter admin loses Riri", !starterItems.has("riri"));
  ok("Starter admin loses field ops", !starterItems.has("field-visits"));
  ok("Starter admin keeps the document parser (sold on Starter)", starterItems.has("documents"));
  ok("Starter admin keeps team, roles, settings, billing", ["team", "roles", "settings", "billing"].every((k) => starterItems.has(k)));

  const nobody = navFor(new Set(), allFeatures);
  ok("no rights ⇒ only the dashboard survives", nobody.length === 1 && nobody[0].key === "dashboard");

  console.log("\n5. rightsSetFrom — Role.rights JSON is normalized defensively");
  ok("non-array is nothing", rightsSetFrom({ evil: true }).size === 0 && rightsSetFrom("*").size === 0);
  ok("wildcard is everything", rightsSetFrom([WILDCARD]).size === ALL_RIGHTS.length);
  ok("unknown keys are dropped", rightsSetFrom(["products.view", "made.up", 42]).size === 1);
  ok("a real subset survives intact", rightsSetFrom(["team.view", "team.manage"]).size === 2);

  console.log("\n6. Resolver pure paths (no database touched)");
  const impersonated: Session = {
    user: { id: "platform:x", name: "Founder", orgId: "org-1", orgSlug: "demo", impersonator: { platformAdminId: "x", name: "Founder" } },
  };
  ok("impersonator resolves to everything", (await getRights(impersonated)).size === ALL_RIGHTS.length);
  ok("impersonator passes requireRight", (await requireRight(impersonated, "roles.manage")) === null);
  const anon = await requireRight(null, "products.view");
  ok("no session is a 401", anon !== null && anon.status === 401);
  const noOrg = await requireRight({ user: { id: "x" } }, "products.view");
  ok("session without an org is a 401", noOrg !== null && noOrg.status === 401);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
