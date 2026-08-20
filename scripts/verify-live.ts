// ─────────────────────────────────────────────────────────────────────────────
// PROVE THE DEPLOYED SUITE — every subdomain, every screen, against the live
// Micromart database.
//
//   npm run test:live
//
// This is the check to run before the room fills, and it is deliberately an
// OUTSIDE-IN test: it signs in over the public internet exactly as a supervisor
// will, carries the session across subdomains exactly as the launcher expects,
// and reads the rendered HTML rather than asking the application how it feels.
//
// ── THE THREE THINGS IT SEPARATES ────────────────────────────────────────────
// A 200 is not success. Every screen in this suite is built to degrade honestly,
// which means a page whose database is unreachable still returns 200 and renders
// a named empty state. So each route is judged on what is IN the markup:
//
//   LIVE      real figures present
//   DEGRADED  200, but the page is saying it cannot reach the server — this is
//             the relay being down, and it is the single most likely failure
//   BROKEN    non-200, or an error state
//
// ── AND THE ONE THING IT PROVES THAT NOTHING ELSE DOES ───────────────────────
// SINGLE SIGN-ON ACROSS ORIGINS. The session cookie is issued by one host and
// then sent to five others. That only works if SUITE_COOKIE_DOMAIN is set to the
// parent domain; without it the cookie is host-only, every satellite bounces to
// its own login, and the "six doors, one identity" claim fails in the meeting
// rather than here.
// ─────────────────────────────────────────────────────────────────────────────
import "dotenv/config";

const DOMAIN = process.env.LIVE_DOMAIN || "servicesuitecloud.com";
const EMAIL = process.env.LIVE_EMAIL || "desk.supervisor@micromart.birgenai.com";
const PASSWORD = process.env.LIVE_PASSWORD || "DeskDemo2026!";
const OTP = process.env.LIVE_OTP || "";

const B = (s: string) => `\x1b[1m${s}\x1b[0m`;
const G = (s: string) => `\x1b[32m${s}\x1b[0m`;
const R = (s: string) => `\x1b[31m${s}\x1b[0m`;
const Y = (s: string) => `\x1b[33m${s}\x1b[0m`;
const D = (s: string) => `\x1b[2m${s}\x1b[0m`;

/** host label → the routes that must be live on it, and a marker proving real data landed. */
const PLAN: { host: string; system: string; routes: { path: string; wants: RegExp }[] }[] = [
  {
    host: "lms",
    system: "Lending Console",
    routes: [
      { path: "/suite", wants: /One live book|last payment|Six systems/i },
      { path: "/console", wants: /borrower|portfolio|loan/i },
    ],
  },
  {
    host: "connectdesk",
    system: "ConnectDesk",
    routes: [
      { path: "/desk", wants: /recovered|under collection|agents on the floor/i },
      { path: "/desk/queue", wants: /untouched|balance|queue|case/i },
      { path: "/desk/pipeline", wants: /3005|Fintech|bridge/i },
      { path: "/desk/agents", wants: /agent|recovered/i },
    ],
  },
  {
    host: "peoplehub",
    system: "PeopleHub",
    routes: [
      { path: "/people", wants: /roster|directory|officer/i },
      { path: "/people/officers", wants: /Relationship officers|Weakest coverage/i },
      { path: "/people/branches", wants: /Book per officer|Where the arrears are/i },
    ],
  },
  {
    host: "ledgerly",
    system: "Ledgerly",
    routes: [
      { path: "/books", wants: /movement|journal|account/i },
      { path: "/books/journal", wants: /Postings in the journal|Accounts in the chart/i },
      { path: "/books/flows", wants: /In and out|Collected less disbursed/i },
    ],
  },
  {
    host: "analytics",
    system: "Analytics Studio",
    routes: [{ path: "/", wants: /portfolio|analytics|book/i }],
  },
  {
    host: "microeazy",
    system: "Customer Portal",
    routes: [{ path: "/", wants: /Micro Eazy|apply|loan/i }],
  },
];

/** Markers that mean "this page could not read the database". */
const DEGRADED = /not reachable right now|could not be read|not connected to CollectBox|server unreachable|SQL relay/i;

