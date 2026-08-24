// TEMP READ-ONLY diagnostic: recent sign-in attempt counters + recent auth audit rows.
import "dotenv/config";
import { rawPrisma } from "@/lib/prisma";

async function main() {
  const rows = await rawPrisma.$queryRawUnsafe<
    { key: string; windowStart: Date; count: number; expiresAt: Date }[]
  >(`SELECT "key", "windowStart", "count", "expiresAt" FROM "RateLimit"
     WHERE "key" LIKE 'login:%' ORDER BY "windowStart" DESC LIMIT 25`);
  console.log("=== recent login rate-limit buckets ===");
  for (const r of rows) {
    console.log(`  ${r.windowStart.toISOString()}  count=${String(r.count).padStart(3)}  ${r.key}`);
  }

  const audit = await rawPrisma.$queryRawUnsafe<
    { createdAt: Date; action: string; actorType: string; orgId: string | null }[]
  >(`SELECT "createdAt", "action", "actorType", "orgId" FROM "AuditLog"
     WHERE "action" LIKE 'auth.%' OR "action" LIKE 'platform.%'
     ORDER BY "createdAt" DESC LIMIT 15`);
  console.log("\n=== recent auth audit rows (successes only) ===");
  for (const a of audit) {
    console.log(`  ${a.createdAt.toISOString()}  ${a.action.padEnd(22)} actor=${a.actorType} org=${a.orgId ?? "-"}`);
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error("ERR:", e.message); process.exit(1); });
