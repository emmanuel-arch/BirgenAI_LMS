// One-shot launch alignment for the five real companies.
//
//   npm run setup:launch            — do everything
//   npm run setup:launch -- --dry   — report what would change, touch nothing
//
// What it does, idempotently:
//   1. DELETES leftover verification/test orgs (verify-ops, rlstest-*, ctest-*,
//      paytest-*, pooltest-*) via the same deleteTenant the platform board uses,
//      so the /platform review queue shows only real lenders. The guided-demo
//      org ("demo") is a product feature (the /demo showcase) and is KEPT.
//   2. Aligns the five launch orgs with their books:
//        micromart → BRIDGED, ServiceSuite EntityId 3002 (SERVICESUITE_CONN_MICROMART)
//        axe       → BRIDGED, EntityId 3003              (SERVICESUITE_CONN_AXE)
//        buysimu   → BRIDGED, EntityId 8                 (SERVICESUITE_CONN_BUYSIMU)
//        techcrast → BRIDGED, EntityId 7                 (MICROMART_FINTECH — Techcrast's own server)
//        hub       → NATIVE (BirgenAI's own book lives in our Postgres)
//      and flips them ACTIVE.
//   3. Seats the platform founder (kipletinge123@gmail.com) as an Org Admin in
//      ALL five orgs — same email, same password as the /platform/login account
//      (the bcrypt hash is copied from PlatformAdmin, so one password opens
//      every door), full rights ("*"), all approval tiers, head office branch.
//      Visiting lms.birgenai.com/<slug> then shows that lender's logo, and the
//      slug pins which of the five seats the session opens.
import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { runAsPlatform } from "@/lib/db/context";
import { deleteTenant } from "@/lib/compliance/tenant";
import { headOfficeId } from "@/lib/rbac/scope";

const FOUNDER_EMAIL = "kipletinge123@gmail.com";
const TEST_ORG_PATTERN = /^(verify-ops$|rlstest-|ctest-|paytest-|pooltest-)/;

/** slug → the ServiceSuite EntityId their bridged book scopes to (null = native). */
const LAUNCH_ORGS: Record<string, { entityId: number | null; mode: "NATIVE" | "BRIDGED" }> = {
  micromart: { entityId: 3002, mode: "BRIDGED" },
  axe: { entityId: 3003, mode: "BRIDGED" },
  buysimu: { entityId: 8, mode: "BRIDGED" },
  techcrast: { entityId: 7, mode: "BRIDGED" },
  hub: { entityId: null, mode: "NATIVE" },
};

const dry = process.argv.includes("--dry");

async function main() {
  await runAsPlatform(async () => {
    // ── 1. Test-org cleanup ──────────────────────────────────────────────────
    const all = await prisma.org.findMany({ select: { id: true, slug: true, name: true } });
    const doomed = all.filter((o) => TEST_ORG_PATTERN.test(o.slug));
    for (const o of doomed) {
      if (dry) { console.log(`[dry] would delete test org ${o.slug} (${o.name})`); continue; }
      const outcome = await deleteTenant(o.id);
      const rows = Object.values(outcome.rowsDeleted).reduce((a, b) => a + b, 0);
      console.log(`deleted test org ${o.slug} (${rows} rows, ${outcome.objectsDeleted} objects)`);
    }
    if (!doomed.length) console.log("no test orgs to delete");

    // ── 2. Align the five launch orgs ────────────────────────────────────────
    const founderAdmin = await prisma.platformAdmin.findUnique({
      where: { email: FOUNDER_EMAIL },
      select: { name: true, passwordHash: true },
    });
    if (!founderAdmin) throw new Error(`${FOUNDER_EMAIL} is not a PlatformAdmin — run npm run platform:admin first.`);
    const [first, ...rest] = founderAdmin.name.trim().split(/\s+/);

    for (const [slug, cfg] of Object.entries(LAUNCH_ORGS)) {
      const org = await prisma.org.findUnique({ where: { slug }, select: { id: true, name: true, mode: true, status: true, serviceSuiteEntityId: true } });
      if (!org) { console.warn(`⚠ launch org "${slug}" not found — skipped`); continue; }

      const wants = { mode: cfg.mode, status: "ACTIVE" as const, serviceSuiteEntityId: cfg.entityId };
      const drift =
        org.mode !== wants.mode || org.status !== wants.status || (org.serviceSuiteEntityId ?? null) !== wants.serviceSuiteEntityId;
      if (drift) {
        if (dry) console.log(`[dry] would align ${slug}: mode ${org.mode}→${wants.mode}, status ${org.status}→ACTIVE, entity ${org.serviceSuiteEntityId ?? "-"}→${wants.serviceSuiteEntityId ?? "-"}`);
        else {
          await prisma.org.update({ where: { id: org.id }, data: wants });
          console.log(`aligned ${slug}: mode=${wants.mode} status=ACTIVE entity=${wants.serviceSuiteEntityId ?? "-"}`);
        }
      } else console.log(`${slug} already aligned (${org.mode}, entity ${org.serviceSuiteEntityId ?? "-"})`);

      // ── 3. Founder Org Admin seat ──────────────────────────────────────────
      if (dry) { console.log(`[dry] would ensure Org Admin seat for ${FOUNDER_EMAIL} in ${slug}`); continue; }

      // Head office: every staff member belongs somewhere (resolveScope degrades
      // branchless staff to OWN). Create the root if this org never got one.
      let hqId = await headOfficeId(org.id);
      if (!hqId) {
        const hq = await prisma.branch.create({ data: { orgId: org.id, name: "Head Office", levelName: "Head Office", code: "HQ" } });
        hqId = hq.id;
        console.log(`  created Head Office branch for ${slug}`);
      }

      let role = await prisma.role.findUnique({ where: { orgId_title: { orgId: org.id, title: "Org Admin" } } });
      if (!role) {
        role = await prisma.role.create({ data: { orgId: org.id, title: "Org Admin", rights: ["*"], menu: ["*"], dataScope: "ORG" } });
        console.log(`  created Org Admin role for ${slug}`);
      }

      const seat = {
        firstName: first || "Platform",
        otherName: rest.join(" ") || null,
        passwordHash: founderAdmin.passwordHash, // same password as /platform/login
        roleId: role.id,
        branchId: hqId,
        isInitiator: true,
        isAuthorizer: true,
        isValidator: true,
        title: "Org Admin",
        status: "ACTIVE" as const,
      };
      await prisma.staffUser.upsert({
        where: { orgId_email: { orgId: org.id, email: FOUNDER_EMAIL } },
        create: { orgId: org.id, email: FOUNDER_EMAIL, ...seat },
        update: seat,
      });
      console.log(`  ✓ ${FOUNDER_EMAIL} is Org Admin at ${slug} → sign in at /${slug}`);
    }
  });
}

main()
  .then(() => { console.log(dry ? "\ndry run complete — nothing changed." : "\nlaunch orgs aligned."); process.exit(0); })
  .catch((e) => { console.error(e); process.exit(1); });
