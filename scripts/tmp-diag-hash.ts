// TEMP READ-ONLY diagnostic. Compares the founder's PlatformAdmin credential
// against the copied StaffUser rows WITHOUT emitting any hash material.
import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { runAsPlatform } from "@/lib/db/context";

const EMAIL = "kipletinge123@gmail.com";

async function main() {
  await runAsPlatform(async () => {
    const admin = await prisma.platformAdmin.findUnique({ where: { email: EMAIL } });
    if (!admin) return console.log("no PlatformAdmin row");
    console.log("PlatformAdmin: status=%s created=%s lastLogin=%s", admin.status, admin.createdAt.toISOString(), admin.lastLoginAt?.toISOString() ?? "never");

    const staff = await prisma.staffUser.findMany({
      where: { email: EMAIL },
      select: {
        passwordHash: true, createdAt: true, status: true,
        org: { select: { slug: true, status: true, isDemo: true } },
      },
    });
    console.log("\nStaff rows: %d  (SAME = shares the platform password)\n", staff.length);
    for (const s of staff) {
      const same = s.passwordHash === admin.passwordHash;
      console.log(
        "  %s staff=%s org=%s%s  SAME=%s  created=%s",
        s.org.slug.padEnd(10), s.status, s.org.status, s.org.isDemo ? ",DEMO" : "",
        same ? "YES" : "NO ", s.createdAt.toISOString().slice(0, 10),
      );
    }
  });
}
main().then(() => process.exit(0)).catch((e) => { console.error("ERR:", e.message); process.exit(1); });
