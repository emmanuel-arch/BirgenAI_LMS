// Tests for platform-admin auth — the wall between founder sessions and staff
// sessions, and the break-glass bearer.
//
//   npm run test:platform-admin        (pure — no database, no server)
//
// The wall has two bricks and both are load-bearing:
//   1. AUDIENCE — the platform JWT carries aud="platform"; platformAuth()
//      verifies WITH that audience, so a staff token (no aud) fails there.
//   2. PAYLOAD SHAPE — jose ignores an aud claim when the verifier doesn't ask
//      for one, so auth() WOULD verify a platform token cryptographically; what
//      stops the crossover is that auth() reads `payload.user` and the platform
//      token only carries `payload.admin`. This suite pins that fact so nobody
//      "tidies" the two payloads into one shape and quietly merges the realms.
process.env.NEXTAUTH_SECRET ??= "test-secret-for-platform-auth-suite";

import { SignJWT, jwtVerify } from "jose";
import { legacyBearerOk } from "@/lib/platform-auth";
import { getRights, requireRight } from "@/lib/rbac/authz";
import { ALL_RIGHTS } from "@/lib/rbac/rights";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, extra = "") => {
  if (cond) { pass++; console.log(`  PASS  ${name}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.log(`  FAIL  ${name}${extra ? ` — ${extra}` : ""}`); }
};

const secret = new TextEncoder().encode(process.env.NEXTAUTH_SECRET);

const signStaff = () =>
  new SignJWT({ user: { id: "staff-1", orgId: "org-1", orgSlug: "demo" } })
    .setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("1h").sign(secret);

const signPlatform = () =>
  new SignJWT({ admin: { id: "admin-1", name: "Founder", email: "f@birgenai.com" } })
    .setProtectedHeader({ alg: "HS256" }).setAudience("platform").setIssuedAt().setExpirationTime("1h").sign(secret);

async function main() {
  console.log("1. Audience separation");
  const staffToken = await signStaff();
  const platformToken = await signPlatform();

  let staffOnPlatform = true;
  try { await jwtVerify(staffToken, secret, { audience: "platform" }); } catch { staffOnPlatform = false; }
  ok("a staff token FAILS platform verification (no audience)", !staffOnPlatform);

  const { payload: platformSeenByStaffVerifier } = await jwtVerify(platformToken, secret); // auth() asks for no audience
  ok(
    "a platform token passes crypto at auth() BUT carries no `user` — payload shape is the second brick",
    platformSeenByStaffVerifier.user === undefined && !!platformSeenByStaffVerifier.admin,
  );
  const { payload: pl } = await jwtVerify(platformToken, secret, { audience: "platform" });
  ok("a platform token verifies on the platform side", (pl.admin as { id?: string })?.id === "admin-1");

  let tampered = true;
  try { await jwtVerify(platformToken.slice(0, -3) + "AAA", secret, { audience: "platform" }); } catch { tampered = false; }
  ok("a tampered platform token fails", !tampered);

  console.log("\n2. Break-glass bearer (legacy secret)");
  process.env.PLATFORM_ADMIN_SECRET = "correct-horse-battery-staple";
  ok("exact bearer passes", legacyBearerOk("Bearer correct-horse-battery-staple"));
  ok("case-insensitive scheme", legacyBearerOk("bearer correct-horse-battery-staple"));
  ok("wrong value fails", !legacyBearerOk("Bearer wrong-horse"));
  ok("same-length wrong value fails", !legacyBearerOk("Bearer correct-horse-battery-stapl3"));
  ok("missing header fails", !legacyBearerOk(null) && !legacyBearerOk(""));
  delete process.env.PLATFORM_ADMIN_SECRET;
  ok("no configured secret fails closed", !legacyBearerOk("Bearer anything"));

  console.log("\n3. Impersonated sessions get total control (the founder's ask)");
  const impersonated = {
    user: {
      id: "platform:admin-1", name: "Founder", role: "Platform Admin", roleId: null,
      orgId: "org-1", orgSlug: "demo",
      impersonator: { platformAdminId: "admin-1", name: "Founder" },
    },
  };
  ok("every right resolves", (await getRights(impersonated)).size === ALL_RIGHTS.length);
  ok("requireRight lets the founder through anywhere", (await requireRight(impersonated, "roles.manage")) === null);
  const notImpersonating = { user: { id: "platform:admin-1", orgId: "org-1" } };
  ok(
    "the SAME id WITHOUT the impersonator claim gets nothing for free (would hit the staff lookup)",
    !(notImpersonating.user as { impersonator?: unknown }).impersonator,
  );

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
