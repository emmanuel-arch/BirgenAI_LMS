// ─────────────────────────────────────────────────────────────────────────────
// THE NAME GATE — does the name printed on the card belong to the human the
// government's registry returned for that ID number?
//
// This is the first and cheapest fraud check in the whole pipeline, and it catches
// the most common attack there is: presenting somebody else's ID, or a card whose
// number has been altered. If the document says JOHN OTIENO and IPRS says that
// number belongs to MARY WANJIKU, nothing further needs to happen.
//
// WHY IT IS NOT A STRING COMPARISON.
//
//   OCR is lossy. A worn card photographed under a counter light gives you
//   "EMMANUE1 KIPLET1NG". Failing an honest customer because Vision misread an
//   'I' as a '1' is a bad gate, not a strict one.
//
//   Kenyan names are reordered constantly. The card prints "KIPLETING EMMANUEL
//   KIPROTICH"; the registry returns first_name EMMANUEL, middle KIPROTICH,
//   last KIPLETING. Same person, different order. So the comparison is ORDER-BLIND
//   over tokens.
//
//   People drop a name. The card carries three names, the registry two, or the
//   other way round. A subset is not a mismatch — it is the same person, recorded
//   with more or fewer of their names.
//
// So: tokenise, compare order-blind, allow one OCR slip per long token, and return
// a GRADED verdict rather than a boolean, because the three outcomes want three
// different things to happen:
//
//   "exact"  / "strong"  → proceed
//   "partial"            → a human looks (PENDING_REVIEW). Never an auto-pass.
//   "none"               → refused, and the officer is told exactly what differed.
// ─────────────────────────────────────────────────────────────────────────────

export type NameVerdict = "exact" | "strong" | "partial" | "none";

export type NameMatch = {
  verdict: NameVerdict;
  /** 0..100 — the share of the shorter name's tokens found in the longer. */
  score: number;
  shared: string[];
  /** Tokens on the document that the registry did not know about, and vice versa. */
  onlyOnDocument: string[];
  onlyInRegistry: string[];
  /** One sentence an officer can read out. */
  summary: string;
};

/** Particles and honorifics carry no identifying weight and only add false mismatches. */
const NOISE = new Set(["MR", "MRS", "MS", "DR", "PROF", "BIN", "BINTI", "WA", "OF", "THE"]);

/**
 * The letters OCR most often reports as digits on a printed card.
 *
 * ⚠ A DIGIT INSIDE A WORD IS A SLIP; A WORD OF ONLY DIGITS IS DEBRIS. Getting this
 * backwards is a bug the tests caught: simply DELETING digits turns "KIPLET1NG" into
 * "KIPLET" + "NG" — it shatters the very token it was meant to clean, and an honest
 * customer with a worn ID gets refused for fraud. So a digit sitting among letters is
 * mapped back to the letter it is standing in for, and only a standalone number (a
 * stray serial that wandered into the name field) is thrown away.
 */
const OCR_DIGITS: Record<string, string> = { "0": "O", "1": "I", "5": "S", "8": "B", "2": "Z", "6": "G" };

