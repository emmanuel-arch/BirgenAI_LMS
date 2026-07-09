// Tests for the Document Parser — blueprint §9.
//
//   npm run test:documents      (pure; no database, no app server, no network)
//
// The rules are the risk. A misread total on a school fee structure becomes a wrong
// disbursement to a school, so these tests use text shaped like the real documents:
// dot leaders, KES prefixes, day-first dates, county permits, the lot. Where a rule
// cannot find something, the parser must SAY so rather than guess — several of the
// assertions below exist only to prove it stays quiet.
import {
  extractDocument, normalize, amounts, toAmount, findDate, findPaybill,
  lineItems, isComplete,
} from "@/lib/documents/extract";
import { sniff, decodeUpload, parseDocument, parserMode, UnsupportedDocumentError } from "@/lib/documents/parse";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, extra = "") => {
  if (cond) { pass++; console.log(`  PASS  ${name}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.log(`  FAIL  ${name}${extra ? ` — ${extra}` : ""}`); }
};

const FEE_STRUCTURE = `
ST. MARY'S SECONDARY SCHOOL, NAKURU
P.O. Box 1234-20100, Nakuru
FEE STRUCTURE - TERM 2, 2026

Tuition ......................... KES 18,500.00
Boarding ........................ KES 12,000.00
Lunch programme ................. KES 4,500.00
Activity fee .................... KES 1,200.00
Development levy ................ KES 3,800.00

GRAND TOTAL ..................... KES 40,000.00

Payment: Paybill 522522, Account No. STM-2026-4471
All fees are payable by 15/05/2026.
`;

const INVOICE = `
Jumbo Hardware Supplies Ltd
VAT PIN P051234567X

INVOICE NO: INV-2026-0842
Date: 09/07/2026
Due date: 09/08/2026

Cement 50kg x 40 ............ 32,000
Steel bars .................. 18,500
Delivery .................... 2,500

VAT (16%) ................... 8,480
TOTAL AMOUNT DUE ............ KES 61,480
`;

const PERMIT = `
NAKURU COUNTY GOVERNMENT
Single Business Permit

Permit No: NKR/SBP/2026/00918
Business: Wanjiru General Store
Valid from: 01/01/2026
Valid until: 31/12/2026
Fee paid: KES 7,500
`;

const BANK_STATEMENT = `
Equity Bank Kenya Limited
Statement of Account

Account No: 0170123456789
Statement period from 01/01/2026 to 30/06/2026

Opening balance      KES 45,320.00
Closing balance      KES 112,880.50
`;

const NATIONAL_ID = `
REPUBLIC OF KENYA
NATIONAL IDENTITY CARD

ID Number: 31245678
Full Names: JANE ATIENO OCHIENG
Date of Birth: 12/03/1994
Serial Number: 100234567
`;

/** A fee structure whose paybill was cropped off the scan. */
const FEE_STRUCTURE_INCOMPLETE = `
Riverside Academy
Tuition ......... KES 20,000
GRAND TOTAL ..... KES 20,000
`;

function main() {
  console.log("1. Reading numbers and dates the way Kenyan documents write them");
  ok("KES 40,000.00 → 40000", toAmount("40,000.00") === 40000);
  ok("a bare 12,000 is money; a bare 2026 is not",
    amounts("Boarding 12,000 for year 2026").length === 1 && amounts("Boarding 12,000 for year 2026")[0] === 12000);
  ok("15/05/2026 is day-first", findDate("payable by 15/05/2026") === "2026-05-15");
  ok("13/07/2026 can only be day-first, and is read that way", findDate("13/07/2026") === "2026-07-13");
  ok("2026-07-09 is read as written", findDate("on 2026-07-09") === "2026-07-09");
  ok("9 Jul 2026 is read", findDate("dated 9 Jul 2026") === "2026-07-09");
  ok("paybill 522522 is found", findPaybill("Payment: Paybill 522522, Account") === "522522");
  ok("normalize keeps lines, collapses runs of spaces", normalize("a   b\n\n\n\nc") === "a b\n\nc");

  console.log("\n2. Line items: the parts, not the total");
  const items = lineItems(FEE_STRUCTURE);
  ok("five fee lines are read", items.length === 5, items.map((i) => i.label).join(" | "));
  ok("dot leaders are stripped from the label", items[0].label === "Tuition", `"${items[0].label}"`);
  ok("the amount rides with its label", items[0].amountKes === 18500);
  ok("GRAND TOTAL is NOT counted as a line item — double counting breaks the sum",
    !items.some((i) => /total/i.test(i.label)));

  console.log("\n3. A school fee structure");
  const fee = extractDocument("FEE_STRUCTURE", FEE_STRUCTURE);
  ok("the school is named", String(fee.fields.institution).startsWith("ST. MARY'S"));
  ok("the total is 40,000", fee.fields.totalKes === 40000);
  ok("the paybill is 522522", fee.fields.paybill === "522522");
  ok("the account is read", fee.fields.account === "STM-2026-4471", String(fee.fields.account));
  ok("the term is read", /term\s*2/i.test(String(fee.fields.term)));
  ok("the parts add up to the total, and we checked", fee.fields.itemsSumMatchesTotal === true);
  ok("confidence is full", fee.confidence === 1);
  ok("nothing is missing", fee.missing.length === 0);

  console.log("\n4. When a field is missing we say so, we do not invent it");
  const partial = extractDocument("FEE_STRUCTURE", FEE_STRUCTURE_INCOMPLETE);
  ok("no paybill is reported", partial.fields.paybill === undefined);
  ok("the missing field is named", partial.missing.includes("paybill"));
  ok("two fields out of three is not two-thirds of a fee structure — it needs review",
    !isComplete(partial), `confidence ${partial.confidence}`);
  ok("the total it DID find is still right", partial.fields.totalKes === 20000);
  ok("a document of unknown kind is never treated as complete",
    !isComplete(extractDocument("OTHER", FEE_STRUCTURE)));

  console.log("\n5. An invoice");
  const inv = extractDocument("INVOICE", INVOICE);
  ok("invoice number", inv.fields.invoiceNumber === "INV-2026-0842", String(inv.fields.invoiceNumber));
  ok("supplier", String(inv.fields.supplier).startsWith("Jumbo Hardware"));
  ok("total is 61,480", inv.fields.totalKes === 61480);
  ok("VAT is 8,480, not the total", inv.fields.vatKes === 8480);
  ok("issued 09/07/2026", inv.fields.issuedOn === "2026-07-09");
  ok("due 09/08/2026", inv.fields.dueOn === "2026-08-09");
  ok("confidence is full", inv.confidence === 1);

  console.log("\n6. A county business permit");
  const permit = extractDocument("PERMIT", PERMIT);
  ok("permit number", permit.fields.permitNumber === "NKR/SBP/2026/00918", String(permit.fields.permitNumber));
  ok("county", /nakuru/i.test(String(permit.fields.county)), String(permit.fields.county));
  ok("valid until 31/12/2026", permit.fields.validTo === "2026-12-31");
  ok("fee 7,500", permit.fields.feeKes === 7500);
  ok("confidence is full", permit.confidence === 1);

  console.log("\n7. A bank statement");
  const bank = extractDocument("BANK_STATEMENT", BANK_STATEMENT);
  ok("account number", bank.fields.accountNumber === "0170123456789", String(bank.fields.accountNumber));
  ok("opening balance", bank.fields.openingBalanceKes === 45320);
  ok("closing balance", bank.fields.closingBalanceKes === 112880.5);
  ok("confidence is full", bank.confidence === 1);

  console.log("\n8. A national ID");
  const id = extractDocument("NATIONAL_ID", NATIONAL_ID);
  ok("id number is anchored on its label, not any 8-digit run", id.fields.idNumber === "31245678");
  ok("name", String(id.fields.fullName).includes("JANE ATIENO OCHIENG"));
  ok("date of birth", id.fields.dateOfBirth === "1994-03-12");
  ok("serial", id.fields.serialNumber === "100234567");

  console.log("\n9. The file itself is sniffed, not trusted");
  ok("%PDF- is a pdf", sniff(Buffer.from("%PDF-1.7\nrest")) === "application/pdf");
  ok("JPEG magic bytes", sniff(Buffer.from([0xff, 0xd8, 0xff, 0x00])) === "image/jpeg");
  let threw = false;
  try { sniff(Buffer.from("<html>not a document</html>")); } catch (e) { threw = e instanceof UnsupportedDocumentError; }
  ok("an HTML file dressed as a PDF is refused", threw);

  threw = false;
  try { decodeUpload("data:application/pdf;base64,PGh0bWw+"); } catch (e) { threw = e instanceof UnsupportedDocumentError; }
  ok("a data URL claiming application/pdf but carrying HTML is refused", threw);

  threw = false;
  try { decodeUpload("not-a-data-url"); } catch (e) { threw = e instanceof UnsupportedDocumentError; }
  ok("a non data URL is refused", threw);

  console.log("\n10. What we cannot read, we admit");
  return parseDocument(Buffer.from([0xff, 0xd8, 0xff, 0x00]), "image/jpeg", "PERMIT").then((r) => {
    ok("a photograph is stored UNPARSED, not guessed at", r.status === "UNPARSED" && r.extraction === null);
    ok("and the reason names OCR", /recognition/i.test(r.note ?? ""), r.note ?? "");
    ok("parserMode is simulation without an OCR key", parserMode() === "simulation");

    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail === 0 ? 0 : 1);
  });
}

void main();
