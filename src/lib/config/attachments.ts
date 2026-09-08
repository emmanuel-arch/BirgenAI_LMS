// ─────────────────────────────────────────────────────────────────────────────
// THE ATTACHMENT CATALOGUE — what a lender may ask a customer to bring.
//
// Until now this list was a `const DOC_CATALOGUE` in the borrower-settings screen:
// fourteen hard-coded rows that every lender on the platform shared and none of
// them could change. A lender who finances boda-bodas and needs a "Logbook +
// insurance certificate" had to ask us for a deploy.
//
// The system we are replacing does have a table for this (`AttachmentFiles`), and
// it is the right idea — an attachment there is a name, a description, a list of
// permitted extensions and an allow-multiple flag. What it does not have is any
// notion of WHERE an attachment belongs (their `Attachments` list is one flat pool
// offered identically to a borrower profile, a loan application and a workflow
// stage) or WHAT READS IT (an M-Pesa statement and a passport photo are not the
// same kind of object, and only one of them feeds a cashflow score).
//
// So a catalogue row here carries three things theirs cannot:
//
//   scopes  — where this document may be asked for at all. A payslip is not a
//             transaction attachment; a security photo is not a borrower one.
//   parser  — which reader, if any, runs over it. This is what makes an M-Pesa
//             statement worth more than a filename, and it is what the check
//             catalogue (lib/workflow/checks.ts) binds against.
//   builtIn — platform rows a lender may rename, re-scope, or switch off, but not
//             delete, because engines reference them by code.
//
// One document, versioned like every other namespace, so switching off "Home photo"
// is a publish with a history and not an UPDATE nobody can date.
// ─────────────────────────────────────────────────────────────────────────────
import type { ConfigIssue } from "./borrower";

/** Where an attachment may be asked for. */
export const ATTACHMENT_SCOPES = [
  { key: "borrower", label: "Borrower profile", blurb: "Collected once, when the person is onboarded." },
  { key: "loan", label: "Loan application", blurb: "Collected per application, per product." },
  { key: "approval", label: "Approval stage", blurb: "Uploaded by staff while a loan moves through a workflow." },
  { key: "guarantor", label: "Guarantor", blurb: "Collected from the person standing surety." },
  { key: "security", label: "Security", blurb: "Evidence of the collateral itself." },
  { key: "transaction", label: "Transaction", blurb: "Attached to a payment, a waiver, a write-off." },
] as const;

export type AttachmentScope = (typeof ATTACHMENT_SCOPES)[number]["key"];

/** Which reader, if any, runs over the file once it lands. */
export const ATTACHMENT_PARSERS = [
  { key: "none", label: "Stored only", blurb: "Kept on file. Nothing reads it." },
  { key: "id_document", label: "ID document (OCR)", blurb: "Names, ID number, date of birth and sex are read off the card." },
  { key: "mpesa_statement", label: "M-Pesa statement", blurb: "Six months of till and personal flow, turned into income and volatility." },
  { key: "bank_statement", label: "Bank statement", blurb: "The same cashflow read, for a banked borrower." },
  { key: "payslip", label: "Payslip", blurb: "Net pay and deductions, for salary-advance lending." },
  { key: "face", label: "Face image", blurb: "Matched against the photo on the ID document." },
] as const;

export type AttachmentParser = (typeof ATTACHMENT_PARSERS)[number]["key"];

/** Every extension the platform will accept, for the file-type picker. */
export const FILE_TYPES = [
  ".pdf", ".png", ".jpg", ".jpeg", ".doc", ".docx", ".xls", ".xlsx", ".csv", ".heic",
] as const;

export type AttachmentItem = {
  /** Stable, uppercase, referenced by products, workflows and the check catalogue. */
  code: string;
  name: string;
  /** The short tag shown under the name in lists — ServiceSuite's abbreviation column. */
  shortCode: string;
  description: string;
  /** Permitted extensions, lower case, with the dot. */
  fileTypes: string[];
  /** More than one file may be uploaded against this row. */
  allowMultiple: boolean;
  /** Off = the row survives, references keep resolving, nobody is asked for it. */
  active: boolean;
  scopes: AttachmentScope[];
  parser: AttachmentParser;
  /** Largest single file, in megabytes. */
  maxSizeMb: number;
  /** Platform row: may be edited and switched off, never deleted. */
  builtIn: boolean;
};

export type AttachmentConfig = { items: AttachmentItem[] };

