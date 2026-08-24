import "dotenv/config";
// TEMP READ-ONLY diagnostic: mirrors src/app/api/auth/login/route.ts lookup.
import { prisma } from "@/lib/prisma";
import { runAsPlatform } from "@/lib/db/context";

async function main() {
  await runAsPlatform(async () => {
    const admins = await prisma.platformAdmin.findMany({
      select: { email: true, name: true, status: true, lastLoginAt: true, passwordHash: true },
    });
    console.log("=== PlatformAdmin rows:", admins.length, "===");
    for (const a of admins) {
      console.log(`  email=${a.email} status=${a.status} lastLogin=${a.lastLoginAt ?? "never"} hash=${a.passwordHash.slice(0, 7)} len=${a.passwordHash.length}`);
    }

    const staff = await prisma.staffUser.findMany({
      select: {
        email: true, status: true, passwordHash: true,
        org: { select: { slug: true, status: true, isDemo: true } },
      },
      orderBy: { createdAt: "asc" },
    });
    console.log("\n=== StaffUser rows:", staff.length, "===");
    for (const s of staff) {
      const h = s.passwordHash;
      console.log(`  email=${s.email} status=${s.status} org=${s.org.slug}(${s.org.status}${s.org.isDemo ? ",DEMO" : ""}) hash=${h ? h.slice(0, 7) + " len" + h.length : "NULL"}`);
    }
  });
}
main().then(() => process.exit(0)).catch((e) => { console.error("ERR:", e.message); console.error(e); process.exit(1); });
