// ─────────────────────────────────────────────────────────────────────────────
// M-Pesa statement parser — turns extracted statement text into typed, classified
// transactions. Built for the official Safaricom detailed-statement table:
//   Receipt No | Completion Time | Details | Status | Paid In | Withdrawn | Balance
//
// Robust to whitespace/line-merge noise from PDF extraction: rows are located by
// the 10-char receipt code + datetime, and amounts are read from the row tail.
// ─────────────────────────────────────────────────────────────────────────────

export type TxnCategory =
  | "income_received"
  | "salary"
  | "business_in"
  | "deposit"
  | "send_money"
  | "paybill"
  | "till"
  | "withdraw"
  | "airtime"
  | "savings_in"
  | "savings_out"
  | "loan_in"
  | "loan_repay"
  | "gambling"
  | "bank_transfer"
  | "reversal"
  | "charge"
  | "other";

export type MpesaTxn = {
  receipt: string;
  date: string; // YYYY-MM-DD
  time?: string;
  month: string; // YYYY-MM
  details: string;
  direction: "in" | "out";
  amount: number; // positive magnitude
  balance: number;
  category: TxnCategory;
  isGambling: boolean;
  isLoanApp: boolean;
};

// Known Kenyan betting brands (name match in the Details string).
const GAMBLING = [
  "sportpesa", "betika", "odibets", "1xbet", "mozzart", "betway", "shabiki",
  "bangbet", "betlion", "mcheza", "kwikbet", "premierbet", "helabet", "melbet",
  "22bet", "ngarist", "chezacash", "betpawa", "elitebet", "dafabet",
];

// Known digital-loan providers (borrowing/repayment signal).
const LOAN_APPS = [
  "tala", "branch", "zenka", "okash", "timiza", "stawi", "zash", "ipesa",
  "berry", "mfanisi", "hustler fund", "kcb m-pesa", "m-shwari", "mshwari",
  "fuliza", "saida", "lpesa", "kuwazo", "credit", "loan", "okolea", "champion",
];

const has = (s: string, words: string[]) => words.some((w) => s.includes(w));

function classify(detailsRaw: string): { category: TxnCategory; direction: "in" | "out"; isGambling: boolean; isLoanApp: boolean } {
  const raw = detailsRaw.toLowerCase();
  const isGambling = has(raw, GAMBLING);

  // Fuliza loan EVENTS. Safaricom books the actual draw-down as its own
  // "OverDraft of Credit Party" row — a purchase "with Fuliza" is NOT the borrow
  // (counting it too would double-count), so the funding token is stripped and
  // the row classifies as the ordinary spend it funds.
  if (raw.includes("overdraft of credit party")) return { category: "loan_in", direction: "in", isGambling, isLoanApp: true };
  if (raw.includes("od loan repayment") || raw.includes("overdraw") || (raw.includes("fuliza") && raw.includes("repay")))
    return { category: "loan_repay", direction: "out", isGambling, isLoanApp: true };
  const d = raw.replace(/\bwith fuliza\b/g, " ").replace(/\bfuliza m-?pesa\b/g, " ");
  const isLoanApp = has(d, LOAN_APPS);

  // Charges / fees — word-boundary so "Recharge for Customer" is not a charge.
  if (/\bcharge\b/.test(d) || /\bfees?\b/.test(d)) return { category: "charge", direction: "out", isGambling, isLoanApp };

  // Reversals (money back in)
  if (d.includes("reversal")) return { category: "reversal", direction: "in", isGambling, isLoanApp };

  // Savings & loans (M-Shwari / KCB M-PESA / loan apps)
  if (d.includes("m-shwari") || d.includes("mshwari") || d.includes("kcb m-pesa") || d.includes("kcb mpesa")) {
    if (d.includes("loan") && (d.includes("disburse") || d.includes("disbursement"))) return { category: "loan_in", direction: "in", isGambling, isLoanApp: true };
    if (d.includes("loan") && d.includes("repay")) return { category: "loan_repay", direction: "out", isGambling, isLoanApp: true };
    if (d.includes("withdraw")) return { category: "savings_in", direction: "in", isGambling, isLoanApp };
    if (d.includes("deposit")) return { category: "savings_out", direction: "out", isGambling, isLoanApp };
  }
  if (isLoanApp && (d.includes("disburse") || d.includes("received"))) return { category: "loan_in", direction: "in", isGambling, isLoanApp: true };

  // Airtime & data (before generic checks — "Recharge"/"Bundle Purchase" rows)
  if (d.includes("airtime") || d.includes("recharge for customer") || d.includes("bundle")) return { category: "airtime", direction: "out", isGambling, isLoanApp };

  // Inflows
  if (d.includes("funds received") || d.includes("received from") || d.includes("receive funds from") || d.includes("receive international"))
    return { category: "income_received", direction: "in", isGambling, isLoanApp };
  if (d.includes("salary")) return { category: "salary", direction: "in", isGambling, isLoanApp };
  if (d.includes("business payment from") || d.includes("merchant customer payment from")) return { category: "business_in", direction: "in", isGambling, isLoanApp };
  if (d.includes("deposit") && d.includes("agent")) return { category: "deposit", direction: "in", isGambling, isLoanApp };

  // Outflows — withdrawal BEFORE till: "Customer Withdrawal at Agent Till".
  if (isGambling) return { category: "gambling", direction: "out", isGambling, isLoanApp };
  if (d.includes("pay bill") || d.includes("paybill")) return { category: "paybill", direction: "out", isGambling, isLoanApp };
  if (d.includes("withdraw")) return { category: "withdraw", direction: "out", isGambling, isLoanApp };
  if (d.includes("merchant payment") || d.includes("buy goods") || d.includes("till")) return { category: "till", direction: "out", isGambling, isLoanApp };
  if (
    d.includes("pochi") || d.includes("payment to small business") || d.includes("send money to micro sme business") ||
    d.includes("customer transfer") || d.includes("send money") || d.includes("transfer to")
  )
    return { category: "send_money", direction: "out", isGambling, isLoanApp };
  if (d.includes("bank") || d.includes("pesalink")) return { category: "bank_transfer", direction: "out", isGambling, isLoanApp };

  return { category: "other", direction: "out", isGambling, isLoanApp };
}

