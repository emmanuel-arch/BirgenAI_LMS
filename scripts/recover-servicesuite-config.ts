// ─────────────────────────────────────────────────────────────────────────────
// RECOVER THE LOST ENVIRONMENT from the live ServiceSuite system.
//
//   DOTENV_CONFIG_PATH=.env npx tsx scripts/recover-servicesuite-config.ts
//   DOTENV_CONFIG_PATH=.env npx tsx scripts/recover-servicesuite-config.ts --org micromart
//   DOTENV_CONFIG_PATH=.env npx tsx scripts/recover-servicesuite-config.ts --reveal
//   DOTENV_CONFIG_PATH=.env npx tsx scripts/recover-servicesuite-config.ts --reveal --write .env.recovered
//
// ── THE SITUATION THIS IS FOR ────────────────────────────────────────────────
// The environment file holding this platform's copy of Micromart's credentials
// went with a laptop. Every one of those values is still in use by the live
// ServiceSuite system, and this platform already holds a read-only connection to
// it (SERVICESUITE_CONN_MICROMART). So the credentials are not lost — they are
// one authenticated SELECT away, and this reads them back and prints them in the
// shape our .env expects.
//
// ── WHAT IT WILL AND WILL NOT DO ─────────────────────────────────────────────
// By default it prints a REPORT: what exists, where, for which entity, and
// whether we could read it — with every value MASKED. That is deliberate. The
// common case is "which of my variables can I get back", and that question does
// not require putting live payment credentials on a terminal that is probably
// being screen-shared.
//
//   --reveal   prints the plaintext. Use it once, in private, and close the tab.
//   --write    writes an env-shaped file instead of printing. Implies --reveal
//              and refuses to overwrite an existing file.
//
// Everything it does is SELECT-only against configuration tables. It never reads
// a borrower, a loan or a payment, and it never writes to their database.
//
// ── WHAT IT CANNOT RECOVER, AND WHY ──────────────────────────────────────────
// Values that were only ever OURS have no copy on their server and must be
// regenerated or re-issued. They are listed at the end of the run so the gap is
// explicit rather than discovered three weeks later by a failing cron. The one
// that matters most is VAULT_MASTER_KEY: if that is lost, every credential
// already saved into OrgIntegration is unreadable, and this script is how you
// refill the vault after rotating it — see scripts/recover-vault-key.ts first.
// ─────────────────────────────────────────────────────────────────────────────
import "dotenv/config";
import { existsSync, writeFileSync } from "fs";
import { ORGS, type OrgSlug } from "../src/lib/enterprise/connections";
import {
  readStkParams, readSmsCredentials, readIntegrationSettings,
  surveyCredentialTables, inventoryProgrammability,
  SETTINGS_TABLES, type ConfigFinding,
} from "../src/lib/enterprise/servicesuite-config";

const argv = process.argv.slice(2);
const flag = (k: string) => argv.includes(`--${k}`);
const opt = (k: string): string | undefined => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 ? argv[i + 1] : undefined;
};

const REVEAL = flag("reveal") || !!opt("write");
const WRITE_TO = opt("write");
const ORG_SLUG = (opt("org") ?? "micromart") as OrgSlug;

/** Never print a credential in full unless asked. */
const mask = (v: string | null): string => {
  if (!v) return "—";
  if (REVEAL) return v;
  return v.length <= 8 ? "•".repeat(v.length) : `${v.slice(0, 3)}${"•".repeat(Math.min(12, v.length - 6))}${v.slice(-3)}`;
};

const line = (s = "") => console.log(s);
const rule = (t: string) => { line(); line(`── ${t} ${"─".repeat(Math.max(0, 68 - t.length))}`); };