export function tokenise(name: string): string[] {
  const words = (name ?? "").toUpperCase().split(/\s+/).filter(Boolean);
  const out: string[] = [];

  for (const raw of words) {
    const cleaned = raw.replace(/['\-.,:]/g, "");
    if (!cleaned) continue;
    // A token with no letters at all is not a name — it is a number that wandered in.
    if (!/[A-Z]/.test(cleaned)) continue;

    const repaired = cleaned.replace(/[0-9]/g, (d) => OCR_DIGITS[d] ?? "").replace(/[^A-Z]/g, "");
    if (repaired.length >= 2 && !NOISE.has(repaired)) out.push(repaired);
  }
  return [...new Set(out)];
}

/** Levenshtein, capped — we only ever care whether the distance is 0, 1 or "more". */
function within(a: string, b: string, max: number): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > max) return false;

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(
        prev[j] + 1,
        row[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = row;
    if (Math.min(...row) > max) return false; // no path can recover
  }
  return prev[b.length] <= max;
}

/**
 * One OCR slip is forgiven on a token long enough for the slip to be obvious
 * ("KIPLETING" vs "KIPLET1NG"). Short tokens are compared strictly: at four
 * characters, a one-character tolerance starts matching genuinely different
 * names (OTIENO/OTIENA is fine to forgive; JOHN/JOAN is not).
 */
function tokensAlike(a: string, b: string): boolean {
  if (a === b) return true;
  const len = Math.min(a.length, b.length);
  return len >= 5 && within(a, b, 1);
}

export function matchNames(documentName: string | null | undefined, registryName: string | null | undefined): NameMatch {
  const doc = tokenise(documentName ?? "");
  const reg = tokenise(registryName ?? "");

  if (doc.length === 0 || reg.length === 0) {
    return {
      verdict: "none",
      score: 0,
      shared: [],
      onlyOnDocument: doc,
      onlyInRegistry: reg,
      summary:
        doc.length === 0
          ? "No name could be read from the ID photograph. Retake it — straight on, no glare."
          : "The registry returned no name for that ID number.",
    };
  }

  const shared: string[] = [];
  const unmatchedReg = [...reg];
  const onlyOnDocument: string[] = [];

  for (const d of doc) {
    const i = unmatchedReg.findIndex((r) => tokensAlike(d, r));
    if (i >= 0) { shared.push(unmatchedReg[i]); unmatchedReg.splice(i, 1); }
    else onlyOnDocument.push(d);
  }

  const smaller = Math.min(doc.length, reg.length);
  const score = Math.round((shared.length / smaller) * 100);

  // Every token of the shorter name was found in the longer one. That is the same
  // person, recorded with more or fewer of their names.
  const allOfShorter = shared.length === smaller;

  // ⚠ TWO NAMES, MINIMUM. A card that reads only "KIPLETING" technically contains
  // "all of the shorter name" when matched against a three-name registry record —
  // and letting that through would mean one shared surname opens the gate, which in
  // a country where a surname is shared by a whole region is no check at all. A
  // single token can never be more than a human review.
  let verdict: NameVerdict;
  if (smaller < 2) verdict = shared.length >= 1 ? "partial" : "none";
  else if (allOfShorter && doc.length === reg.length) verdict = "exact";
  else if (allOfShorter) verdict = "strong";
  else if (shared.length >= 2) verdict = "partial";
  else verdict = "none";

  const summary =
    verdict === "exact"
      ? "The name on the ID is the name the national registry holds for that number."
      : verdict === "strong"
        ? `The ID and the registry agree on ${shared.join(" ")} — one carries a name the other does not, which is normal.`
        : verdict === "partial"
          ? `Only part of the name agrees (${shared.join(" ")}). ${onlyOnDocument.length ? `The ID also reads ${onlyOnDocument.join(" ")}. ` : ""}A supervisor should look at this.`
          : `The ID does not belong to this registry record. The card reads ${doc.join(" ")}; the registry holds ${reg.join(" ")} for that number.`;

  return { verdict, score, shared, onlyOnDocument, onlyInRegistry: unmatchedReg, summary };
}

/** May the pipeline advance on this verdict without a human? */
export function nameGatePasses(v: NameVerdict): boolean {
  return v === "exact" || v === "strong";
}

// ─────────────────────────────────────────────────────────────────────────────
// THE BINDING GATE — does the identity the registry confirmed actually belong to
// the borrower we are onboarding?
//
// matchNames() above proves a DOCUMENT is internally honest: the name printed on
// the card is the name the registry holds for the number printed on the card. It
// proves nothing about whether that document is THIS customer's. The hole that
// leaves open: an officer opens Julia's account, presents Emmanuel's genuine ID and
// Emmanuel's genuine face — the card/registry gate passes, the selfie matches
// Emmanuel's portrait at 100%, and a fraudulent "Julia is verified" is written.
//
// So bind the confirmed identity to the borrower on record:
//   • If the record already carries a national ID, the card MUST present the SAME
//     number — a different number is a different person, full stop (the strongest,
//     most objective bind).
//   • Otherwise (thin onboarding, no ID on file) bind by name: the registry's name
//     must be the name on the record.
//   • A brand-new anonymous row with neither a name nor an ID has nothing to
//     contradict — the card/registry gate is all there is, and it stands.
// ─────────────────────────────────────────────────────────────────────────────
export type BindReason = "id-mismatch" | "name-mismatch" | null;

export type BindDecision = {
  passed: boolean;
  /** true = same national ID; false = different; null = no ID on file to compare. */
  idBinds: boolean | null;
  nameVerdict: NameVerdict;
  reason: BindReason;
};

export function identityBinding(args: {
  borrowerName: string;
  /** The national ID already on the customer's record (may be empty). */
  borrowerNationalId: string;
  /** The national ID we ACTED ON — the number read off the card, else the typed one. */
  cardNationalId: string;
  /** The authoritative name the registry returned for that number. */
  registryName: string | null;
}): BindDecision {
  const borrowerId = (args.borrowerNationalId || "").replace(/\D/g, "");
  const cardId = (args.cardNationalId || "").replace(/\D/g, "");
  const idBinds = borrowerId.length > 0 && cardId.length > 0 ? borrowerId === cardId : null;
  const nameVerdict = matchNames(args.borrowerName, args.registryName).verdict;

  if (idBinds === false) return { passed: false, idBinds, nameVerdict, reason: "id-mismatch" };
  if (idBinds === true) return { passed: true, idBinds, nameVerdict, reason: null };
  if (!args.borrowerName.trim()) return { passed: true, idBinds, nameVerdict, reason: null };
  const passed = nameGatePasses(nameVerdict);
  return { passed, idBinds, nameVerdict, reason: passed ? null : "name-mismatch" };
}