const item = (
  code: string,
  name: string,
  shortCode: string,
  description: string,
  fileTypes: string[],
  scopes: AttachmentScope[],
  parser: AttachmentParser = "none",
  allowMultiple = false,
): AttachmentItem => ({
  code, name, shortCode, description, fileTypes, allowMultiple,
  active: true, scopes, parser, maxSizeMb: 10, builtIn: true,
});

/**
 * The platform catalogue. Deliberately the same codes the borrower settings screen
 * and the document pipeline already use, so publishing this namespace for the first
 * time changes nothing anyone had already configured.
 */
export const ATTACHMENT_DEFAULTS: AttachmentConfig = {
  items: [
    item("ID_FRONT", "ID — front", "IDF", "Read by the document parser to fill the identity fields.", [".png", ".jpg", ".jpeg", ".pdf"], ["borrower"], "id_document"),
    item("ID_BACK", "ID — back", "IDB", "The reverse of the identity document.", [".png", ".jpg", ".jpeg", ".pdf"], ["borrower"], "id_document"),
    item("SELFIE", "Selfie", "SF", "Face-matched against the photo on the ID.", [".png", ".jpg", ".jpeg"], ["borrower"], "face"),
    item("PASSPORT_PHOTO", "Passport photo", "PP", "The canonical portrait held on the customer file.", [".png", ".jpg", ".jpeg"], ["borrower"], "face"),
    item("MPESA_STATEMENT", "M-Pesa statement", "MS", "Six-month PDF — feeds the cashflow score.", [".pdf"], ["borrower", "loan"], "mpesa_statement", true),
    item("BANK_STATEMENT", "Bank statement", "BS", "For a banked borrower.", [".pdf"], ["borrower", "loan"], "bank_statement", true),
    item("BUSINESS_PHOTO", "Business photo", "BP", "The premises being lent against.", [".png", ".jpg", ".jpeg"], ["borrower", "loan"], "none", true),
    item("HOME_PHOTO", "Home photo", "HP", "Residence verification.", [".png", ".jpg", ".jpeg"], ["borrower"], "none", true),
    item("BUSINESS_LICENCE", "Business licence", "BL", "Single business permit.", [".pdf", ".png", ".jpg", ".jpeg"], ["borrower", "loan"]),
    item("KRA_PIN", "KRA PIN", "KP", "Tax registration certificate.", [".pdf", ".png", ".jpg", ".jpeg"], ["borrower"]),
    item("PAYSLIP", "Payslip", "PS", "Salary-advance lending.", [".pdf", ".png", ".jpg", ".jpeg", ".docx"], ["borrower", "loan"], "payslip", true),
    item("EMPLOYMENT_LETTER", "Employment letter", "EL", "Confirms the salary claim.", [".pdf", ".png", ".jpg", ".jpeg", ".doc", ".docx"], ["borrower", "loan"]),
    item("SECURITY_PHOTO", "Security photo", "SP", "The collateral itself.", [".png", ".jpg", ".jpeg"], ["security", "loan"], "none", true),
    item("LOGBOOK", "Logbook", "LB", "Asset finance and logbook loans.", [".pdf", ".png", ".jpg", ".jpeg"], ["security", "loan"]),
    item("LOAN_FORM", "Signed loan form", "LF", "The executed agreement.", [".pdf", ".png", ".jpg", ".jpeg", ".doc", ".docx"], ["loan", "approval"]),
    item("SPOUSAL_CONSENT", "Spousal consent form", "SC", "Where a household asset stands as security.", [".pdf", ".png", ".jpg", ".jpeg", ".doc", ".docx"], ["loan", "security"]),
    item("GUARANTOR_ID", "Guarantor ID", "GI", "The surety's identity document.", [".png", ".jpg", ".jpeg", ".pdf"], ["guarantor"], "id_document"),
    item("PAYMENT_PROOF", "Proof of payment", "POP", "A deposit slip or M-Pesa message against a transaction.", [".pdf", ".png", ".jpg", ".jpeg"], ["transaction"], "none", true),
  ],
};

// ── Merge ─────────────────────────────────────────────────────────────────────

const norm = (v: unknown, fallback = "") => (typeof v === "string" ? v : fallback);

