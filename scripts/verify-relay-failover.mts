// ─────────────────────────────────────────────────────────────────────────────
// Does the SQL transport actually survive a relay going down?
//
// The whole point of listing more than one relay is that a salesmaster restart
// stops being an estate-wide outage. That claim is worth exactly nothing until
// something proves it, and it cannot be proved by reading the code — the
// interesting cases are a half-open socket, a gateway status, and the rule that
// a WRITE must not be retried on another road.
//
// So this stands up real HTTP servers that behave like relays behaving badly,
// and drives the real client against them.
//
//   npx tsx scripts/verify-relay-failover.ts
//
// No database, no tailnet, no secrets. It never reaches SQL Server: the fake
// relays answer in the relay's own wire format, which is the only contract the
// client has with them.
// ─────────────────────────────────────────────────────────────────────────────
import http from "node:http";
import type { AddressInfo } from "node:net";
import mssql from "mssql";
import { relayQuery, relayRoadState, verify, RELAY_TS_HEADER, RELAY_SIG_HEADER } from "../src/lib/enterprise/relay";

process.env.SERVICESUITE_RELAY_SECRET = "x".repeat(64);


const SECRET = process.env.SERVICESUITE_RELAY_SECRET!;

type Behaviour = "ok" | "dead" | "gateway" | "sqlerror";

interface Fake {
  url: string;
  hits: () => number;
  setBehaviour: (b: Behaviour) => void;
  close: () => Promise<void>;
}

async function fakeRelay(initial: Behaviour, label: string): Promise<Fake> {
  let behaviour = initial;
  let hits = 0;

  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      hits++;
      // The signature is checked for real: a failover that quietly sent an
      // unsigned request to the spare relay would "work" here and be refused in
      // production, which is the kind of green test that costs a demo.
      const ts = String(req.headers[RELAY_TS_HEADER] ?? "");
      const sig = String(req.headers[RELAY_SIG_HEADER] ?? "");
      if (!verify(SECRET, ts, body, sig)) {
        res.writeHead(401).end(JSON.stringify({ ok: false, error: "bad signature" }));
        return;
      }
      if (behaviour === "gateway") {
        res.writeHead(503).end("upstream restarting");
        return;
      }
      if (behaviour === "sqlerror") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: "Invalid column name 'Nope'." }));
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({ ok: true, columns: ["who"], rows: [{ who: label }], rowCount: 1, elapsedMs: 1 }),
      );
    });
  });

  // "dead" is a server that is not listening at all — a restarting box, which is
  // the actual failure being defended against. Everything else listens.
  if (initial !== "dead") {
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  }
  const port = initial !== "dead" ? (server.address() as AddressInfo).port : 59999;

  return {
    url: `http://127.0.0.1:${port}`,
    hits: () => hits,
    setBehaviour: (b) => (behaviour = b),
    close: () =>
      new Promise<void>((r) => {
        if (initial === "dead") return r();
        server.close(() => r());
      }),
  };
}

const org = { slug: "micromart", name: "Micromart Africa" } as never;
const q = (kind: "read" | "exec" | "proc" = "read") =>
  relayQuery(kind, org, "SELECT 1", [{ name: "entityId", type: mssql.Int, value: 3005 }], { timeoutMs: 3000 });

let failed = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) console.log(`  \x1b[32mPASS\x1b[0m  ${name}`);
  else {
    failed++;
    console.log(`  \x1b[31mFAIL\x1b[0m  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

console.log("\nSQL relay failover\n");

// ── 1 · A dead primary must not be an outage ────────────────────────────────
{
  const dead = await fakeRelay("dead", "dead");
  const alive = await fakeRelay("ok", "secondary");
  process.env.SERVICESUITE_RELAY_URL = `${dead.url},${alive.url}`;
  (globalThis as Record<string, unknown>).__ssRelayRoad = null;

  const r = await q().catch((e) => e as Error);
  check(
    "a read fails over when the primary is not listening",
    !(r instanceof Error) && (r as unknown as { rows: { who: string }[] }).rows[0].who === "secondary",
    r instanceof Error ? r.message : "",
  );
  check("the working road becomes sticky", relayRoadState().active === alive.url);

  // ── 2 · Stickiness must actually skip the dead box ─────────────────────────
  const before = alive.hits();
  await q();
  check("a second read goes straight to the sticky road", alive.hits() === before + 1);

  await dead.close();
  await alive.close();
}

// ── 3 · A gateway status is a broken road, not an answer ────────────────────
{
  const restarting = await fakeRelay("gateway", "restarting");
  const alive = await fakeRelay("ok", "secondary");
  process.env.SERVICESUITE_RELAY_URL = `${restarting.url},${alive.url}`;
  (globalThis as Record<string, unknown>).__ssRelayRoad = null;

  const r = await q().catch((e) => e as Error);
  check(
    "a 503 from a restarting relay fails over",
    !(r instanceof Error) && (r as unknown as { rows: { who: string }[] }).rows[0].who === "secondary",
    r instanceof Error ? r.message : "",
  );

  await restarting.close();
  await alive.close();
}

// ── 4 · A SQL error is an ANSWER and must not be retried ────────────────────
{
  const bad = await fakeRelay("sqlerror", "primary");
  const alive = await fakeRelay("ok", "secondary");
  process.env.SERVICESUITE_RELAY_URL = `${bad.url},${alive.url}`;
  (globalThis as Record<string, unknown>).__ssRelayRoad = null;

  const r = await q().catch((e) => e as Error);
  check(
    "a SQL error surfaces instead of failing over",
    r instanceof Error && r.message.includes("Invalid column name"),
    r instanceof Error ? r.message : "unexpectedly succeeded",
  );
  check("the second relay was never asked the same broken query", alive.hits() === 0);

  await bad.close();
  await alive.close();
}

// ── 5 · A WRITE must never move roads ───────────────────────────────────────
// The one that matters most. A proc that timed out may still have run, and the
// second attempt posts the loan twice.
{
  const dead = await fakeRelay("dead", "dead");
  const alive = await fakeRelay("ok", "secondary");
  process.env.SERVICESUITE_RELAY_URL = `${dead.url},${alive.url}`;
  (globalThis as Record<string, unknown>).__ssRelayRoad = null;

  const r = await q("proc").catch((e) => e as Error);
  check("a stored procedure does NOT fail over", r instanceof Error, "it failed over — a loan could post twice");
  check("the spare relay never saw the write", alive.hits() === 0);
  check(
    "and the error says why it was not retried",
    r instanceof Error && /NOT retried/i.test(r.message),
    r instanceof Error ? r.message : "",
  );

  const e = await q("exec").catch((err) => err as Error);
  check("an exec does NOT fail over either", e instanceof Error);

  await dead.close();
  await alive.close();
}

// ── 6 · Every road down is still a clear message ────────────────────────────
{
  const d1 = await fakeRelay("dead", "a");
  process.env.SERVICESUITE_RELAY_URL = `${d1.url}`;
  (globalThis as Record<string, unknown>).__ssRelayRoad = null;
  const r = await q().catch((e) => e as Error);
  check(
    "a total outage names the roads it tried",
    r instanceof Error && /Tried:/.test(r.message),
    r instanceof Error ? r.message : "",
  );
  await d1.close();
}

console.log(failed === 0 ? "\n\x1b[32mAll good\x1b[0m\n" : `\n\x1b[31m${failed} failed\x1b[0m\n`);
process.exit(failed === 0 ? 0 : 1);
