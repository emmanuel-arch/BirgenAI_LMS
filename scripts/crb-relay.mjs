// ─────────────────────────────────────────────────────────────────────────────
// THE CRB RELAY SERVER — the one process that runs on a whitelisted address.
//
//   node scripts/crb-relay.mjs          # listens on 127.0.0.1:8788
//   npm run relay:crb                   # same, if npm happens to be present
//
// ── WHY THIS IS PLAIN .mjs AND NOT TypeScript ────────────────────────────────
// DELIBERATE, AND PLEASE DO NOT "FIX" IT. This file has to run on MicroMart's
// SQL Server box, which has no npm, no toolchain and no checkout of this repo.
// A .ts file would need `tsx`, which needs `npm install`, which needs a package
// manager and outbound internet on a production database server. So this file
// imports NOTHING but two Node builtins and can be copied onto a machine on its
// own and started with `node crb-relay.mjs`. Zero dependencies is a deployment
// feature here, not an oversight.
//
// THE COST, STATED PLAINLY: crbVerify() and isAllowedBureauUrl() below are a
// second copy of the same logic in src/lib/crb/relay.ts, which the Next.js app
// uses for the CLIENT half. They must stay in step — same HMAC formula, same
// skew, same allowlist. This is the same twin arrangement this codebase already
// runs between metropol.ts and the C# MetropolCrb.cs. Change one, change both.
//
// ── WHERE IT HAS TO RUN ──────────────────────────────────────────────────────
// On a machine whose PUBLIC IP is registered with Metropol. As of the
// 2026-08-27 whitelist form those are:
//
//     102.214.69.233   the IIS production server (servicesuitecloud.com)
//     102.210.148.110  the MicroMart site
//
// WHICH TAILNET NODE PRESENTS WHICH OF THOSE IS NOT OBVIOUS, and has already
// been guessed wrong once. SETTLED ON 2026-08-27:
//
//     lms       egresses from 102.210.148.110 — the MicroMart site, ON the form.
//               `tailscale ping lms` reports "via 102.210.148.110:41641", and an
//               entitlement sweep through a relay running there came back
//               8/8 ENTITLED against the production port. This is the box.
//     services  egresses from 102.210.148.124 — NOT on the form. Same site, same
//               /24, one wrong host. Do not use it.
//
// So the relay belongs on `lms`, and that is where it runs.
//
// Anywhere else and every bureau call is dropped at Metropol's edge with no
// response at all. On boot this process prints the address it actually egresses
// from, so "am I on the right box" is answered before anything else is debugged.
//
// ── EXPOSING IT ──────────────────────────────────────────────────────────────
// Binds to LOOPBACK on purpose. It is published by a tunnel, never by opening a
// port on a router:
//
//     tailscale funnel 8788
//
// NOTE THE ASYMMETRY, IT IS THE WHOLE POINT: the tunnel changes where the relay
// can be REACHED. It does not change where the relay CALLS FROM. Outbound calls
// still leave from this machine's own public IP, which is the address Metropol
// checks. Funnelling a relay that runs on the office laptop does not make the
// office laptop whitelisted.
//
// ── THE FUNNEL IS NOT OPTIONAL FOR VERCEL, AND THIS IS THE TRAP ──────────────
// A relay reachable only on the TAILNET works perfectly from any machine that is
// itself on the tailnet — a developer laptop runs the whole entitlement sweep
// green and concludes the bureau link is healthy. Vercel is not on the tailnet.
//
// So CRB_RELAY_URL="http://100.92.236.116:8788" (an lms tailnet address) is
// CORRECT for local development and DEAD in production: 100.64.0.0/10 is CGNAT
// space, unroutable from the public internet. Serverless functions cannot open
// that socket, every bureau call from the live site fails at the relay hop, and
// nothing about the symptom mentions the tailnet.
//
// Two different values for two different callers, and both must be set:
//
//     .env on a tailnet machine   CRB_RELAY_URL=http://100.92.236.116:8788
//     Vercel (production)         CRB_RELAY_URL=https://lms.<tailnet>.ts.net
//
// The funnel URL also works from the tailnet, so the public one is the safer
// default if you only want to remember a single value.
//
// ── WHY THIS IS NOT AN OPEN PROXY ────────────────────────────────────────────
//   1. EVERY request carries an HMAC-SHA256 over `${timestamp}.${exact body}`,
//      verified in constant time. No signature, no call.
//   2. The signature covers the BODY, so a captured request cannot be edited.
//      It covers the TIMESTAMP, so it cannot be replayed after two minutes.
//   3. THE TARGET HOST IS ALLOWLISTED HERE, not trusted from the caller.
//      Without that rule a leaked secret is an SSRF primitive pointed at the
//      cloud metadata service and at the tailnet.
//   4. Only the bureau's own auth headers are forwarded. Cookies, authorization
//      headers and anything else a caller smuggles are dropped.
//   5. NOTHING THAT COULD CARRY A CREDENTIAL IS LOGGED. Metropol's key and hash
//      travel in headers on every call; the log line is endpoint, api_code,
//      status and duration, never a header value.
//
// A leaked CRB_RELAY_SECRET is the one thing that matters. It is NOT the
// Metropol key pair — those stay in the caller's vault and pass through as
// opaque headers. Rotating it is: change it here, change it on Vercel, restart.
// ─────────────────────────────────────────────────────────────────────────────
import { createServer } from "node:http";
import { createHmac, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";

// ── Kept in step with src/lib/crb/relay.ts ───────────────────────────────────
const CRB_RELAY_SKEW_MS = 120_000;
const CRB_RELAY_TS_HEADER = "x-crb-relay-ts";
const CRB_RELAY_SIG_HEADER = "x-crb-relay-sig";
const CRB_RELAY_ALLOWED_HOSTS = ["api.metropol.co.ke"];
/**
 * Addresses Metropol actually answers — the two from the 2026-08-27 form.
 *
 * WHAT IS PROVEN, AND ON WHICH BOX (this distinction has already been got wrong
 * once, so it is written down):
 *
 *   lms       Test-NetConnection api.metropol.co.ke -Port 22225
 *             -> TcpTestSucceeded: True.  REACHES PRODUCTION. Its egress
 *                address has not been recorded yet; run this relay there and
 *                read the boot line to find out which registered address it
 *                presents.
 *   services  egresses from 102.210.148.124, which is NOT on the form. The
 *             port test has NOT been run there. Unconfirmed — do not assume it
 *             works because it sits in the same /24 as the registered .110.
 *
 * Port 22225 does not open for unregistered addresses at all: from an
 * un-whitelisted link the connection hangs and dies rather than refusing. So a
 * completed TCP handshake is direct evidence of entitlement — and nothing goes
 * on this list without that test, run ON the box in question.
 */
const WHITELISTED_EGRESS = ["102.214.69.233", "102.210.148.110"];

const crbSign = (secret, ts, body) =>
  createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex");

function crbVerify(secret, ts, body, sig) {
  const a = Buffer.from(crbSign(secret, ts, body), "utf8");
  const b = Buffer.from(sig ?? "", "utf8");
  if (a.length !== b.length) return false;
  if (!timingSafeEqual(a, b)) return false;
  const age = Math.abs(Date.now() - Number(ts));
  return Number.isFinite(age) && age <= CRB_RELAY_SKEW_MS;
}

function isAllowedBureauUrl(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  return u.protocol === "https:" && CRB_RELAY_ALLOWED_HOSTS.includes(u.hostname);
}
// ── end of the mirrored section ──────────────────────────────────────────────

// Node 18 is the floor: this file uses global fetch and AbortSignal.timeout,
// neither of which exists in 16. On 16 the failure is a bare "fetch is not
// defined" thrown per request, long after the relay has apparently started
// fine — so it is checked once, up front, with an instruction attached.
const NODE_MAJOR = Number(process.versions.node.split(".")[0]);
if (NODE_MAJOR < 18) {
  console.error(
    `\n\x1b[31m✗ Node ${process.versions.node} is too old.\x1b[0m This relay needs Node 18 or newer\n` +
      "  (it uses global fetch and AbortSignal.timeout). Install the current LTS from\n" +
      "  https://nodejs.org — the Windows .msi, default options, no other setup.\n",
  );
  process.exit(1);
}

/**
 * Fill in missing env vars from a .env sitting next to the repo, if there is
 * one. Twelve lines rather than `dotenv` because the whole point of this file
 * is that it runs with no node_modules at all; on the server there IS no .env
 * and this simply does nothing. Real environment variables always win, so
 * `set CRB_RELAY_SECRET=…` overrides a stale file.
 */
function loadDotEnvIfPresent() {
  const path = new URL("../.env", import.meta.url);
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return; // no .env — expected on the relay host
  }
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1];
    if (process.env[key] !== undefined) continue;
    process.env[key] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}
