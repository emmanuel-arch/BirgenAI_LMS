// Attack suite for the borrower funnel's identity boundary.
//
//   npm run build && npx next start -p 3100
//   npm run test:portal
//
// Asserts the properties the OTP gate exists to provide:
//   • every borrower-facing endpoint refuses an anonymous caller
//   • a code cannot be brute-forced (challenge burns after 5 wrong guesses)
//   • a verified session unlocks that borrower's own data
//   • a session for org A grants nothing at org B
//   • the phone is taken from the cookie, not the body (spoofing is inert)
//   • OTP issuance is rate-limited per phone
//
// Codes are read by calling issueBorrowerOtp() in-process (NODE_ENV is not
// "production" here, so it hands back the code it could not SMS); everything
// else goes over real HTTP against the running server.
import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { runAsPlatform, runWithOrg } from "@/lib/db/context";
import { issueBorrowerOtp } from "@/lib/portal/otp";

const BASE = process.env.TEST_BASE_URL || "http://127.0.0.1:3100";
const ORG_A = "demo";
const ORG_B = "hub";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, extra = "") => {
  if (cond) { pass++; console.log(`  PASS  ${name}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.log(`  FAIL  ${name}${extra ? ` — ${extra}` : ""}`); }
};

/** A fresh number each run, so rate-limit buckets never carry across runs. */
const testPhone = () => "2547" + String(Math.floor(10_000_000 + Math.random() * 89_999_999));

type Res = { status: number; body: Record<string, unknown>; setCookie: string | null };

async function post(path: string, body: unknown, cookie?: string): Promise<Res> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body),
  });
  return {
    status: res.status,
    body: (await res.json().catch(() => ({}))) as Record<string, unknown>,
    setCookie: res.headers.get("set-cookie"),
  };
}

async function get(path: string, cookie?: string): Promise<Res> {
  const res = await fetch(`${BASE}${path}`, { headers: cookie ? { Cookie: cookie } : {} });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, unknown>, setCookie: null };
}

/** Pull `lms_borrower=...` out of a Set-Cookie header. */
function borrowerCookie(setCookie: string | null): string | null {
  const m = setCookie?.match(/lms_borrower=([^;]+)/);
  return m ? `lms_borrower=${m[1]}` : null;
}

async function main() {
  const [orgA, orgB] = await runAsPlatform(() =>
    Promise.all([
      prisma.org.findUniqueOrThrow({ where: { slug: ORG_A }, select: { id: true, name: true } }),
      prisma.org.findUniqueOrThrow({ where: { slug: ORG_B }, select: { id: true, name: true } }),
    ]),
  );
  const phone = testPhone();
  const victim = testPhone();
  console.log(`server ${BASE}  ·  org A=${ORG_A}  org B=${ORG_B}  ·  test phone ${phone}\n`);

  const cleanup: string[] = [phone, victim];

  try {
    console.log("1. Anonymous callers are refused everywhere PII lives");
    const anon: [string, unknown][] = [
      ["/api/lms/eligibility", { lenderSlug: ORG_A }],
      ["/api/lms/customer-info", { lenderSlug: ORG_A }],
      ["/api/lms/apply", { lenderSlug: ORG_A, amountRequested: 5000, features: {}, consent: { mpesaAnalysis: true, automatedScoring: true } }],
      ["/api/portal/my-loan", { lenderSlug: ORG_A, nationalId: "12345678" }],
      ["/api/portal/pay", { lenderSlug: ORG_A, nationalId: "12345678" }],
      ["/api/portal/kyc", { lenderSlug: ORG_A, step: "id", payload: {} }],
    ];
    for (const [path, body] of anon) {
      const r = await post(path, body);
      ok(`${path} → 401`, r.status === 401 && r.body.needsOtp === true, `${r.status}`);
    }
    const crunch = await fetch(`${BASE}/api/enterprise/statement-cruncher`, { method: "POST", body: new FormData() });
    ok("/api/enterprise/statement-cruncher → 401", crunch.status === 401, `${crunch.status}`);

    console.log("\n2. The code cannot be walked");
    const first = await runWithOrg(orgA.id, () => issueBorrowerOtp(orgA.id, orgA.name, phone));
    ok("issueBorrowerOtp returns a code when no SMS provider is live", !!first.devCode);
    const wrong = first.devCode === "000000" ? "111111" : "000000";
    let lockedAt = 0;
    for (let i = 1; i <= 6; i++) {
      const r = await post("/api/portal/otp/verify", { lenderSlug: ORG_A, phone, code: wrong });
      if (r.body.reason === "locked" && !lockedAt) lockedAt = i;
    }
    ok("challenge burns after 5 wrong guesses", lockedAt === 5, `locked on attempt ${lockedAt}`);
    const afterLock = await post("/api/portal/otp/verify", { lenderSlug: ORG_A, phone, code: first.devCode! });
    ok("the CORRECT code is rejected once burned", afterLock.status === 401, `${afterLock.status}`);

    console.log("\n3. A fresh code verifies and issues a session");
    const second = await runWithOrg(orgA.id, () => issueBorrowerOtp(orgA.id, orgA.name, phone));
    const verified = await post("/api/portal/otp/verify", { lenderSlug: ORG_A, phone, code: second.devCode! });
    ok("verify with the right code → 200", verified.status === 200 && verified.body.success === true, `${verified.status}`);
    const cookie = borrowerCookie(verified.setCookie);
    ok("an httpOnly lms_borrower cookie is set", !!cookie && /HttpOnly/i.test(verified.setCookie ?? ""));
    if (!cookie) throw new Error("no session cookie — cannot continue");

    const sess = await get(`/api/portal/session?phone=${phone}`, cookie);
    ok("GET /api/portal/session recognises it", sess.body.authenticated === true && sess.body.matchesPhone === true);
    ok("the session returns the phone MASKED", typeof sess.body.phoneMasked === "string" && (sess.body.phoneMasked as string).includes("•"), String(sess.body.phoneMasked));

    console.log("\n4. The session unlocks that borrower's own data");
    const elig = await post("/api/lms/eligibility", { lenderSlug: ORG_A }, cookie);
    ok("eligibility with a session → 200", elig.status === 200 && elig.body.success === true, `${elig.status}`);

    console.log("\n5. A session for org A is worthless at org B");
    const crossOrg = await post("/api/lms/eligibility", { lenderSlug: ORG_B }, cookie);
    ok("eligibility at org B with org A's cookie → 401", crossOrg.status === 401 && crossOrg.body.needsOtp === true, `${crossOrg.status}`);

    console.log("\n6. The phone in the BODY is inert — the cookie decides");
    // Verified as `phone`, but ask for `victim`'s record. The body field no
    // longer exists on these routes; assert the server ignores it entirely.
    await runWithOrg(orgA.id, () =>
      prisma.borrower.create({ data: { orgId: orgA.id, phone: victim, firstName: "Victim", nationalId: "99999999" } }),
    );
    const spoofed = await post("/api/portal/my-loan", { lenderSlug: ORG_A, phone: victim, nationalId: "99999999" }, cookie);
    ok("my-loan cannot be steered to another phone via the body", spoofed.status === 200 && spoofed.body.found === false, JSON.stringify(spoofed.body.found));

    console.log("\n7. OTP issuance is rate-limited per phone");
    const burst = testPhone();
    cleanup.push(burst);
    const codes: number[] = [];
    for (let i = 0; i < 4; i++) {
      const r = await post("/api/portal/otp", { lenderSlug: ORG_A, phone: burst });
      codes.push(r.status);
    }
    ok("4th code request in 15 min → 429", codes.slice(0, 3).every((s) => s === 200) && codes[3] === 429, codes.join(","));
  } finally {
    await runAsPlatform(async () => {
      await prisma.otpChallenge.deleteMany({ where: { phone: { in: cleanup } } });
      await prisma.borrower.deleteMany({ where: { phone: { in: cleanup } } });
    });
    console.log(`\n${pass} passed, ${fail} failed`);
  }
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
