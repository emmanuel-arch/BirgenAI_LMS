// Create (or reset) a platform admin — the founder's own account with total
// control of the infrastructure.
//
//   npm run platform:admin -- <email> <full name> [password]
//
// Prints a generated password when none is given. Idempotent: an existing email
// gets its name/password updated and its account re-enabled.
import "dotenv/config";
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { runAsPlatform } from "@/lib/db/context";

async function main() {
  const [email, name, passwordArg] = process.argv.slice(2);
  if (!email?.includes("@") || !name) {
    console.error("Usage: npm run platform:admin -- <email> <full name> [password]");
    process.exit(1);
  }
  const password = passwordArg || randomBytes(9).toString("base64url");
  if (password.length < 10) {
    console.error("Password must be at least 10 characters.");
    process.exit(1);
  }

  const admin = await runAsPlatform(() =>
    prisma.platformAdmin.upsert({
      where: { email: email.toLowerCase() },
      create: { email: email.toLowerCase(), name, passwordHash: bcrypt.hashSync(password, 12) },
      update: { name, passwordHash: bcrypt.hashSync(password, 12), status: "ACTIVE" },
    }),
  );

  console.log(`Platform admin ready: ${admin.name} <${admin.email}>`);
  if (!passwordArg) console.log(`Generated password: ${password}`);
  console.log("Sign in at /platform/login");
}

main().catch((e) => { console.error(e); process.exit(1); });