loadDotEnvIfPresent();

const PORT = Number(process.env.CRB_RELAY_PORT || 8788);
const HOST = process.env.CRB_RELAY_HOST || "127.0.0.1";
const SECRET = (process.env.CRB_RELAY_SECRET ?? "").trim();

/** Bodies are bureau JSON — small. A megabyte is already absurd; refuse beyond it. */
const MAX_BODY = 1_000_000;

if (!SECRET) {
  console.error(
    "\n\x1b[31m✗ CRB_RELAY_SECRET is not set.\x1b[0m The relay refuses to start without it —\n" +
      "  an unauthenticated egress hop on a whitelisted IP is worse than no hop.\n\n" +
      "  Windows (this shell only):   set CRB_RELAY_SECRET=<the secret>\n" +
      "  Windows (persistent):        setx CRB_RELAY_SECRET \"<the secret>\"  then reopen the shell\n" +
      "  PowerShell:                  $env:CRB_RELAY_SECRET = '<the secret>'\n",
  );
  process.exit(1);
}

/**
 * Headers we will forward. Metropol authenticates on the three X-METROPOL-*
 * values, and the body must be sent as the caller framed it.
 *
 * An allowlist rather than a denylist: a caller that can add arbitrary headers
 * to a request leaving a whitelisted, trusted IP is a confused-deputy waiting to
 * happen, and the set the bureau actually reads is this short.
 */
