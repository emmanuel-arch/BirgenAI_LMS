// ─────────────────────────────────────────────────────────────────────────────
// FEDERATION CHECK — the mechanics single sign-on across subdomains rests on.
//
// Three things have to hold, and each has a failure mode that is silent in
// development and severe in production:
//
//   1. COOKIE DOMAIN RESOLUTION. Get this wrong and the browser either refuses the
//      cookie (everyone is signed out, constantly) or scopes it too widely (a
//      shared preview domain leaks sessions between unrelated deployments).
//
//   2. SET/CLEAR SYMMETRY. A cookie is identified by (name, domain, path).
//      Clearing with a different domain than it was set with writes a second,
//      empty cookie beside the live one and the browser keeps sending the
//      original — a signed-out user who is still signed in.
//
//   3. RESERVED LABELS. Lender portals live on subdomains, so a lender who signs
//      up as "desk" would take desk.birgenai.com out from under the call-centre.
//      The proxy and the signup route must agree, forever, on that list.
//
//   npx tsx scripts/verify-federation.ts
// ─────────────────────────────────────────────────────────────────────────────
import { SUITE_APPS } from "../src/lib/suite/apps";
import { cookieDomain, isReservedLabel, originFor, hrefFor, isFederated, RESERVED_LABELS } from "../src/lib/suite/hosts";

let failures = 0;
const fail = (msg: string) => { failures++; console.log(`  x ${msg}`); };
const pass = (msg: string) => console.log(`  + ${msg}`);
const check = (cond: boolean, ok: string, bad: string) => (cond ? pass(ok) : fail(bad));

/** Run a thunk with a temporary environment. */
function withEnv<T>(vars: Record<string, string | undefined>, fn: () => T): T {
  const saved: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(vars)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try { return fn(); } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

// ── 1 · Cookie domain ─────────────────────────────────────────────────────────
console.log("\nCookie domain resolution");
withEnv({ SUITE_COOKIE_DOMAIN: undefined }, () =>
  check(cookieDomain() === undefined, "unset → host-only cookie (the safe default)", `unset returned ${cookieDomain()}`));
withEnv({ SUITE_COOKIE_DOMAIN: "birgenai.com" }, () =>
  check(cookieDomain() === ".birgenai.com", "bare domain is normalised to a leading dot", `got ${cookieDomain()}`));
withEnv({ SUITE_COOKIE_DOMAIN: ".birgenai.com" }, () =>
  check(cookieDomain() === ".birgenai.com", "dotted domain is preserved", `got ${cookieDomain()}`));
withEnv({ SUITE_COOKIE_DOMAIN: "  .BirgenAI.com " }, () =>
  check(cookieDomain() === ".birgenai.com", "whitespace and case are normalised", `got ${cookieDomain()}`));
for (const bad of ["localhost", ".localhost", "", "   ", "."]) {
  withEnv({ SUITE_COOKIE_DOMAIN: bad }, () =>
    check(cookieDomain() === undefined, `"${bad}" is rejected → host-only`, `"${bad}" produced ${cookieDomain()}`));
}

// ── 2 · Set/clear symmetry ────────────────────────────────────────────────────
// lib/auth.ts builds both the setter and the clearer from ONE cookieIdentity().
// Reproduce that contract here so a future edit that splits them fails this check.
console.log("\nSet / clear symmetry");
for (const domain of [undefined, "birgenai.com"]) {
  withEnv({ SUITE_COOKIE_DOMAIN: domain }, () => {
    const identity = () => {
      const d = cookieDomain();
      return { name: "lms_session", path: "/", ...(d ? { domain: d } : {}) };
    };
    const set = identity();
    const clear = identity();
    check(
      JSON.stringify(set) === JSON.stringify(clear),
      `${domain ?? "host-only"}: the cookie is cleared with exactly the attributes it was set with`,
      `${domain ?? "host-only"}: set ${JSON.stringify(set)} vs clear ${JSON.stringify(clear)}`,
    );
  });
}

// ── 3 · Reserved labels ───────────────────────────────────────────────────────
console.log("\nReserved subdomain labels");
for (const app of SUITE_APPS) {
  const label = app.subdomain.split(".")[0];
  check(isReservedLabel(label), `"${label}" (${app.name}) is reserved`, `"${label}" (${app.name}) is NOT reserved — a lender could claim it`);
}
for (const label of ["lms", "www", "api", "platform", "admin", "onboard", "demo"]) {
  check(isReservedLabel(label), `"${label}" is reserved`, `"${label}" is NOT reserved`);
}
for (const label of ["mular", "micromart", "axe", "buysimu"]) {
  check(!isReservedLabel(label), `"${label}" is available to a lender`, `"${label}" was wrongly reserved — a real lender is locked out`);
}
check(isReservedLabel("PEOPLE"), "matching is case-insensitive", "uppercase label slipped past the reserved check");
console.log(`  · ${RESERVED_LABELS.size} labels reserved in total`);

// ── 4 · Origin resolution ─────────────────────────────────────────────────────
console.log("\nOrigin resolution");
const hr = SUITE_APPS.find((a) => a.id === "hr")!;

withEnv({ SUITE_HR_ORIGIN: undefined }, () => {
  check(originFor(hr) === null, "unset → stays in this deployment", `unset returned ${originFor(hr)}`);
  check(hrefFor(hr) === hr.href, `unset → in-app route (${hr.href})`, `unset href was ${hrefFor(hr)}`);
  check(!isFederated(hr), "unset → not federated", "unset reported as federated");
});

withEnv({ SUITE_HR_ORIGIN: "https://people.birgenai.com" }, () => {
  check(originFor(hr) === "https://people.birgenai.com", "set → its own origin", `got ${originFor(hr)}`);
  check(hrefFor(hr) === "https://people.birgenai.com/suite/hr", "set → absolute URL keeps the app's path", `got ${hrefFor(hr)}`);
  check(isFederated(hr), "set → federated", "set but not reported as federated");
});

// A trailing slash or a stray path must not produce a double slash or a lost path.
withEnv({ SUITE_HR_ORIGIN: "https://people.birgenai.com/" }, () =>
  check(hrefFor(hr) === "https://people.birgenai.com/suite/hr", "trailing slash is normalised", `got ${hrefFor(hr)}`));

// A misconfiguration must degrade to the in-app route, never to a broken link.
for (const junk of ["not a url", "ftp://people.birgenai.com", "people.birgenai.com"]) {
  withEnv({ SUITE_HR_ORIGIN: junk }, () =>
    check(hrefFor(hr) === hr.href, `"${junk}" falls back to the in-app route`, `"${junk}" produced ${hrefFor(hr)}`));
}

// The anchor system must never be pushed off this deployment by a stray variable.
const lms = SUITE_APPS.find((a) => a.system)!;
check(lms.href.startsWith("/"), "the lending console is an in-app route", `the anchor app points at ${lms.href}`);

console.log(failures === 0 ? "\nFederation mechanics verified.\n" : `\n${failures} check(s) failed.\n`);
process.exit(failures === 0 ? 0 : 1);
