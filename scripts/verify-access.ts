// ─────────────────────────────────────────────────────────────────────────────
// PROVE THE PER-PERSON ACCESS LAYER.
//
//   npm run test:access
//
// Sets a deny list on a real staff member, signs in AS THEM over HTTP, and reads
// the rendered markup to confirm the door and the module actually disappeared —
// then puts the account back exactly as it was.
//
// It is an outside-in test on purpose. The unit-level question ("does isDenied
// return true") is not the one that matters; the one that matters is whether a
// person who has been told they cannot see ConnectDesk still gets a ConnectDesk
// tile on their launcher, and only the rendered page can answer that.
//
// The account is RESTORED in a finally block. A test that leaves a supervisor
// locked out of the collections floor the morning of a demo would be worse than
// no test at all.
// ─────────────────────────────────────────────────────────────────────────────
import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { runAsPlatform } from "../src/lib/db/context";

const BASE = process.env.ACCESS_BASE || "http://127.0.0.1:3000";
const EMAIL = process.env.ACCESS_EMAIL || "desk.supervisor@micromart.birgenai.com";
const PASSWORD = process.env.ACCESS_PASSWORD || "DeskDemo2026!";

const G = (s: string) => `\x1b[32m${s}\x1b[0m`;
const R = (s: string) => `\x1b[31m${s}\x1b[0m`;
const D = (s: string) => `\x1b[2m${s}\x1b[0m`;
const B = (s: string) => `\x1b[1m${s}\x1b[0m`;

let failed = 0;
const check = (ok: boolean, label: string, detail?: string) => {
  if (!ok) failed++;
  console.log(`  ${ok ? G("✓") : R("✗")} ${label}${detail ? `\n     ${D(detail)}` : ""}`);
};

async function signIn(): Promise<string> {
  let r = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  let body = (await r.json()) as { fallbackCode?: string; success?: boolean };
  let jar = r.headers.getSetCookie().map((c) => c.split(";")[0]);
  if (body.fallbackCode) {
    r = await fetch(`${BASE}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: jar.join("; ") },
      body: JSON.stringify({ email: EMAIL, password: PASSWORD, otp: body.fallbackCode }),
    });
    body = (await r.json()) as typeof body;
    jar = [...jar, ...r.headers.getSetCookie().map((c) => c.split(";")[0])];
  }
  if (!body.success) throw new Error(`sign-in failed: ${JSON.stringify(body)}`);
  return jar.join("; ");
}

const get = async (path: string, cookie: string) =>
  (await fetch(`${BASE}${path}`, { headers: { cookie }, redirect: "manual" })).text();

async function main() {
  console.log(`\n${B("PER-PERSON ACCESS")}  ${D(EMAIL)}\n`);

  const staff = await runAsPlatform(() =>
    prisma.staffUser.findFirst({ where: { email: EMAIL }, select: { id: true, access: true, firstName: true } }),
  );
  if (!staff) {
    console.log(R("no such staff member"));
    process.exit(1);
  }
  const original = staff.access;

  try {
    // ── 1 · Baseline: everything visible ─────────────────────────────────────
    await runAsPlatform(() => prisma.staffUser.update({ where: { id: staff.id }, data: { access: {} } }));
    let cookie = await signIn();
    const suiteBefore = await get("/suite", cookie);
    const booksBefore = await get("/books", cookie);
    console.log(B("1 · With nothing denied"));
    check(/connectdesk.servicesuitecloud.com/i.test(suiteBefore), "ConnectDesk tile is on the launcher", "the subdomain is rendered on the tile and nowhere else — the bare word appears 5x in the flows strip");
    check(/Ledgerly|Movement/i.test(suiteBefore + booksBefore), "Ledgerly is reachable");
    check(/Cash|In and out/i.test(booksBefore), "Ledgerly shows its Cash module");

    // ── 2 · Deny a whole system and one module ───────────────────────────────
    await runAsPlatform(() =>
      prisma.staffUser.update({
        where: { id: staff.id },
        data: { access: { deny: ["callcenter", "accounting:cash"] } },
      }),
    );
    // The SAME session is reused deliberately. Access is resolved from the
    // database on every request, never frozen into the cookie at sign-in — that
    // was the ServiceSuite behaviour this platform was built to fix, and reusing
    // the cookie is what proves it: the person does not sign out, and their
    // launcher still changes. All that has to pass is the 30s resolver cache,
    // which lives in the SERVER's process, not this one.
    console.log(`\n${D("  same session, no re-login — waiting out the 30s rights cache…")}`);
    await new Promise((r) => setTimeout(r, 31_000));

    const suiteAfter = await get("/suite", cookie);
    const booksAfter = await get("/books", cookie);

    console.log(`\n${B("2 · With callcenter + accounting:cash denied")}`);
    check(!/connectdesk.servicesuitecloud.com/i.test(suiteAfter), "ConnectDesk tile is GONE from the launcher");
    check(/Lending Console/i.test(suiteAfter), "the other systems are still there", "denying one door must not empty the launcher");
    check(!/In and out/i.test(booksAfter), "Ledgerly's Cash module is GONE from its sidebar");
    check(/Movement|Journal/i.test(booksAfter), "Ledgerly's other modules survive");
  } finally {
    await runAsPlatform(() =>
      prisma.staffUser.update({ where: { id: staff.id }, data: { access: (original ?? {}) as object } }),
    );
    console.log(`\n${D(`  restored ${staff.firstName}'s access to ${JSON.stringify(original ?? {})}`)}`);
  }

  console.log(failed === 0 ? `\n${G(B("ALL CHECKS PASSED"))}\n` : `\n${R(B(`${failed} CHECK(S) FAILED`))}\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
