// ─────────────────────────────────────────────────────────────────────────────
// Prove the console button's path end to end, without a browser session.
//
//   npx tsx scripts/verify-interchange-report.ts --application <id> [--live]
//
// It walks exactly what POST /api/console/interchange/report walks — resolve the
// borrower, check their consent, tokenise, register a consent_ref, request the
// report through the Registry — and stops short of writing the KycCheck row, so
// running it does not leave a bureau file on a borrower's record.
//
// ⚠ --live SPENDS MONEY. Without it, nothing leaves the building: the script
// reports what it would ask for and why it would be allowed.
// ─────────────────────────────────────────────────────────────────────────────
import "dotenv/config";
import { writeFileSync } from "fs";
import { prisma } from "../src/lib/prisma";
import { runAsPlatform } from "../src/lib/db/context";
import {
  deriveToken,
  hasMemberIdentity,
  interchangeConfigured,
  issueConsent,
  memberIdentity,
  signedPostRaw,
} from "../src/lib/interchange/registry";
import { memberCodeForOrgSlug } from "../src/lib/interchange/members";

const arg = (name: string, fallback = "") => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : fallback;
};
const LIVE = process.argv.includes("--live");
const APPLICATION = arg("application", "00ba2b3a-7dd7-454b-85b3-0a8b23fb50ac");
const REPORT_TYPE = Number(arg("type", "8"));

const ok = (s: string) => `\x1b[32m✓\x1b[0m ${s}`;
const bad = (s: string) => `\x1b[31m✗\x1b[0m ${s}`;

async function main() {
  console.log(`\n\x1b[1mInterchange report — the console button's path\x1b[0m\n`);

  const app = await runAsPlatform(() =>
    prisma.loanApplication.findUnique({
      where: { id: APPLICATION },
      select: {
        id: true, orgId: true, amountRequested: true, status: true,
        borrower: { select: { id: true, firstName: true, otherName: true, nationalId: true, erasedAt: true } },
        org: { select: { slug: true, name: true } },
      },
    }),
  );
  if (!app) throw new Error(`No application ${APPLICATION}`);
  const name = `${app.borrower.firstName ?? ""} ${app.borrower.otherName ?? ""}`.trim();
  console.log(`  application  ${app.id}\n  lender       ${app.org.name} (${app.org.slug})\n  borrower     ${name}\n  exposure     KES ${Number(app.amountRequested).toLocaleString()}`);

  if (app.borrower.erasedAt) throw new Error("That customer was erased.");
  if (!app.borrower.nationalId) throw new Error("No national ID on file.");
  console.log(ok(`national ID on file`));

  // ── Consent, before anything is derived ─────────────────────────────────
  const consentRow = await runAsPlatform(() =>
    prisma.consent.findFirst({
      where: { orgId: app.orgId, borrowerId: app.borrower.id },
      orderBy: { createdAt: "desc" },
      select: { id: true, version: true, grants: true, createdAt: true },
    }),
  );
  const grants = (consentRow?.grants ?? {}) as Record<string, unknown>;
  if (grants.crbCheck !== true) throw new Error("Borrower has not consented to a CRB check.");
  console.log(ok(`consent: crbCheck granted, wording ${consentRow?.version}`));

  const memberCode = memberCodeForOrgSlug(app.org.slug);
  if (!interchangeConfigured() || !memberCode || !hasMemberIdentity(memberCode)) {
    throw new Error("This lender is not wired to the Interchange.");
  }
  console.log(ok(`member identity: ${memberCode}`));

  if (!LIVE) {
    console.log(
      `\n  \x1b[33mDry run.\x1b[0m Would request Interchange report ${REPORT_TYPE} as ${memberCode}.\n` +
        `  Re-run with --live to spend one Metropol pull.\n`,
    );
    return;
  }

  const who = memberIdentity(memberCode);
  const t0 = Date.now();
  const subjectToken = await deriveToken(who, "national_id", app.borrower.nationalId);
  console.log(ok(`tokenised in ${Date.now() - t0}ms — ${subjectToken.slice(0, 12)}…`));

  const consent = await issueConsent({
    subjectToken,
    memberCode,
    capturedVia: "LMS_CONSOLE",
    wordingVersion: consentRow?.version,
    evidence: { surface: "scripts/verify-interchange-report", lmsConsentId: consentRow?.id },
  });
  if (!consent.ok) throw new Error(`Consent refused: ${consent.message}`);
  console.log(ok(`consent_ref ${consent.ref}`));

  const t1 = Date.now();
  const res = await signedPostRaw(who, "/api/v1/report", {
    report_type: REPORT_TYPE,
    identity_number: app.borrower.nationalId,
    consent_ref: consent.ref,
    format: "bundle",
    loan_amount: Math.max(1, Math.round(Number(app.amountRequested))),
    report_reason: 1,
  });
  const ms = Date.now() - t1;

  if (!res.ok) {
    const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    console.log(bad(`HTTP ${res.status} ${String(j.api_code ?? "")} — ${String(j.api_code_description ?? j.message ?? "")}`));
    process.exitCode = 1;
    return;
  }

  const bundle = (await res.json()) as Record<string, unknown> & {
    file?: { accounts?: unknown[]; score?: { value: number | null }; sources?: number[] };
    document?: { content?: string; bytes?: number };
  };

  const accounts = bundle.file?.accounts?.length ?? 0;
  const score = bundle.file?.score?.value ?? null;
  console.log(ok(`report ${REPORT_TYPE} in ${ms}ms · ${accounts} accounts · score ${score ?? "—"} · sources ${(bundle.file?.sources ?? []).join(", ")}`));
  console.log(
    ok(
      `receipt: log entry #${res.headers.get("x-interchange-log-seq")} · ` +
        `${res.headers.get("x-interchange-billed-pulls")} pull(s) billed`,
    ),
  );

  const b64 = bundle.document?.content;
  if (!b64) {
    console.log(bad("no PDF in the bundle"));
    process.exitCode = 1;
    return;
  }
  const pdf = Buffer.from(b64, "base64");
  const out = `C:/GIT/MICRO_EAZY/reports/crb/Interchange-Report${REPORT_TYPE}-${app.borrower.nationalId}-${new Date().toISOString().slice(0, 10)}.pdf`;
  writeFileSync(out, pdf);
  const fonts = [...pdf.toString("latin1").matchAll(/\/BaseFont\s*\/([A-Za-z0-9+#_-]+)/g)].map((m) => m[1].replace(/^[A-Z]{6}\+/, ""));
  const pages = (pdf.toString("latin1").match(/\/Count\s+(\d+)/) ?? [])[1];
  console.log(ok(`PDF ${(pdf.length / 1024).toFixed(0)}KB · ${pages} pages · ${[...new Set(fonts)].join(", ")}`));
  console.log(`\n  written: ${out}\n`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(`\n\x1b[31m${e instanceof Error ? e.message : String(e)}\x1b[0m\n`);
    await prisma.$disconnect();
    process.exit(1);
  });
