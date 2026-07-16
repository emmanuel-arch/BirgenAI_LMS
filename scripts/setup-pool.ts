// Set up (or extend) a cross-entity sharing pool.
//
//   npm run pool:setup -- "<group name>" <org-slug> <org-slug> [...]
//   npm run pool:setup -- "Birgen Lending Group" micromart axe
//
// Optional: override the legal-basis clause (otherwise the default below):
//   npm run pool:setup -- "Birgen Lending Group" micromart axe --basis "..."
//
// Idempotent: re-running upserts the pool by name and adds any missing
// members. An org can belong to ONE pool — moving it means removing it first
// (deliberately manual; membership is a legal act, not a config flag).
//
// What membership does, from the moment this returns:
//   · both application roads (console + funnel) refuse an applicant with a
//     RUNNING loan at a sibling entity ("the group lends once at a time");
//   · the console's application counter can find and import the group's
//     customers from sibling books (identity + KYC standing, never balances).
import "dotenv/config";
import { rawPrisma } from "@/lib/prisma";

const DEFAULT_BASIS =
  "Shared within the lending group under the data-sharing clause of each borrower's onboarding consent, " +
  "and the group's legitimate interest in responsible lending (Kenya DPA 2019 s.30(1)(b)(f)): " +
  "member entities may check whether an applicant holds a running loan at a sibling entity, and may " +
  "transfer a customer's identity record to a sibling the customer chooses to borrow from. Balances, " +
  "schedules and transaction histories are never shared.";

async function main() {
  const args = process.argv.slice(2);
  const basisIdx = args.indexOf("--basis");
  const basis = basisIdx >= 0 ? args[basisIdx + 1] : DEFAULT_BASIS;
  const positional = basisIdx >= 0 ? [...args.slice(0, basisIdx), ...args.slice(basisIdx + 2)] : args;
  const [name, ...slugs] = positional;

  if (!name || slugs.length < 2) {
    console.error('Usage: npm run pool:setup -- "<group name>" <org-slug> <org-slug> [...]');
    process.exit(1);
  }

  const orgs = await rawPrisma.org.findMany({ where: { slug: { in: slugs } }, select: { id: true, slug: true, name: true } });
  const missing = slugs.filter((s) => !orgs.some((o) => o.slug === s));
  if (missing.length) {
    console.error(`No such org(s): ${missing.join(", ")} — check the slugs (existing: npx prisma studio → Org).`);
    process.exit(1);
  }

  // One pool per org: refuse to silently poach a member from another pool.
  const conflicts = await rawPrisma.sharingPoolMember.findMany({
    where: { orgId: { in: orgs.map((o) => o.id) }, pool: { name: { not: name } } },
    include: { pool: { select: { name: true } }, org: { select: { slug: true } } },
  });
  if (conflicts.length) {
    for (const c of conflicts) console.error(`  ✗ ${c.org.slug} already belongs to pool "${c.pool.name}" — remove it there first.`);
    process.exit(1);
  }

  const pool = await rawPrisma.sharingPool.upsert({
    where: { name },
    create: { name, legalBasis: basis },
    update: { legalBasis: basis },
  });

  for (const org of orgs) {
    await rawPrisma.sharingPoolMember.upsert({
      where: { orgId: org.id },
      create: { poolId: pool.id, orgId: org.id },
      update: { poolId: pool.id },
    });
    console.log(`  ✓ ${org.slug} (${org.name}) is in "${name}"`);
  }

  const members = await rawPrisma.sharingPoolMember.count({ where: { poolId: pool.id } });
  console.log(`\nPool "${name}" — ${members} member(s).`);
  console.log(`Legal basis on record:\n  ${pool.legalBasis}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
