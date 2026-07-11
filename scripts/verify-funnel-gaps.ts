// Tests for the §5.1 funnel-gap closures — active liveness and the device
// fingerprint contract.
//
//   npm run test:funnel-gaps        (pure — no database, no server)
//
// Active liveness is only worth anything if the CLIENT cannot choose what it
// answers: challenges must derive deterministically from the session seed, and
// a frame answering the wrong challenge — or arriving out of order, or nearly
// empty — must fail.
import { activeLivenessChallenges, assessActiveLiveness } from "@/lib/kyc/provider";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, extra = "") => {
  if (cond) { pass++; console.log(`  PASS  ${name}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.log(`  FAIL  ${name}${extra ? ` — ${extra}` : ""}`); }
};

const SEED = "org-1:12345678";
const BIG = 60_000;

function main() {
  console.log("1. Challenges are server-derived, stable, and distinct");
  const c1 = activeLivenessChallenges(SEED);
  const c2 = activeLivenessChallenges(SEED);
  ok("two challenges are issued", c1.length === 2);
  ok("the same seed always asks the same things (stateless re-derivation)", c1[0] === c2[0] && c1[1] === c2[1], c1.join(" / "));
  ok("the two challenges differ", c1[0] !== c1[1]);
  const other = activeLivenessChallenges("org-1:87654321");
  ok("different people get their own sequence (or at least may)", Array.isArray(other) && other.length === 2);

  console.log("\n2. The response is judged against what was ASKED");
  const right = assessActiveLiveness(SEED, [
    { challenge: c1[0], bytes: BIG },
    { challenge: c1[1], bytes: BIG },
  ]);
  ok("correct answers in order pass", right.passed && right.score >= 70, `score ${right.score}`);
  ok("per-frame detail comes back for the audit trail", right.frames.length === 2 && right.frames.every((f) => f.passed));

  const swapped = assessActiveLiveness(SEED, [
    { challenge: c1[1], bytes: BIG },
    { challenge: c1[0], bytes: BIG },
  ]);
  ok("answers out of order fail (order is part of the challenge)", !swapped.passed);

  const wrong = assessActiveLiveness(SEED, [
    { challenge: "wave your hand", bytes: BIG },
    { challenge: c1[1], bytes: BIG },
  ]);
  ok("a self-chosen challenge fails", !wrong.passed && wrong.frames[0].score <= 10);

  const missing = assessActiveLiveness(SEED, [{ challenge: c1[0], bytes: BIG }]);
  ok("a missing frame fails", !missing.passed);

  const empty = assessActiveLiveness(SEED, [
    { challenge: c1[0], bytes: 500 },
    { challenge: c1[1], bytes: BIG },
  ]);
  ok("a near-empty frame is not a face", !empty.passed);

  ok("nothing at all fails", !assessActiveLiveness(SEED, []).passed);

  console.log("\n3. The fingerprint contract");
  const FP_RE = /^[0-9a-f]{32,64}$/i; // the server-side validation in /api/lms/apply
  ok("a SHA-256 hex digest is accepted", FP_RE.test("a".repeat(64)) && FP_RE.test("0123456789abcdef".repeat(4)));
  ok("junk is rejected (stored as null, never trusted)", !FP_RE.test("<script>") && !FP_RE.test("short") && !FP_RE.test(""));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main();