async function main() {
  const org = ORGS[ORG_SLUG];
  if (!org) {
    console.error(`Unknown org "${ORG_SLUG}". Known: ${Object.keys(ORGS).join(", ")}`);
    process.exit(1);
  }
  if (!process.env[org.connEnv]) {
    console.error(
      `${org.connEnv} is not set, so there is nothing to read from.\n` +
      `That variable is itself one of the lost ones — it is a SQL Server connection string\n` +
      `of the form: Data Source=<host>,<port>;Initial Catalog=Serviceconnect;user id=<user>;password=<pw>;MultipleActiveResultSets=True\n` +
      `Recover it from the ServiceSuite deployment's appsettings.json (ConnectionStrings.connectionString)\n` +
      `or from whoever administers that server. Nothing below can run without it.`,
    );
    process.exit(1);
  }

  line(`ServiceSuite configuration recovery — ${org.name} (${org.slug})`);
  line(`Reading ${org.connEnv} · ${REVEAL ? "VALUES REVEALED" : "values masked (pass --reveal to show)"}`);

  const recovered: string[] = [];
  const push = (k: string, v: string | null, comment?: string) => {
    if (!v) return;
    if (comment) recovered.push(`# ${comment}`);
    recovered.push(`${k}=${JSON.stringify(v)}`);
  };

  // ── 1. Which credential tables exist here at all ──────────────────────────
  rule("Credential tables on this server");
  const survey = await surveyCredentialTables(org).catch((e) => {
    console.error(`  could not survey: ${e instanceof Error ? e.message : e}`);
    return [];
  });
  for (const t of survey) {
    const state = !t.exists ? "absent" : `${t.rows} row${t.rows === 1 ? "" : "s"}`;
    line(`  ${t.exists ? "✓" : "·"} ${t.table.padEnd(30)} ${state.padEnd(10)} ${t.holds}`);
    if (t.exists && !t.ours.startsWith("none")) line(`      ↳ ours: ${t.ours}`);
    if (t.exists && t.ours.startsWith("none")) line(`      ↳ NO EQUIVALENT HERE — decide whether we need one`);
  }

  // ── 2. M-Pesa / Daraja ────────────────────────────────────────────────────
  rule("M-Pesa STK (Transactions.dbo.StkParams)");
  const entityId = Number(process.env[org.entityEnv] ?? org.defaultEntityId);
  let stk: ConfigFinding[] = [];
  try {
    stk = await readStkParams(org);
  } catch (e) {
    line(`  could not read: ${e instanceof Error ? e.message : e}`);
  }
  if (stk.length === 0) line("  no rows.");
  const byEntity = new Map<number, ConfigFinding[]>();
  for (const f of stk) {
    const list = byEntity.get(f.entityId ?? 0) ?? [];
    list.push(f);
    byEntity.set(f.entityId ?? 0, list);
  }
  for (const [eid, fields] of byEntity) {
    const isOurs = eid === entityId;
    line(`  Entity ${eid}${isOurs ? "  ← the entity this deployment is bound to" : ""}`);
    for (const f of fields) {
      const mark = f.state === "found" ? "✓" : f.state === "empty" ? "·" : "✗";
      line(`    ${mark} ${f.field.padEnd(16)} ${mask(f.value).padEnd(REVEAL ? 44 : 20)} → ${f.mapsTo}`);
      if (f.state === "encrypted-unreadable") {
        line(`        stored but did not decrypt — their Decipher key may have been rotated`);
      }
    }
    if (isOurs) {
      const get = (n: string) => fields.find((f) => f.field === n)?.value ?? null;
      recovered.push("");
      recovered.push("# ── M-Pesa STK, recovered from ServiceSuite ──");
      push("MPESA_CONSUMER_KEY", get("ConsumerKey"));
      push("MPESA_CONSUMER_SECRET", get("ConsumerSecrete"));
      push("MPESA_PASSKEY", get("passkey"));
      push("MPESA_SHORTCODE", get("shortCode"));
      push("MPESA_CALLBACK_URL_THEIRS", get("CallBackUrl"),
        "THEIR callback, for reference only. Ours must be OUR host or their confirmations land here.");
    }
  }

  // ── 3. SMS ────────────────────────────────────────────────────────────────
  rule("SMS — Africa's Talking (africaisTalkingcredentials)");
  try {
    const sms = await readSmsCredentials(org);
    if (sms.length === 0) line("  no rows.");
    const smsByCompany = new Map<number | null, ConfigFinding[]>();
    for (const f of sms) {
      const list = smsByCompany.get(f.entityId) ?? [];
      list.push(f);
      smsByCompany.set(f.entityId, list);
    }
    for (const [cid, fields] of smsByCompany) {
      line(`  company ${cid ?? "—"}`);
      for (const f of fields) {
        line(`    ${f.state === "found" ? "✓" : "·"} ${f.field.padEnd(16)} ${mask(f.value).padEnd(REVEAL ? 44 : 20)} → ${f.mapsTo}`);
      }
      if (cid === entityId || smsByCompany.size === 1) {
        const get = (n: string) => fields.find((f) => f.field === n)?.value ?? null;
        recovered.push("");
        recovered.push("# ── SMS, recovered from ServiceSuite ──");
        recovered.push("# WARNING: these are LIVE credentials. A verify script that finds them SENDS REAL SMS.");
        push("AFRICASTALKING_USERNAME", get("username"));
        push("AFRICASTALKING_API_KEY", get("apiKey"));
        push("AFRICASTALKING_SENDER_ID", get("Senderid"));
      }
    }
    line("  NOTE: this table is PLAINTEXT on their side — no encryption at all.");
  } catch (e) {
    line(`  could not read: ${e instanceof Error ? e.message : e}`);
  }

  // ── 4. IntegrationSettings ────────────────────────────────────────────────
  rule("IntegrationSettings — AI, storage, branding");
  try {
    const integ = await readIntegrationSettings(org);
    if (integ.length === 0) line("  table absent or empty on this server.");
    const found = integ.filter((f) => f.state === "found");
    for (const f of found) {
      line(`    ✓ e${String(f.entityId ?? "—").padEnd(5)} ${f.field.padEnd(26)} ${mask(f.value).padEnd(REVEAL ? 44 : 20)} → ${f.mapsTo}`);
    }
    const empty = integ.filter((f) => f.state === "empty").length;
    if (empty) line(`    · ${empty} column${empty === 1 ? "" : "s"} present but empty.`);

    const mine = found.filter((f) => f.entityId === entityId || f.entityId == null);
    const pick = (n: string) => mine.find((f) => f.field === n)?.value ?? null;
    if (mine.length) {
      recovered.push("");
      recovered.push("# ── Shared services, recovered from ServiceSuite ──");
      push("NEXT_PUBLIC_SUPABASE_URL", pick("SupabaseUrl"));
      push("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", pick("SupabaseAnonKey"));
      push("SUPABASE_SERVICE_ROLE_KEY", pick("SupabaseServiceKey"), "SERVICE ROLE — bypasses row security. Treat as the highest-value secret here.");
      push("ANTHROPIC_API_KEY", pick("AnthropicApiKey"));
    }
  } catch (e) {
    line(`  could not read: ${e instanceof Error ? e.message : e}`);
  }

  // ── 5. Behavioural settings parity ────────────────────────────────────────
  rule("Per-entity settings tables — parity check");
  for (const t of SETTINGS_TABLES) {
    const gap = t.ours.includes("GAP");
    line(`  ${gap ? "!" : "✓"} ${t.table.padEnd(28)} ${t.holds}`);
    line(`      ↳ ${t.ours}`);
  }

  // ── 6. Programmability inventory ──────────────────────────────────────────
  rule("Stored procedures, functions, views, triggers");
  try {
    const objs = await inventoryProgrammability(org);
    const byKind = new Map<string, number>();
    for (const o of objs) byKind.set(o.kind, (byKind.get(o.kind) ?? 0) + 1);
    for (const [kind, n] of [...byKind].sort((a, b) => b[1] - a[1])) {
      line(`  ${String(n).padStart(4)}  ${kind}`);
    }
    line();
    line("  These are NOT to be ported. Our business logic lives in TypeScript, under");
    line("  test, in version control — not in several hundred uncovered T-SQL procedures.");
    line("  What matters is that every BEHAVIOUR one of them encodes exists here too, and");
    line("  the inventory is what makes that checkable rather than a matter of opinion.");
    const recent = objs
      .filter((o) => o.modified)
      .sort((a, b) => (b.modified ?? "").localeCompare(a.modified ?? ""))
      .slice(0, 10);
    if (recent.length) {
      line();
      line("  Most recently changed — the parts of their system still moving:");
      for (const o of recent) line(`    ${(o.modified ?? "").slice(0, 10)}  ${o.kind.padEnd(18)} ${o.name}`);
    }
  } catch (e) {
    line(`  could not inventory: ${e instanceof Error ? e.message : e}`);
  }

  // ── 7. What cannot be recovered from them ─────────────────────────────────
  rule("NOT recoverable from ServiceSuite — these are ours alone");
  const OURS_ONLY: Array<[string, string]> = [
    ["VAULT_MASTER_KEY", "AES-256-GCM key for OrgIntegration.configEnc. If lost, every saved credential is unreadable — try scripts/recover-vault-key.ts BEFORE rotating. After rotating, re-enter the values this script recovered."],
    ["DATABASE_URL / DIRECT_URL", "Our Postgres. From the Supabase dashboard."],
    ["NEXTAUTH_SECRET", "Session signing. Regenerate — every session is invalidated, nothing else breaks. MUST match across every suite satellite."],
    ["CRON_SECRET", "Bearer token on /api/cron. Regenerate and update the scheduler."],
    ["SERVICESUITE_HOOK_SECRET", "Shared with ServiceSuite's outbound webhook. Regenerate ON BOTH SIDES or their callbacks start failing."],
    ["PLATFORM_ADMIN_SECRET", "Platform admin door. Regenerate."],
    ["SUITE_COOKIE_DOMAIN", "birgenai.com in production, blank locally."],
    ["NEXT_PUBLIC_GOOGLE_MAPS_API_KEY", "Google Cloud console."],
    ["GOOGLE_CLOUD_API_KEY / AWS_*", "KYC providers — their own consoles."],
    ["ORIGINATION_SCORER_URL / SCORER_V1_URL", "Our own model endpoints."],
    ["HUB_BILLING_URL / LMS_BILLING_SECRET", "Hub billing pair."],
    ["METROPOL keys", "The bureau. Currently a TEST pair; production keys are outstanding with Metropol — they go in the vault, not in env."],
  ];
  for (const [k, why] of OURS_ONLY) {
    const have = !!process.env[k.split(" ")[0]];
    line(`  ${have ? "✓ set" : "✗ MISSING"}  ${k}`);
    line(`      ${why}`);
  }

  // ── 8. Output ─────────────────────────────────────────────────────────────
  if (WRITE_TO) {
    if (existsSync(WRITE_TO)) {
      console.error(`\nRefusing to overwrite ${WRITE_TO}. Delete it or choose another path.`);
      process.exit(1);
    }
    const body = [
      "# Recovered from the live ServiceSuite system by",
      "# scripts/recover-servicesuite-config.ts",
      `# ${new Date().toISOString()} · org: ${org.slug}, entity ${entityId}`,
      "#",
      "# THESE ARE LIVE PRODUCTION CREDENTIALS. Merge what you need into .env and",
      "# delete this file. Do not commit it — .env* is gitignored, this name may not be.",
      "",
      ...recovered,
      "",
    ].join("\n");
    writeFileSync(WRITE_TO, body, { encoding: "utf8", mode: 0o600 });
    line();
    line(`Wrote ${recovered.filter((l) => !l.startsWith("#") && l).length} value(s) to ${WRITE_TO} (mode 0600).`);
    line("Merge what you need into .env and delete it.");
  } else if (REVEAL && recovered.length) {
    rule("Env block");
    line(recovered.join("\n"));
  } else if (recovered.length) {
    line();
    line(`${recovered.filter((l) => !l.startsWith("#") && l).length} value(s) are recoverable. Re-run with --reveal to see them,`);
    line("or --write .env.recovered to put them in a file.");
  }

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
