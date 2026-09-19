// ─────────────────────────────────────────────────────────────────────────────
// THE RISK STAGE'S "REQUEST CRB REPORT" BUTTON, FROM A TERMINAL.
//
//   npx tsx scripts/interchange-report.ts --phone 254758517032            # dry
//   npx tsx scripts/interchange-report.ts --phone 254758517032 --send     # pulls
//   npx tsx scripts/interchange-report.ts --phone … --send --registry https://…
//
// It runs the SAME four steps as POST /api/console/interchange/report, in the
// same order, through the same library:
//
//   1. the lawful basis   — the borrower's own crbCheck consent, from the LMS
//   2. the blinding       — national ID → subject_token through the OPRF, so
//                           the Registry never learns the number
//   3. the network consent— registered against that token, quoted on the pull
//   4. the pull           — Metropol report 8 as a BUNDLE: the structured file
//                           and the rendered PDF, from one billed request
//
// ── WHY IT EXISTS SEPARATELY FROM THE BUTTON ─────────────────────────────────
// The button can only be pressed from inside a signed-in console on a deployment
// that is already wired to the network, which makes it useless for answering the
// question that actually blocks a demo: IS this deployment wired, and are these
// member keys the ones the Registry knows? `--registry` points the same call at
// any registry, so a laptop can prove the production path before anybody stands
// up in front of Micromart's board.
//
// ── IT SPENDS MONEY, SO IT ASKS FIRST ────────────────────────────────────────
// A report is billed per pull. `--send` is required; without it this prints the
// borrower, the consent and the exact request, and stops. The PDF lands in
// reports/crb/, which is gitignored — a real bureau file on a real person is not
// a repository artefact.
// ─────────────────────────────────────────────────────────────────────────────
import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { prisma } from "../src/lib/prisma";
import { runAsPlatform } from "../src/lib/db/context";
import { memberCodeForOrgSlug } from "../src/lib/interchange/members";
import {
  deriveToken,
  hasMemberIdentity,
  interchangeConfigured,
  issueConsent,
  memberIdentity,
  registryUrl,
  signedPostRaw,
} from "../src/lib/interchange/registry";

const SEND = process.argv.includes("--send");
const arg = (n: string, d?: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : d;
};