const FORWARDABLE = new Set([
  "content-type",
  "x-metropol-rest-api-key",
  "x-metropol-rest-api-hash",
  "x-metropol-rest-api-timestamp",
]);

function send(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error("Body too large."));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

const started = new Date();
let served = 0;
let refused = 0;

const server = createServer(async (req, res) => {
  const url = req.url ?? "/";

  // Liveness. Deliberately says nothing about the bureau, the keys or the
  // network: this endpoint is public, and an unauthenticated caller does not get
  // to ask what this box can see.
  if (req.method === "GET" && (url === "/health" || url === "/")) {
    return send(res, 200, {
      ok: true,
      service: "crb-relay",
      since: started.toISOString(),
      served,
      refused,
    });
  }

  if (req.method !== "POST" || !url.startsWith("/crb")) {
    return send(res, 404, { ok: false, error: "Not found." });
  }

  let raw;
  try {
    raw = await readBody(req);
  } catch {
    refused++;
    return send(res, 413, { ok: false, error: "Body too large." });
  }

  const ts = String(req.headers[CRB_RELAY_TS_HEADER] ?? "");
  const sig = String(req.headers[CRB_RELAY_SIG_HEADER] ?? "");
  if (!crbVerify(SECRET, ts, raw, sig)) {
    refused++;
    // No detail. A caller that cannot sign does not learn whether it failed on
    // the signature or on the clock.
    return send(res, 401, { ok: false, error: "Unauthorised." });
  }

  let reqBody;
  try {
    reqBody = JSON.parse(raw);
  } catch {
    return send(res, 400, { ok: false, error: "Malformed request." });
  }

  // Rule 3. The caller named a URL; this is where that name stops being trusted.
  if (!isAllowedBureauUrl(reqBody.url)) {
    refused++;
    console.warn(`  ✗ refused non-bureau target (allowed: ${CRB_RELAY_ALLOWED_HOSTS.join(", ")})`);
    return send(res, 403, {
      ok: false,
      error: `This relay only calls ${CRB_RELAY_ALLOWED_HOSTS.join(", ")}.`,
    });
  }

  const method = reqBody.method === "GET" ? "GET" : "POST";
  const headers = {};
  for (const [k, v] of Object.entries(reqBody.headers ?? {})) {
    if (FORWARDABLE.has(k.toLowerCase()) && typeof v === "string") headers[k] = v;
  }

  const timeoutMs = Math.min(Math.max(Number(reqBody.timeoutMs) || 30_000, 1_000), 120_000);
  const startedAt = Date.now();
  let path = "?";
  try {
    path = new URL(reqBody.url).pathname;
  } catch {
    /* already validated above; only for the log line */
  }

  try {
    const upstream = await fetch(reqBody.url, {
      method,
      headers,
      body: method === "GET" ? undefined : (reqBody.body ?? ""),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await upstream.text();
    const elapsedMs = Date.now() - startedAt;
    served++;

    // api_code is the one field worth logging — it is the difference between
    // "entitled", "not authorized" and "hash mismatch", and it is not a secret.
    let apiCode = "";
    try {
      const j = JSON.parse(text);
      if (j.api_code !== undefined && j.api_code !== null) apiCode = String(j.api_code);
    } catch {
      apiCode = "non-JSON";
    }
    console.log(`  → ${path} ${upstream.status} ${apiCode ? `[${apiCode}]` : ""} ${elapsedMs}ms`);

    return send(res, 200, { ok: true, status: upstream.status, text, elapsedMs });
  } catch (e) {
    refused++;
    const aborted = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    const elapsedMs = Date.now() - startedAt;
    console.warn(`  ✗ ${path} ${aborted ? "timeout" : "unreachable"} after ${elapsedMs}ms`);
    return send(res, 200, {
      ok: false,
      error: aborted
        ? `Metropol did not answer within ${timeoutMs}ms.`
        : "Could not reach Metropol from the relay host. If this is a bare connection failure rather " +
          "than an api_code, this machine's public IP is almost certainly not on Metropol's whitelist.",
    });
  }
});

server.listen(PORT, HOST, async () => {
  console.log(`\n\x1b[1mCRB relay\x1b[0m listening on http://${HOST}:${PORT}`);
  console.log(`  node ${process.version}`);
  console.log(`  forwards only to: ${CRB_RELAY_ALLOWED_HOSTS.join(", ")}`);

  // The single most useful line this process can print. Metropol checks the
  // SOURCE address of the call, so an operator's first question is always "is
  // this box the whitelisted one?" — answer it on boot rather than after an
  // hour of reading E-codes that never arrive.
  try {
    const r = await fetch("https://api.ipify.org", { signal: AbortSignal.timeout(8_000) });
    const ip = (await r.text()).trim();
    const known = WHITELISTED_EGRESS.includes(ip);

    // The near-miss case is worth calling out separately, because it is the one
    // that actually happened: the `services` box egresses from 102.210.148.124
    // while the whitelist form recorded 102.210.148.110 — same site, same /24,
    // one wrong host. Reported as a flat "not on the list" that reads like the
    // wrong machine was chosen, when the likelier truth is a wrong digit on a
    // form, and the two have completely different fixes.
    const slash24 = (a) => a.split(".").slice(0, 3).join(".");
    const neighbour = WHITELISTED_EGRESS.find((w) => slash24(w) === slash24(ip));

    console.log(
      `  egress IP:        ${ip}  ${known ? "\x1b[32m✓ on the 2026-08-27 whitelist\x1b[0m" : "\x1b[33m⚠ NOT on the whitelist form\x1b[0m"}`,
    );

    if (!known && neighbour) {
      console.log(
        `\n  \x1b[33mNEAR MISS. ${ip} is in the same /24 as the registered ${neighbour},\n` +
          `  so this is probably the right SITE with the wrong HOST written on the form.\n` +
          `  Settle it without guessing — on this machine run:\n\n` +
          `      Test-NetConnection api.metropol.co.ke -Port 22225\n\n` +
          `  Port 22225 does not open for unregistered addresses at all, so a TCP\n` +
          `  connect is proof of entitlement and a hang is proof of the opposite.\n` +
          `  If it hangs, either ask Metropol to correct ${neighbour} to ${ip}, or move\n` +
          `  this relay to 102.214.69.233, which is confirmed registered.\x1b[0m`,
      );
    } else if (!known) {
      console.log(
        `\n  \x1b[33mBureau calls from this host will be dropped at Metropol's edge with no\n` +
          `  response. Registered addresses: ${WHITELISTED_EGRESS.join(", ")}.\n` +
          `  Confirm with:  Test-NetConnection api.metropol.co.ke -Port 22225\x1b[0m`,
      );
    }
  } catch {
    console.log("  egress IP:        (could not determine — no route to api.ipify.org)");
  }

  console.log(`\n  Publish it:   \x1b[1mtailscale funnel ${PORT}\x1b[0m`);
  console.log(`  Then set:     \x1b[1mCRB_RELAY_URL\x1b[0m + \x1b[1mCRB_RELAY_SECRET\x1b[0m on the caller\n`);
});