function mergeItem(raw: unknown, base?: AttachmentItem): AttachmentItem | null {
  const o = (typeof raw === "object" && raw ? raw : {}) as Record<string, unknown>;
  const code = norm(o.code, base?.code ?? "").toUpperCase().replace(/[^A-Z0-9_]/g, "").slice(0, 32);
  if (!code) return null;

  const scopes = Array.isArray(o.scopes)
    ? (o.scopes.filter((s) => ATTACHMENT_SCOPES.some((x) => x.key === s)) as AttachmentScope[])
    : base?.scopes ?? ["loan"];
  const fileTypes = Array.isArray(o.fileTypes)
    ? [...new Set(o.fileTypes.map((t) => String(t).toLowerCase().trim()).filter((t) => /^\.[a-z0-9]{2,5}$/.test(t)))]
    : base?.fileTypes ?? [".pdf"];
  const parser = ATTACHMENT_PARSERS.some((p) => p.key === o.parser)
    ? (o.parser as AttachmentParser)
    : base?.parser ?? "none";
  const size = Number(o.maxSizeMb);

  return {
    code,
    name: norm(o.name, base?.name ?? code).slice(0, 80),
    shortCode: norm(o.shortCode, base?.shortCode ?? code.slice(0, 3)).toUpperCase().slice(0, 8),
    description: norm(o.description, base?.description ?? "").slice(0, 240),
    fileTypes: fileTypes.length ? fileTypes : [".pdf"],
    allowMultiple: typeof o.allowMultiple === "boolean" ? o.allowMultiple : base?.allowMultiple ?? false,
    active: typeof o.active === "boolean" ? o.active : base?.active ?? true,
    scopes: scopes.length ? scopes : ["loan"],
    parser,
    maxSizeMb: Number.isFinite(size) ? Math.max(1, Math.min(50, Math.round(size))) : base?.maxSizeMb ?? 10,
    // Never taken from the wire: a lender cannot promote their own row to built-in,
    // nor demote ours to something they can delete out from under an engine.
    builtIn: base?.builtIn ?? false,
  };
}

/**
 * Fill a stored document forward.
 *
 * Built-in rows are merged onto their defaults and re-appended if the lender's
 * document predates them, so shipping a new platform attachment reaches every
 * tenant without touching what they already chose about the old ones.
 */
export function mergeAttachmentConfig(stored: unknown): AttachmentConfig {
  const s = (typeof stored === "object" && stored ? stored : {}) as Record<string, unknown>;
  const byCode = new Map(ATTACHMENT_DEFAULTS.items.map((i) => [i.code, i]));

  const seen = new Set<string>();
  const out: AttachmentItem[] = [];
  for (const raw of Array.isArray(s.items) ? s.items : []) {
    const code = String((raw as { code?: unknown })?.code ?? "").toUpperCase();
    const merged = mergeItem(raw, byCode.get(code));
    if (!merged || seen.has(merged.code)) continue;
    seen.add(merged.code);
    out.push(merged);
  }
  for (const d of ATTACHMENT_DEFAULTS.items) {
    if (!seen.has(d.code)) out.push({ ...d });
  }
  return { items: out };
}

export function validateAttachmentConfig(cfg: AttachmentConfig): ConfigIssue[] {
  const out: ConfigIssue[] = [];
  const seen = new Set<string>();
  cfg.items.forEach((i, idx) => {
    if (i.name.trim().length < 2) out.push({ path: `items.${idx}.name`, message: "Give the attachment a name." });
    if (seen.has(i.code)) out.push({ path: `items.${idx}.code`, message: `Two attachments share the code ${i.code}.` });
    seen.add(i.code);
    if (i.fileTypes.length === 0) out.push({ path: `items.${idx}.fileTypes`, message: `${i.name}: allow at least one file type.` });
    if (i.scopes.length === 0) out.push({ path: `items.${idx}.scopes`, message: `${i.name}: it must be askable somewhere.` });
  });
  // A built-in row an engine binds to must not be quietly removed from the document.
  for (const d of ATTACHMENT_DEFAULTS.items) {
    if (!cfg.items.some((i) => i.code === d.code)) {
      out.push({ path: "items", message: `${d.name} is a platform attachment and cannot be deleted — switch it off instead.` });
    }
  }
  return out;
}

// ── Readers ───────────────────────────────────────────────────────────────────

/** The live, switched-on catalogue for one surface. */
export const attachmentsForScope = (cfg: AttachmentConfig, scope: AttachmentScope) =>
  cfg.items.filter((i) => i.active && i.scopes.includes(scope));

/** Resolve a list of codes to rows, dropping anything switched off or deleted. */
export const resolveAttachments = (cfg: AttachmentConfig, codes: string[]) =>
  codes.map((c) => cfg.items.find((i) => i.code === c)).filter((i): i is AttachmentItem => Boolean(i?.active));

/** The `accept` attribute for a file input. */
export const acceptFor = (i: AttachmentItem) => i.fileTypes.join(",");
