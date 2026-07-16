// Seed Field Ops demo data for an existing org's book.
//
//   npx tsx scripts/seed-field-demo.ts techcrast
//
// WHAT IT DOES (idempotent, additive — never touches loans or KYC):
//   • Every borrower WITHOUT a location pin gets a consented business snapshot
//     at a real Nairobi estate (deterministic spread — Gikomba to Githurai),
//     and roughly a third get a home pin in a neighbouring estate too.
//   • Three field agents are created (or re-activated) with bases spread
//     across the city, flagged isFieldAgent and geolocated, so nearest-agent
//     dispatch, the Dispatch Inbox and the Route Map all work end-to-end.
//
// Sign-in for the agents is printed at the end.
import "dotenv/config";
import bcrypt from "bcryptjs";
import { platformPrisma } from "../prisma/seed-client";

const prisma = platformPrisma();

const PASSWORD = "Field1234!";

// Real Nairobi trading spots — lat/lng of the estate/market, not a random box.
const SPOTS = [
  { name: "Gikomba Market", lat: -1.2842, lng: 36.8358 },
  { name: "Eastleigh First Avenue", lat: -1.2716, lng: 36.8474 },
  { name: "Kariobangi Light Industries", lat: -1.2536, lng: 36.888 },
  { name: "Kawangware 46", lat: -1.2871, lng: 36.7526 },
  { name: "Kibera Toi Market", lat: -1.3116, lng: 36.7823 },
  { name: "Kasarani Mwiki Road", lat: -1.2166, lng: 36.8983 },
  { name: "Pipeline Embakasi", lat: -1.3182, lng: 36.8935 },
  { name: "Donholm Caltex", lat: -1.2907, lng: 36.8894 },
  { name: "Westlands Mpaka Road", lat: -1.2652, lng: 36.8055 },
  { name: "Githurai 45", lat: -1.2065, lng: 36.9264 },
  { name: "Umoja Market", lat: -1.28, lng: 36.899 },
  { name: "Dandora Phase 2", lat: -1.2469, lng: 36.8983 },
  { name: "Kangemi Market", lat: -1.2686, lng: 36.7462 },
  { name: "Zimmerman", lat: -1.2135, lng: 36.8905 },
  { name: "South B Shopping Centre", lat: -1.3103, lng: 36.8331 },
  { name: "Ngara Market", lat: -1.2745, lng: 36.8236 },
];

const AGENTS = [
  { first: "Kevin", other: "Otieno", email: "kevin.field", base: { name: "CBD — Tom Mboya St", lat: -1.2833, lng: 36.8264 } },
  { first: "Faith", other: "Wanjiru", email: "faith.field", base: { name: "Kasarani", lat: -1.22, lng: 36.8969 } },
  { first: "Musa", other: "Kiptoo", email: "musa.field", base: { name: "Kawangware", lat: -1.2867, lng: 36.7517 } },
];

// Deterministic jitter (±~250 m) so fifty stalls in Gikomba don't share one dot.
const jitter = (i: number, salt: number) => (((i * 2654435761 + salt) % 1000) / 1000 - 0.5) * 0.0045;

async function main() {
  const slug = process.argv[2]?.trim();
  if (!slug) { console.error("Usage: npx tsx scripts/seed-field-demo.ts <org-slug>"); process.exit(1); }

  const org = await prisma.org.findUnique({ where: { slug } });
  if (!org) { console.error(`No org with slug "${slug}".`); process.exit(1); }
  console.log(`Org: ${org.name} (${org.id})`);

  // ── 1) Location snapshots for the book ─────────────────────────────────────
  const borrowers = await prisma.borrower.findMany({
    where: { orgId: org.id },
    select: { id: true, firstName: true, lat: true, lng: true },
    orderBy: { createdAt: "asc" },
  });
  let pinned = 0, homes = 0;
  for (let i = 0; i < borrowers.length; i++) {
    const b = borrowers[i];
    if (b.lat != null && b.lng != null) continue; // an existing pin is a real consent — keep it
    const spot = SPOTS[i % SPOTS.length];
    const wantHome = i % 3 === 0; // roughly a third also pinned their home
    const homeSpot = SPOTS[(i + 5) % SPOTS.length];
    await prisma.borrower.update({
      where: { id: b.id },
      data: {
        lat: spot.lat + jitter(i, 1),
        lng: spot.lng + jitter(i, 2),
        locationType: "business",
        locationAddress: spot.name,
        geoConsentAt: new Date(),
        ...(wantHome ? {
          homeLat: homeSpot.lat + jitter(i, 3),
          homeLng: homeSpot.lng + jitter(i, 4),
          homeAddress: homeSpot.name,
        } : {}),
      },
    });
    pinned++; if (wantHome) homes++;
  }
  console.log(`Pinned ${pinned} borrowers (${homes} with a home pin too); ${borrowers.length - pinned} already had one.`);

  // ── 2) Field agents ─────────────────────────────────────────────────────────
  // A working role: prefer an officer-ish role so the agents aren't org admins.
  const roles = await prisma.role.findMany({ where: { orgId: org.id }, select: { id: true, title: true } });
  const role = roles.find((r) => /officer|field|agent/i.test(r.title)) ?? roles[0] ?? null;
  const headOffice = await prisma.branch.findFirst({ where: { orgId: org.id, parentId: null }, select: { id: true } });
  const passwordHash = await bcrypt.hash(PASSWORD, 12);
  const domain = `${slug}.birgenai.com`;

  for (const a of AGENTS) {
    const email = `${a.email}@${domain}`;
    const existing = await prisma.staffUser.findFirst({ where: { orgId: org.id, email } });
    if (existing) {
      await prisma.staffUser.update({
        where: { id: existing.id },
        data: { isFieldAgent: true, status: "ACTIVE", lat: a.base.lat, lng: a.base.lng, lastLocationAt: new Date() },
      });
      console.log(`Agent already there — refreshed: ${email} (base ${a.base.name})`);
      continue;
    }
    await prisma.staffUser.create({
      data: {
        orgId: org.id,
        email,
        firstName: a.first,
        otherName: a.other,
        title: "Field Agent",
        phone: "2547" + String(10000000 + Math.abs(hash(email)) % 89999999),
        passwordHash,
        roleId: role?.id ?? null,
        branchId: headOffice?.id ?? null,
        isFieldAgent: true,
        lat: a.base.lat,
        lng: a.base.lng,
        lastLocationAt: new Date(),
        avatarSeed: email,
        status: "ACTIVE",
      },
    });
    console.log(`Agent created: ${a.first} ${a.other} <${email}> · base ${a.base.name}${role ? ` · role ${role.title}` : ""}`);
  }

  console.log(`\nDone. Agents sign in at /login with password ${PASSWORD}`);
  console.log("Try it: Field Ops → Customers Near Me / Dispatch Inbox / Route Map.");
}

function hash(s: string): number {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0;
  return h;
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