const RECEIPT = "[A-Z0-9]{10}";
const DATE = "\\d{4}-\\d{2}-\\d{2}";
const TIME = "\\d{1,2}:\\d{2}(?::\\d{2})?";
const MONEY = /-?\d[\d,]*\.\d{2}/g;

/**
 * Whose statement IS this? The official Safaricom statement prints the account
 * holder in the header ("Customer Name: JANE ACHIENG ODHIAMBO"). PDF extraction
 * merges lines, so the capture stops at the next header label. Null when the
 * header can't be read — a missing name is "can't check", never "checked ok".
 */
export function extractStatementName(text: string): string | null {
  const head = text.slice(0, 3000);
  const m = head.match(/customer\s*name\s*[:\-]?\s*([A-Za-z][A-Za-z' .-]{2,80})/i);
  if (!m) return null;
  const cut = m[1].split(/\b(?:mobile|number|msisdn|date|statement|period|email|address|request|from|to)\b/i)[0];
  const cleaned = cut.replace(/\s+/g, " ").trim().replace(/[.,-]+$/, "");
  return cleaned.length >= 3 ? cleaned : null;
}

/**
 * Do two person-names refer to the same human? Token overlap, order-blind:
 * Kenyan documents disagree on WHICH of the three registry names they print
 * (M-Pesa often carries first + third), so any two shared names is a match —
 * one shared name is enough only when either side has just one to offer.
 */
export function namesMatch(a: string, b: string): { match: boolean; shared: string[] } {
  const tok = (s: string) => [...new Set(s.toUpperCase().replace(/[^A-Z]+/g, " ").split(" ").filter((w) => w.length >= 2))];
  const ta = tok(a), tb = tok(b);
  if (ta.length === 0 || tb.length === 0) return { match: false, shared: [] };
  const set = new Set(ta);
  const shared = tb.filter((w) => set.has(w));
  return { match: shared.length >= 2 || (shared.length >= 1 && Math.min(ta.length, tb.length) === 1), shared };
}

/** Parse the detailed M-Pesa transaction table from extracted statement text. */
export function parseMpesaStatement(text: string): MpesaTxn[] {
  const rowRe = new RegExp(
    `(${RECEIPT})\\s+(${DATE})\\s*(${TIME})?\\s+([\\s\\S]*?)(?=(?:${RECEIPT}\\s+${DATE})|$)`,
    "g",
  );

  // Pass 1 — collect raw rows so direction can use a doc-level signal.
  type RawRow = { receipt: string; date: string; time?: string; details: string; flow: number; balance: number; idx: number };
  const rows: RawRow[] = [];
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(text)) !== null) {
    const rest = (m[4] || "").replace(/\s+/g, " ").trim();
    const nums = [...rest.matchAll(MONEY)].map((x) => parseFloat(x[0].replace(/,/g, "")));
    if (nums.length === 0) continue;

    // Details = text before the first trailing money token.
    const firstNumIdx = rest.search(MONEY);
    const details = (firstNumIdx > 0 ? rest.slice(0, firstNumIdx) : rest)
      .replace(/\bcompleted\b/i, "")
      .replace(/\s+/g, " ")
      .trim();

    // Flow value = the non-balance amount (prefer an explicitly negative one).
    const flowVals = nums.slice(0, -1).filter((n) => n !== 0);
    if (flowVals.length === 0) continue; // zero-value rows carry no movement
    const neg = flowVals.find((n) => n < 0);
    const flow = neg ?? flowVals.reduce((a, b) => (Math.abs(b) > Math.abs(a) ? b : a), flowVals[0]);

    rows.push({ receipt: m[1], date: m[2], time: m[3] || undefined, details, flow, balance: nums[nums.length - 1], idx: rows.length });
  }
  if (rows.length === 0) return [];

  // Official statements sign the Withdrawn column negative — when any signed
  // amount exists, the sign is authoritative for direction. Unsigned layouts
  // fall back to the classifier's direction.
  const docSigned = rows.some((r) => r.flow < 0);

  // Chronological order. Statements are usually newest-first; detect from the
  // endpoints so within-timestamp ties keep document order accordingly
  // (balance continuity depends on this — closing balance, trend).
  const stamp = (r: RawRow) => `${r.date} ${r.time ?? "00:00:00"}`;
  const newestFirst = stamp(rows[0]) >= stamp(rows[rows.length - 1]);
  rows.sort((a, b) => {
    const sa = stamp(a), sb = stamp(b);
    if (sa !== sb) return sa < sb ? -1 : 1;
    return newestFirst ? b.idx - a.idx : a.idx - b.idx;
  });

  return rows.map((r) => {
    const cls = classify(r.details);
    return {
      receipt: r.receipt,
      date: r.date,
      time: r.time,
      month: r.date.slice(0, 7),
      details: r.details,
      direction: docSigned ? (r.flow < 0 ? ("out" as const) : ("in" as const)) : cls.direction,
      amount: Math.abs(r.flow),
      balance: r.balance,
      category: cls.category,
      isGambling: cls.isGambling,
      isLoanApp: cls.isLoanApp,
    };
  });
}
