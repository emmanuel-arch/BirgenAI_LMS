// Tests for the IDENTITY ENGINE — the KYC rebuild (Vision + IPRS + Rekognition).
//
//   npm run test:identity      (pure — no database, no app server, no vendor calls)
//
// Smile ID is gone. Three vendors now do three jobs, and the one that carries the
// fraud weight is the NAME GATE: the name printed on the card must be the name the
// national registry holds for that ID number. Everything below is a way that gate
// could quietly stop working — which would not look like a bug, it would look like
// a lender onboarding people with other people's IDs.
//
//   THE GATE MUST BLOCK A BORROWED ID. Different human, same card → "none".
//   THE GATE MUST NOT PUNISH OCR. A worn card read as KIPLET1NG is the same person.
//   THE GATE MUST NOT PUNISH NAME ORDER. Kenyan IDs and IPRS disagree on order
//     constantly, and a subset (two names on the card, three in the registry) is
//     the same human, not a mismatch.
//   BUT IT MUST NOT BE SO FORGIVING IT PASSES ANYONE. JOHN and JOAN are one edit
//     apart and are two different people; a one-character tolerance on short tokens
//     would wave both through.
//   THE PARSER MUST TELL A SERIAL FROM AN ID NUMBER. They sit next to each other on
//     a Kenyan card and OCR interleaves them; picking the wrong one means looking up
//     the wrong human in the government's registry.
import "dotenv/config";
import { matchNames, nameGatePasses, tokenise, identityBinding } from "@/lib/kyc/namematch";
import { parseKenyanIdText } from "@/lib/kyc/vision";
import { kycCapabilities } from "@/lib/kyc/provider";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, extra = "") => {
  if (cond) { pass++; console.log(`  PASS  ${name}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.log(`  FAIL  ${name}${extra ? ` — ${extra}` : ""}`); }
};
const section = (s: string) => console.log(`\n${s}`);

// The real OCR text Vision returned for a real Kenyan ID (note the order: Vision put
// ID NUMBER *last*, after REPUBLIC OF KENYA, and SERIAL NUMBER first).
const REAL_ID_TEXT = `JAMHURI YA KENYA
SERIAL NUMBER: 248211026
FULL NAMES
EMMANUEL KIPLETING
DATE OF BIRTH
05.05.2002
SEX
MALE
DISTRICT OF BIRTH
KESSES
PLACE OF ISSUE
KESSES
DATE OF ISSUE
28.09.2020
HOLDER'S SIGN.
REPUBLIC OF KENYA
ID NUMBER: 39362808`;

async function main() {
  // ── The parser ─────────────────────────────────────────────────────────────
  section("Reading a Kenyan ID (against the text Vision really returned)");

  const ocr = parseKenyanIdText(REAL_ID_TEXT);
  ok("the name is read", ocr?.fullName === "Emmanuel Kipleting", ocr?.fullName ?? "");
  ok("★ the ID NUMBER is read, not the serial", ocr?.idNumber === "39362808", ocr?.idNumber ?? "");
  ok("★ the SERIAL is kept separate (they sit side by side and OCR interleaves them)",
    ocr?.serial === "248211026", ocr?.serial ?? "");
  ok("the date of birth is normalised to ISO", ocr?.dob === "2002-05-05", ocr?.dob ?? "");
  ok("confidence reflects completeness, not certainty", (ocr?.confidence ?? 0) >= 90);

  ok("an unreadable card is a miss, not an invention", parseKenyanIdText("~~~~ ????") === null);

  // ── The gate ───────────────────────────────────────────────────────────────
  section("The name gate: does the card belong to the registry record?");

  const exact = matchNames("Emmanuel Kipleting", "EMMANUEL KIPLETING");
  ok("the same name passes exactly", exact.verdict === "exact" && exact.score === 100);
  ok("…and the gate opens", nameGatePasses(exact.verdict));

  // Order-blind: the card prints surname first, IPRS returns first/middle/last.
  const reordered = matchNames("KIPLETING EMMANUEL KIPROTICH", "EMMANUEL KIPROTICH KIPLETING");
  ok("★ name ORDER does not matter (the card and the registry disagree constantly)",
    reordered.verdict === "exact", reordered.verdict);

  // A subset: the card carries two names, the registry three.
  const subset = matchNames("EMMANUEL KIPLETING", "EMMANUEL KIPROTICH KIPLETING");
  ok("★ a SUBSET is the same human, not a mismatch", subset.verdict === "strong", subset.verdict);
  ok("…and the gate opens for it", nameGatePasses(subset.verdict));

  // OCR damage on a long token.
  const worn = matchNames("EMMANUE1 KIPLET1NG", "EMMANUEL KIPLETING");
  ok("★ one OCR slip per long token is forgiven (a worn card is not a fraud)",
    nameGatePasses(worn.verdict), `${worn.verdict} ${worn.score}%`);

  // ── The gate must still be a gate ──────────────────────────────────────────
  section("…but it is still a gate");

  const stolen = matchNames("MARY WANJIKU NJERI", "EMMANUEL KIPROTICH KIPLETING");
  ok("★★ A BORROWED ID IS REFUSED", stolen.verdict === "none" && !nameGatePasses(stolen.verdict));
  ok("…and the officer is told exactly what differed", stolen.summary.includes("MARY") && stolen.summary.includes("EMMANUEL"));

  const halfShared = matchNames("EMMANUEL OTIENO OCHIENG", "EMMANUEL OTIENO KIPLETING");
  ok("a partial overlap is a HUMAN REVIEW, never an auto-pass",
    halfShared.verdict === "partial" && !nameGatePasses(halfShared.verdict), halfShared.verdict);

  const johnJoan = matchNames("JOHN OTIENO", "JOAN OTIENO");
  ok("★ JOHN is not JOAN — short tokens are compared strictly",
    johnJoan.verdict !== "exact" && johnJoan.verdict !== "strong", `${johnJoan.verdict} ${johnJoan.score}%`);

  const oneName = matchNames("KIPLETING", "EMMANUEL KIPROTICH KIPLETING");
  ok("a single shared surname is NOT enough on its own", !nameGatePasses(oneName.verdict), oneName.verdict);

  const noName = matchNames(null, "EMMANUEL KIPLETING");
  ok("an unreadable card is refused with an instruction, not an accusation",
    noName.verdict === "none" && noName.summary.includes("Retake"));

  const noRecord = matchNames("EMMANUEL KIPLETING", null);
  ok("a registry with no record is refused", noRecord.verdict === "none");

  // ── The binding gate: the confirmed identity must be THIS customer ──────────
  section("The binding gate — a card+face that are internally honest but belong to someone else");

  // THE EXACT FRAUD THE FOUNDER FOUND: open Julia's account (ID 10340714), present
  // Emmanuel's genuine ID (39362808) and Emmanuel's genuine face. The card/registry
  // name-gate passes (Emmanuel = Emmanuel), the selfie matches at 100% — every
  // internal check is green. The bind is the only thing that catches it.
  const julia = identityBinding({
    borrowerName: "JULIA CHEBET SIMATEI", borrowerNationalId: "10340714",
    cardNationalId: "39362808", registryName: "EMMANUEL KIPLETING",
  });
  ok("★★ you CANNOT verify Julia's account with Emmanuel's ID (different national ID)",
    !julia.passed && julia.reason === "id-mismatch");

  // The honest counter case: Julia's own card on Julia's account.
  const honest = identityBinding({
    borrowerName: "JULIA CHEBET SIMATEI", borrowerNationalId: "10340714",
    cardNationalId: "10340714", registryName: "JULIA CHEBET SIMATEI",
  });
  ok("Julia's own ID on Julia's account binds", honest.passed && honest.idBinds === true);

  // A worn card that OCR misread the number of, but the RIGHT person — the ID still
  // binds because the record's number and the card's number agree once cleaned.
  const sameNumber = identityBinding({
    borrowerName: "EMMANUEL KIPLETING", borrowerNationalId: "39362808",
    cardNationalId: "39362808", registryName: "SOMEONE ELSE ENTIRELY",
  });
  ok("the same national ID is conclusive even if the name reads oddly", sameNumber.passed && sameNumber.idBinds === true);

  // Thin onboarding: no ID on the record yet. Bind by name instead.
  const thinMatch = identityBinding({
    borrowerName: "EMMANUEL KIPLETING", borrowerNationalId: "",
    cardNationalId: "39362808", registryName: "EMMANUEL KIPROTICH KIPLETING",
  });
  ok("with no ID on file, a matching registry name binds", thinMatch.passed && thinMatch.idBinds === null);

  const thinFraud = identityBinding({
    borrowerName: "JULIA CHEBET SIMATEI", borrowerNationalId: "",
    cardNationalId: "39362808", registryName: "EMMANUEL KIPLETING",
  });
  ok("★ with no ID on file, a DIFFERENT registry name is refused", !thinFraud.passed && thinFraud.reason === "name-mismatch");

  // A brand-new anonymous row (portal, pre-borrower) has nothing to contradict.
  const anon = identityBinding({
    borrowerName: "", borrowerNationalId: "", cardNationalId: "39362808", registryName: "EMMANUEL KIPLETING",
  });
  ok("a nameless, ID-less anonymous row lets the card/registry gate stand", anon.passed);

  // ── Tokenising ─────────────────────────────────────────────────────────────
  section("Tokenising");

  ok("honorifics and particles carry no weight", !tokenise("MR EMMANUEL KIPLETING").includes("MR"));
  ok("digits are OCR debris in a name field, and are dropped",
    tokenise("EMMANUEL 12345 KIPLETING").join(" ") === "EMMANUEL KIPLETING");
  ok("hyphens and apostrophes do not split a name", tokenise("O'BRIEN SMITH-JONES").length === 2);

  // ── Capabilities ───────────────────────────────────────────────────────────
  section("The pipeline says what is actually connected, leg by leg");

  const caps = await kycCapabilities("org-x");
  ok("three legs are reported independently",
    ["live", "simulation"].includes(caps.ocr) &&
    ["live", "simulation"].includes(caps.registry) &&
    ["live", "simulation"].includes(caps.face),
    `ocr=${caps.ocr} registry=${caps.registry} face=${caps.face}`);

  const demo = await kycCapabilities("org-x", { forceSimulation: true });
  ok("★ a DEMO org is forced to simulation on every leg (a demo click must not be billed)",
    demo.ocr === "simulation" && demo.registry === "simulation" && demo.face === "simulation");

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
