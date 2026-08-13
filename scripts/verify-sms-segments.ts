// Prove the SMS segment arithmetic, and prove every shipped template fits one.
//
//   npx tsx scripts/verify-sms-segments.ts
//
// WHY THIS IS A SCRIPT AND NOT A COMMENT. The naive `Math.ceil(len / 160)` is
// wrong in three ways (see lib/sms/segments.ts), and each way costs real money at
// this scale: a template that quietly needs two segments is billed twice to every
// recipient, on every send, forever. Micromart's Fintech book alone is 17,017
// borrowers on a five-touch repayment ladder.
//
// The second half is the part that will actually catch a regression: it costs
// every built-in template at its WORST CASE — placeholders expanded to their
// longest realistic value — and fails if any of them needs a second segment. Edit
// a template carelessly and this goes red before a lender is billed for it.
import { smsCost, smsCostLabel, templateWorstCase } from "../src/lib/sms/segments";
import { defaultSmsTemplates } from "../src/lib/sms/send";

let failures = 0;
const ok = (m: string) => console.log(`  + ${m}`);
const bad = (m: string) => { failures++; console.log(`  ! ${m}`); };

function eq(label: string, got: unknown, want: unknown) {
  const same = JSON.stringify(got) === JSON.stringify(want);
  if (same) ok(`${label} → ${JSON.stringify(got)}`);
  else bad(`${label} → got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`);
}

const APOSTROPHE = String.fromCharCode(0x27);
const CURLY = String.fromCharCode(0x2019);

console.log("\nSMS segment arithmetic\n");

console.log("1 · GSM-7 boundaries");
eq("160 plain characters is one segment", smsCost("a".repeat(160)).segments, 1);
eq("161 tips into two", smsCost("a".repeat(161)).segments, 2);
// Concatenated parts give up header space: 153 each, not 160.
eq("306 still fits two parts (153 x 2)", smsCost("a".repeat(306)).segments, 2);
eq("307 needs three", smsCost("a".repeat(307)).segments, 3);
eq("159 leaves exactly one character", smsCost("a".repeat(159)).remaining, 1);
eq("and says so in words", smsCostLabel(smsCost("a".repeat(159))), "1 character remaining · SMS");
eq("a full segment says 'full'", smsCostLabel(smsCost("a".repeat(160))), "full · SMS");

console.log("\n2 · Escaped characters cost two");
eq("a brace is two units", smsCost("{").units, 2);
eq("80 braces exactly fill a segment", smsCost("{".repeat(80)).segments, 1);
eq("81 braces do not", smsCost("{".repeat(81)).segments, 2);

console.log("\n3 · The curly apostrophe, which is the one that actually happens");
const straight = smsCost(`Don${APOSTROPHE}t miss it`);
const curly = smsCost(`Don${CURLY}t miss it`);
eq("a typed apostrophe stays GSM-7", straight.encoding, "GSM_7BIT");
eq("one pasted from Word forces UCS-2", curly.encoding, "UCS2");
eq("and drops the segment from 160 to 70", curly.perSegment, 70);
eq("the offending character is named", curly.offenders, [CURLY]);
eq("71 UCS-2 characters need two segments", smsCost(CURLY.repeat(71)).segments, 2);
// Same sentence, same words on screen — less than half the room.
if (curly.remaining < straight.remaining - 80) ok(`the same sentence loses ${straight.remaining - curly.remaining} characters of headroom`);
else bad("the curly-quote penalty is not being counted");

console.log("\n4 · Astral characters are two UTF-16 units");
eq("one emoji costs two", smsCost("\u{1F600}").units, 2);
eq("and forces UCS-2", smsCost("\u{1F600}").encoding, "UCS2");

console.log("\n5 · Empty and edge input");
eq("an empty message is one segment, not zero", smsCost("").segments, 1);
eq("with a full segment free", smsCost("").remaining, 160);

console.log("\n6 · Worst case expands placeholders");
const tpl = "{org}: Hi {name}, KES {amount} is due on {date}.";
if (templateWorstCase(tpl).units > smsCost(tpl).units) ok("worst case is larger than the template as typed");
else bad("placeholders are not being expanded");

console.log("\n7 · Every shipped template, costed at its worst case");
console.log("    (placeholders at their longest realistic value)\n");
const templates = defaultSmsTemplates();

// The high-volume messages. One installment on a weekly product fires all five of
// these, to every borrower, forever — so a second segment here is the most
// expensive mistake in the catalogue and the bar is one segment, no exceptions.
const ladder = ["disbursed", "payment", "reminder", "due_tomorrow", "due_today", "arrears", "arrears_final"];

// Messages where length is the POINT. A guarantor has to be told what they are
// liable for and a signing code has to name what it signs; trimming those to hit
// a billing target trades a legal disclosure for a fraction of a shilling. They
// are sent once per agreement, not once per installment, so the cost is bounded.
// Listed explicitly rather than exempted by a length threshold — an exemption
// nobody had to type is an exemption nobody reviewed.
const LONG_BY_DESIGN = new Set(["offer_sign", "guarantor_invite", "guarantor_sign", "kyc_link"]);

for (const t of templates) {
  const c = templateWorstCase(t.body);
  const onLadder = ladder.includes(t.key);
  const exempt = LONG_BY_DESIGN.has(t.key);

  // UCS-2 is never acceptable. It is always caused by one stray character — a
  // curly quote, an em dash — that reads identically to its ASCII twin and costs
  // more than half the segment. There is no message this trade is worth.
  const unicodeFault = c.encoding === "UCS2";
  const tooLong = c.segments > 1 && !exempt;
  if (unicodeFault || tooLong) failures++;

  const mark = unicodeFault || tooLong ? "!" : "+";
  const note = unicodeFault ? `  ← UCS-2 from ${c.offenders.map((o) => `"${o}"`).join(" ")}`
    : tooLong ? "  ← over one segment"
      : onLadder ? "  ← repayment ladder"
        : exempt && c.segments > 1 ? "  (long by design, sent once per agreement)"
          : "";

  console.log(
    `  ${mark} ${t.key.padEnd(17)} ${String(c.units).padStart(3)} units` +
    ` · ${c.segments} segment${c.segments === 1 ? " " : "s"}` +
    ` · ${c.encoding.padEnd(9)}${note}`,
  );
}

console.log("\n8 · The repayment ladder is complete");
for (const key of ladder) {
  if (templates.some((t) => t.key === key)) ok(`${key} is in the catalogue`);
  else bad(`${key} is MISSING — the ladder has a hole at that offset`);
}

const oneSegment = templates.filter((t) => templateWorstCase(t.body).segments === 1).length;
console.log(
  failures === 0
    ? `\nAll checks passed. ${templates.length} templates: ${oneSegment} fit one segment, ` +
      `${templates.length - oneSegment} are long by design, none are UCS-2.\n`
    : `\n${failures} check(s) failed.\n`,
);
process.exit(failures === 0 ? 0 : 1);
