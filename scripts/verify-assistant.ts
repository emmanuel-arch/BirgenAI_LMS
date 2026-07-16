// Riri Assistant — driven end to end against the real Techcrast book.
//
//   npm run test:assistant
//
// Half of this is pure (the persona/role rules, which must hold with no key at all).
// The other half is a LIVE Gemini call against a REAL borrower, because the only way to
// know whether an assistant is any good is to read what she actually says.
import "dotenv/config";
import { readFileSync } from "node:fs";
import { platformPrisma } from "../prisma/seed-client";
import { enterPlatform } from "../src/lib/db/context";
import { roleFromTitle, ririSystemPrompt, ririGreeting } from "../src/lib/riri/persona";
import { isLlmConfigured } from "../src/lib/riri/gemini";
import { askAssistant } from "../src/lib/riri/assistant";
import type { RiriHost, RiriMemoryNote } from "../src/lib/riri/host";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
};

async function main() {
  console.log("\nRiri Assistant\n");

  console.log("she reads a lender's own role titles, not a fixed list");
  ok("Relationship Officer → officer", roleFromTitle("Relationship Officer") === "officer");
  ok("Team Leader → manager", roleFromTitle("Team Leader") === "manager");
  ok("Regional Manager → manager", roleFromTitle("Regional Manager") === "manager");
  ok("Finance Officer → manager (they finalize)", roleFromTitle("Finance Officer") === "manager");
  ok("Debt Recovery Agent → collections", roleFromTitle("Debt Recovery Agent") === "collections");
  ok("System Admin → admin", roleFromTitle("System Admin") === "admin");
  ok("an unrecognised title makes her a colleague, not the wrong specialist",
    roleFromTitle("Driver") === "staff");
  ok("no title at all is still safe", roleFromTitle(null) === "staff");
  ok("Platform Admin → admin", roleFromTitle("Platform Admin") === "admin");

  console.log("\nthe system prompt carries the person and the discipline");
  const sys = ririSystemPrompt({ lenderName: "Techcrast Software Solutions", actorName: "Faith Wanjiru", roleTitle: "Relationship Officer", branch: "Nairobi CBD" });
  ok("she knows where she works", sys.includes("Techcrast Software Solutions"));
  ok("she knows who she is talking to", sys.includes("Faith Wanjiru"));
  ok("she knows their branch", sys.includes("Nairobi CBD"));
  ok("she is briefed on THEIR job", sys.includes("PRODUCTION and COLLECTION"));
  ok("she is Kenyan, from Westlands", sys.includes("Westlands"));
  ok("she matches Sheng", sys.includes("Sheng"));
  ok("★ money is exact — the rule that keeps her safe", sys.includes("MONEY IS EXACT"));
  ok("★ she may not invent a balance", /never invent a customer, a loan, a balance/i.test(sys));
  ok("★ she advises, she never presses the button", /never approve, decline, disburse/i.test(sys));
  ok("a manager gets a manager's brief, not an officer's",
    ririSystemPrompt({ lenderName: "X", actorName: "A", roleTitle: "Regional Manager", branch: null }).includes("MANAGEMENT"));

  console.log("\nthe greeting is free — no model, no token");
  ok("she uses their first name", ririGreeting("Faith Wanjiru", "Relationship Officer").includes("Faith"));
  ok("and asks an officer an officer's question", ririGreeting("Faith", "Relationship Officer").includes("lending"));
  ok("and a collections agent theirs", ririGreeting("Ann", "Debt Recovery").toLowerCase().includes("dodging"));

  console.log("\nthe assistant core does not import a database");
  // The seam that makes Riri sellable into ServiceSuite: if assistant.ts ever reaches
  // for Prisma, "add Riri to your system" quietly becomes "migrate your book to ours".
  const core = readFileSync("src/lib/riri/assistant.ts", "utf8");
  ok("★ assistant.ts imports no prisma", !/from "@\/lib\/prisma"|from "@prisma/.test(core));
  ok("★ it talks to the host interface only", core.includes('from "./host"'));

  // ── The live half ──────────────────────────────────────────────────────────
  if (!isLlmConfigured()) {
    console.log("\n(no RIRI_LLM_KEY — skipping the live drive)");
    console.log(`\n${pass} passed, ${fail} failed\n`);
    process.exit(fail === 0 ? 0 : 1);
  }

  // ── Logged in as a REAL Techcrast officer, against their REAL book ─────────
  //
  // Not a fixture. This is the actual staff row an officer signs in as, resolved the
  // same way the API route resolves it, so what Riri is told here is exactly what she
  // is told in the console.
  const p = platformPrisma();
  enterPlatform();
  const org = await p.org.findUnique({ where: { slug: "techcrast" }, select: { id: true, name: true } });
  if (!org) throw new Error("no techcrast org");

  const officer = await p.staffUser.findFirst({
    where: { orgId: org.id, role: { title: { contains: "Officer" } } },
    select: { id: true, firstName: true, otherName: true, role: { select: { title: true } } },
    orderBy: { createdAt: "asc" },
  });
  if (!officer) throw new Error("no loan officer on Techcrast to test as");
  const officerName = [officer.firstName, officer.otherName].filter(Boolean).join(" ");

  // Their own customer — the book Riri must be scoped to.
  const borrower = await p.borrower.findFirst({
    where: { orgId: org.id, erasedAt: null, createdById: officer.id },
    select: { id: true, firstName: true, otherName: true },
  }) ?? await p.borrower.findFirst({
    where: { orgId: org.id, erasedAt: null },
    select: { id: true, firstName: true, otherName: true },
  });
  if (!borrower) throw new Error("no borrower to test with");

  const { borrowerContext, bookContext } = await import("../src/lib/riri/context");
  const { lmsHost } = await import("../src/lib/riri/providers/lms");

  console.log(`\nlive drive — logged in as ${officerName} (${officer.role?.title}) at ${org.name}`);
  const facts = await borrowerContext(org.id, borrower.id);
  console.log(`  customer on screen: ${facts?.label}`);
  for (const l of facts?.lines ?? []) console.log(`    · ${l}`);
  console.log("  their book:");
  for (const l of await bookContext(org.id, officer.id, "own")) console.log(`    · ${l}`);

  // The REAL host, exactly as the route builds it — only `recall`/`remember` are
  // wrapped, so the test reads a seeded memory and does not write rows into the
  // founder's live book.
  const real = lmsHost({
    orgId: org.id, lenderName: org.name, staffId: officer.id,
    rights: new Set(["borrowers.view", "loans.view"]),
  });
  const remembered: RiriMemoryNote[] = [];
  const host: RiriHost = {
    ...real,
    async recall() {
      return [{
        kind: "recommendation" as const,
        body: `Told ${officer.firstName} to chase the three WATCH-band loans in Nairobi CBD before month-end.`,
        createdAt: new Date(Date.now() - 7 * 86_400_000),
      }];
    },
    async remember(_who, note) { remembered.push({ ...note, createdAt: new Date() }); },
  };

  const actor = await real.actor();
  ok("★ she is told who is actually logged in", actor.name === officerName, `got ${actor.name}`);
  ok("★ she is told their real role", (actor.roleTitle ?? "").includes("Officer"), `got ${actor.roleTitle}`);
  ok("★ she knows they are the lender's staff, not us", actor.isPlatformAdmin !== true);
  // Scoped to the officer: either their book, or an honest "you have none yet" — never
  // the lender's aggregate, which would answer a question they did not ask.
  const officerBook = (await real.book(actor)).join(" ");
  ok("★ an officer's book is scoped to THEM, not the lender's",
    /Their book|no customers on their book/.test(officerBook), officerBook.slice(0, 80));

  console.log("\n  Q: Niaje Riri, naeza mpa top-up?");
  const r1 = await askAssistant(host, "Niaje Riri, naeza mpa top-up?", { subject: { kind: "borrower", id: borrower.id } });
  console.log(`  A: ${r1.answer.replace(/\n/g, "\n     ")}`);
  ok("she answers live", r1.mode === "live");
  ok("she knows which customer she is looking at", r1.subjectId === borrower.id);
  ok("she replies in the language she was asked in (Sheng/Swahili)",
    /\b(niaje|poa|sawa|ako|hiyo|yake|bado|kwa|ni|na|wetu|tu)\b/i.test(r1.answer));
  ok("★ she calls the real officer by their real name",
    new RegExp(officer.firstName, "i").test(r1.answer));

  console.log("\n  Q: how is my book doing?");
  const rb = await askAssistant(host, "How is my book doing? Who should I chase first?", { subject: null });
  console.log(`  A: ${rb.answer.replace(/\n/g, "\n     ")}`);
  ok("★ she answers about THEIR book, live", rb.mode === "live" && rb.answer.length > 20);

  console.log("\n  Q: what did you tell me last week?");
  const r2 = await askAssistant(host, "What did you tell me last week?", { subject: null });
  console.log(`  A: ${r2.answer.replace(/\n/g, "\n     ")}`);
  ok("★ she remembers her own recommendation", /watch|cbd|month-end|three|3/i.test(r2.answer));

  console.log("\n  Q: (a customer she was never given) what is Njoroge's balance?");
  const r3 = await askAssistant(host, "What is Njoroge's balance?", { subject: null });
  console.log(`  A: ${r3.answer.replace(/\n/g, "\n     ")}`);
  ok("★ she does not invent a customer she was never given",
    /(open|which|don't|do not|can't|cannot|need|not sure|sina|siwezi|nifungulie|page)/i.test(r3.answer));

  // ── And now as the PLATFORM ADMIN, acting as this lender ──────────────────
  //
  // The founder signs in as `platform:<adminId>` (api/platform/impersonate) — an id that
  // is deliberately NOT a StaffUser row. Riri has to recognise that or she addresses the
  // person who built her as an anonymous "colleague", and her memory write throws.
  const admin = await p.platformAdmin.findUnique({
    where: { email: "kipletinge123@gmail.com" },
    select: { id: true, name: true, status: true },
  });
  if (!admin) throw new Error("platform admin kipletinge123@gmail.com not found");

  console.log(`\nlive drive — logged in as PLATFORM ADMIN ${admin.name} (${admin.status}), acting as ${org.name}`);
  const adminActorId = `platform:${admin.id}`;

  const adminHostReal = lmsHost({
    orgId: org.id, lenderName: org.name, staffId: adminActorId,
    rights: new Set(["borrowers.view", "loans.view"]),
    session: { name: admin.name, role: "Platform Admin" },
  });
  const adminActor = await adminHostReal.actor();
  ok("★ she knows the platform admin by name, not as 'a colleague'", adminActor.name === admin.name, `got ${adminActor.name}`);
  ok("★ she knows they are BirgenAI, not the lender's staff", adminActor.isPlatformAdmin === true);
  ok("★ a platform admin sees the LENDER's whole book, not a personal one",
    (await adminHostReal.book(adminActor)).join(" ").includes("This lender's book"));

  const adminMemories: RiriMemoryNote[] = [];
  const adminHost: RiriHost = {
    ...adminHostReal,
    async recall() { return []; },
    async remember(_who, note) { adminMemories.push({ ...note, createdAt: new Date() }); },
  };

  console.log("\n  Q: How is this lender's book looking? Be straight with me.");
  const ra = await askAssistant(adminHost, "How is this lender's book looking? Be straight with me.", { subject: null });
  console.log(`  A: ${ra.answer.replace(/\n/g, "\n     ")}`);
  ok("★ she answers the platform admin live", ra.mode === "live");
  ok("★ she calls the founder by name", new RegExp(admin.name.split(" ")[0], "i").test(ra.answer));

  // The bug this whole branch exists to prevent: RiriMemory.staffId used to FK
  // StaffUser, so remembering a platform admin threw — silently, forever.
  console.log("\n  (memory write for a platform-admin actor)");
  await adminHostReal.remember(adminActorId, { kind: "pattern", body: "Platform admin reviewed Techcrast's book." }, 1);
  const wrote = await p.ririMemory.findFirst({ where: { orgId: org.id, staffId: adminActorId }, select: { id: true, body: true } });
  ok("★ a platform admin CAN be remembered (staffId is not an FK to StaffUser)", !!wrote);
  if (wrote) await p.ririMemory.delete({ where: { id: wrote.id } });

  await p.$disconnect();
  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