const ok = (s: string) => `\x1b[32m${s}\x1b[0m`;
const bad = (s: string) => `\x1b[31m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;

async function main() {
  // `--registry` overrides INTERCHANGE_URL for this process only. Set BEFORE any
  // call, because registryUrl() reads the variable each time.
  const override = arg("registry");
  if (override) process.env.INTERCHANGE_URL = override;

  const slug = arg("org", "micromart")!;
  const phone = (arg("phone") ?? "").replace(/\D/g, "");
  const reportType = Number(arg("report", "8"));
  const loanAmount = Number(arg("amount", "10900"));

  console.log(`\n\x1b[1mInterchange report ${reportType}\x1b[0m — ${SEND ? "\x1b[33mLIVE, BILLED\x1b[0m" : dim("dry run")}\n`);

  // ── Is this deployment on the network at all? ────────────────────────────
  // The same three conditions the console checks, reported one at a time —
  // because "this lender is not connected to the Interchange yet" is true for
  // three different reasons and an operator cannot act on the merged answer.
  const memberCode = memberCodeForOrgSlug(slug);
  const configured = interchangeConfigured();
  console.log(`  registry url   ${configured ? ok(registryUrl()) : bad("INTERCHANGE_URL / INTERCHANGE_NODE_KEYS not set")}`);
  console.log(`  member code    ${memberCode ? ok(memberCode) : bad(`no member code maps to org "${slug}"`)}`);
  const signable = !!memberCode && configured && hasMemberIdentity(memberCode);
  console.log(`  node key       ${signable ? ok("present — this process can sign as that member") : bad("missing: this deployment cannot sign as that member")}`);
  if (!signable) {
    console.log(bad("\n  Not connected. The console's Request CRB report button answers NOT_A_MEMBER for exactly this reason.\n"));
    process.exit(1);
  }

  await runAsPlatform(async () => {
    const org = await prisma.org.findFirst({ where: { slug }, select: { id: true, name: true } });
    if (!org) throw new Error(`No org with slug "${slug}".`);

    const borrower = await prisma.borrower.findFirst({
      where: { orgId: org.id, ...(phone ? { phone } : {}), nationalId: { not: null } },
      select: { id: true, firstName: true, otherName: true, nationalId: true, phone: true, erasedAt: true },
    });
    if (!borrower) throw new Error(phone ? `No borrower on ${org.name} with phone ${phone} and a national ID.` : "No borrower with a national ID.");
    if (borrower.erasedAt) throw new Error("That customer was erased. Nothing may be pulled about them.");

    const consentRow = await prisma.consent.findFirst({
      where: { orgId: org.id, borrowerId: borrower.id },
      orderBy: { createdAt: "desc" },
      select: { id: true, version: true, grants: true, createdAt: true },
    });
    const grants = (consentRow?.grants ?? {}) as Record<string, unknown>;

    console.log(`\n  borrower       ${borrower.firstName} ${borrower.otherName ?? ""} · ${borrower.phone ?? "no phone"}`);
    console.log(`  national id    ${borrower.nationalId}`);
    console.log(
      `  crb consent    ${grants.crbCheck === true ? ok(`given ${consentRow?.createdAt.toISOString().slice(0, 10)} (v${consentRow?.version})`) : bad("NOT GIVEN — the pull is refused, and correctly")}`,
    );
    if (grants.crbCheck !== true) process.exit(1);

    if (!SEND) {
      console.log(dim(`\n  Dry run. Re-run with --send to spend one billed pull.\n`));
      return;
    }

    const who = memberIdentity(memberCode!);
    const started = Date.now();

    // The identity boundary. Blinded here, evaluated as a random point by the
    // Registry, unblinded here — the Registry cannot learn the ID number.
    const subjectToken = await deriveToken(who, "national_id", borrower.nationalId!);
    console.log(`\n  subject token  ${subjectToken.slice(0, 16)}… ${dim("(the Registry never sees the ID)")}`);

    const consent = await issueConsent(who, {
      subjectToken,
      capturedVia: "LMS_CONSOLE",
      wordingVersion: consentRow?.version,
      evidence: {
        surface: "scripts/interchange-report",
        lmsConsentId: consentRow?.id,
        lmsConsentVersion: consentRow?.version,
        capturedAt: consentRow?.createdAt.toISOString(),
        presentedAt: new Date().toISOString(),
      },
    });
    if (!consent.ok) {
      console.log(bad(`  consent        refused (${consent.status}) — ${consent.message}\n`));
      process.exit(1);
    }
    console.log(`  consent ref    ${ok(consent.ref)}`);

    const res = await signedPostRaw(who, "/api/v1/report", {
      report_type: reportType,
      identity_number: borrower.nationalId,
      consent_ref: consent.ref,
      // "bundle" = the structured file AND the rendered document from ONE billed
      // pull. Asking for them separately is billed twice for the same bytes.
      format: "bundle",
      loan_amount: Math.max(1, Math.round(loanAmount)),
      report_reason: 1,
    });

    const seq = res.headers.get("x-interchange-log-seq");
    const billed = res.headers.get("x-interchange-billed-pulls");
    const ms = Date.now() - started;

    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      console.log(bad(`\n  REFUSED (${res.status})  ${j.api_code_description ?? j.message ?? "no reason given"}`));
      console.log(dim(`  ${JSON.stringify(j).slice(0, 400)}\n`));
      process.exit(1);
    }

    const bundle = (await res.json()) as { document?: { content?: string }; file?: unknown; source?: unknown };
    console.log(`\n  ${ok("ANSWERED")}  ${ms}ms · ${billed ?? "?"} pull(s) billed · log entry #${seq ?? "?"}`);

    const base64 = bundle.document?.content;
    if (!base64) {
      console.log(bad("  The Interchange answered, but with no rendered document — a PDF cannot be shown.\n"));
      process.exit(1);
    }

    const dir = join(process.cwd(), "reports", "crb");
    mkdirSync(dir, { recursive: true });
    const name = `interchange-report-${reportType}-${borrower.nationalId}-${new Date().toISOString().slice(0, 10)}.pdf`;
    const out = join(dir, name);
    const bytes = Buffer.from(base64, "base64");
    writeFileSync(out, bytes);

    console.log(`  document       ${ok(`${Math.round(bytes.length / 1024)} KB`)} → reports/crb/${name}`);
    console.log(`  structured     ${bundle.file ? ok("present — this is what satisfies a crbRequired stage") : bad("absent")}`);
    console.log(dim(`\n  The console's button returns these same bytes to the browser.\n`));
  });
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("\n" + bad(e instanceof Error ? e.message : String(e)) + "\n");
    process.exit(1);
  });