const strip = (s: string) => s.replace(/&#x27;|&#39;/g, "'").replace(/&rsquo;/g, "'").replace(/&amp;/g, "&");

async function main() {
  console.log(`\n${B("THE DEPLOYED SUITE")}  ${D(DOMAIN)}\n`);

  // ── 1 · The six hosts answer ───────────────────────────────────────────────
  console.log(B("1 · Do the six hosts answer?"));
  let hostsOk = 0;
  for (const p of PLAN) {
    const url = `https://${p.host}.${DOMAIN}/`;
    try {
      const r = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(30000) });
      const ok = r.status < 500;
      if (ok) hostsOk++;
      console.log(`  ${ok ? G("✓") : R("✗")} ${`${p.host}.${DOMAIN}`.padEnd(38)} ${r.status}  ${D(p.system)}`);
    } catch (e) {
      console.log(`  ${R("✗")} ${`${p.host}.${DOMAIN}`.padEnd(38)} ${D(e instanceof Error ? e.message : "unreachable")}`);
    }
  }
  if (hostsOk === 0) {
    console.log(`\n${R("NO HOST ANSWERED")} — DNS or the Vercel domains are not in place.\n`);
    process.exit(1);
  }

  // ── 2 · Sign in, once ──────────────────────────────────────────────────────
  console.log(`\n${B("2 · Sign in")}  ${D(EMAIL)}`);
  const loginUrl = `https://lms.${DOMAIN}/api/auth/login`;
  let res = await fetch(loginUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
    signal: AbortSignal.timeout(30000),
  });
  let body = (await res.json()) as { success?: boolean; message?: string; fallbackCode?: string; otpRequired?: boolean };
  let jar = res.headers.getSetCookie();
  console.log(`  ${D(`password → ${res.status} ${body.otpRequired ? "OTP required" : ""}`)}`);

  const code = body.fallbackCode || OTP;
  if (body.otpRequired && !code) {
    console.log(
      `  ${Y("!")} the daily code was already issued and is not repeated in the response.\n` +
        `     ${D("Get it from the inbox and re-run with LIVE_OTP=nnnnnn, or run:")}\n` +
        `     ${D("npx tsx scripts/reissue-login-code.ts --email=" + EMAIL + " --org=micromart")}`,
    );
    process.exit(1);
  }

  if (code) {
    res = await fetch(loginUrl, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: jar.map((c) => c.split(";")[0]).join("; ") },
      body: JSON.stringify({ email: EMAIL, password: PASSWORD, otp: code }),
      signal: AbortSignal.timeout(30000),
    });
    body = (await res.json()) as typeof body;
    jar = [...jar, ...res.headers.getSetCookie()];
  }
  if (!body.success) {
    console.log(`  ${R("✗")} sign-in failed: ${body.message ?? JSON.stringify(body)}`);
    process.exit(1);
  }
  console.log(`  ${G("✓")} signed in`);

  // ── 3 · Is the session valid on the OTHER five hosts? ──────────────────────
  //
  // The cookie was issued by lms. If SUITE_COOKIE_DOMAIN is set correctly the
  // browser sends it to every satellite; if it is not, this is where we find out
  // rather than in front of the room.
  const sessionCookies = jar.filter((c) => !/Max-Age=0|Expires=Thu, 01 Jan 1970/i.test(c));
  const cookie = sessionCookies.map((c) => c.split(";")[0]).join("; ");
  const domainAttr = sessionCookies.map((c) => /domain=([^;]+)/i.exec(c)?.[1]?.trim()).find(Boolean);

  console.log(`\n${B("3 · Single sign-on across origins")}`);
  if (domainAttr) {
    console.log(`  ${G("✓")} the session cookie is scoped to ${B(domainAttr)} — it will travel to all six doors`);
  } else {
    console.log(
      `  ${R("✗")} the session cookie is HOST-ONLY (no Domain attribute).\n` +
        `     ${D("SUITE_COOKIE_DOMAIN is not set on the deployment. Each subdomain will demand its own sign-in,")}\n` +
        `     ${D("and the \"six doors, one identity\" claim fails. Set it to " + DOMAIN + " and redeploy.")}`,
    );
  }

  // ── 4 · Every route, on its own host ───────────────────────────────────────
  console.log(`\n${B("4 · Every screen, on its own subdomain")}`);
  let live = 0, degraded = 0, broken = 0;

  for (const p of PLAN) {
    console.log(`\n  ${B(p.system)} ${D(`${p.host}.${DOMAIN}`)}`);
    for (const route of p.routes) {
      const url = `https://${p.host}.${DOMAIN}${route.path}`;
      const t = Date.now();
      try {
        const r = await fetch(url, { headers: { cookie }, redirect: "manual", signal: AbortSignal.timeout(45000) });
        const ms = Date.now() - t;

        if (r.status === 307 || r.status === 302) {
          broken++;
          console.log(`    ${R("✗")} ${route.path.padEnd(20)} ${r.status} ${D("bounced to " + (r.headers.get("location") ?? "?").slice(0, 60))}`);
          continue;
        }
        if (r.status !== 200) {
          broken++;
          console.log(`    ${R("✗")} ${route.path.padEnd(20)} ${r.status}`);
          continue;
        }

        const html = strip(await r.text());
        const isDegraded = DEGRADED.test(html);
        const hasData = route.wants.test(html);

        if (isDegraded) {
          degraded++;
          const m = /not reachable right now|could not be read[^<]{0,120}|SQL relay[^<]{0,120}/i.exec(html);
          console.log(`    ${Y("~")} ${route.path.padEnd(20)} 200 ${String(ms).padStart(5)}ms  ${Y("DEGRADED")} ${D(m?.[0]?.slice(0, 80) ?? "")}`);
        } else if (hasData) {
          live++;
          console.log(`    ${G("✓")} ${route.path.padEnd(20)} 200 ${String(ms).padStart(5)}ms  ${D((html.length / 1024).toFixed(0) + "kb")}`);
        } else {
          degraded++;
          console.log(`    ${Y("~")} ${route.path.padEnd(20)} 200 ${String(ms).padStart(5)}ms  ${Y("rendered, but the expected content is not there")}`);
        }
      } catch (e) {
        broken++;
        console.log(`    ${R("✗")} ${route.path.padEnd(20)} ${D(e instanceof Error ? e.message : "failed")}`);
      }
    }
  }

  // ── 5 · The artwork ────────────────────────────────────────────────────────
  console.log(`\n${B("5 · The six login artworks")}`);
  const ART = ["login-lending.png", "login-portal.png", "login-analytics.png", "login-desk.png", "login-people.png", "login-books.png"];
  let art = 0;
  for (const f of ART) {
    try {
      const r = await fetch(`https://lms.${DOMAIN}/images/suite/${f}`, { signal: AbortSignal.timeout(25000) });
      const bytes = Number(r.headers.get("content-length") ?? 0);
      const ok = r.status === 200 && (r.headers.get("content-type") ?? "").startsWith("image");
      if (ok) art++;
      console.log(`  ${ok ? G("✓") : R("✗")} ${f.padEnd(24)} ${r.status}${bytes ? D(`  ${(bytes / 1024).toFixed(0)}kb`) : D("  falls back to a gradient")}`);
    } catch {
      console.log(`  ${R("✗")} ${f.padEnd(24)} ${D("unreachable")}`);
    }
  }

  // ── Verdict ────────────────────────────────────────────────────────────────
  const total = live + degraded + broken;
  console.log(`\n${B("VERDICT")}`);
  console.log(`  ${G(String(live))} live · ${degraded ? Y(String(degraded)) : "0"} degraded · ${broken ? R(String(broken)) : "0"} broken   (${total} routes)`);
  console.log(`  ${art === 6 ? G("6") : Y(String(art))}/6 artworks served`);

  if (degraded > 0) {
    console.log(
      `\n  ${Y("Degraded means the deployment is up but cannot read Micromart.")}\n` +
        `  ${D("Almost always the relay: it is not running, or the funnel dropped, or the")}\n` +
        `  ${D("secret on Vercel differs from the relay host. Run: npm run test:relay")}`,
    );
  }
  console.log("");
  process.exit(broken === 0 && degraded === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
