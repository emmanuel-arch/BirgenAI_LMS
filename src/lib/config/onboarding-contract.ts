// ─────────────────────────────────────────────────────────────────────────────
// THE ONBOARDING CONTRACT — one answer to "what does this lender ask for?", built
// once on the server and rendered by every client.
//
// Three surfaces onboard a customer: the console counter, the customer app, and a
// field officer's phone. Each of them needs the same six answers — which rail to
// open on, which fields to show, which are required, which documents to take, which
// extra questions this lender invented, and what runs automatically. If each surface
// derives that itself from the raw config documents, they will drift, and the drift
// will be silent: the app will ask for an occupation the console does not, or the
// console will accept a record the app's rules would have refused.
//
// So the derivation happens HERE, once. The contract is a rendering instruction, not
// a settings dump: it has already resolved which method is primary and reachable,
// dropped hidden fields, dropped switched-off attachments, and collapsed the four
// KYC rule flags into the two a form actually needs. A client that renders this
// faithfully is correct by construction.
//
// It is deliberately SAFE TO SEND TO A BORROWER'S PHONE: nothing here is a
// credential, a threshold a fraudster could game, or another customer's data. The
// bureau minimum score and the blocking-ness of internal checks stay on the server.
// ─────────────────────────────────────────────────────────────────────────────
import {
  KYC_FIELDS, ONBOARDING_METHODS,
  type BorrowerConfig, type KycFieldKey, type OnboardingMethod,
} from "./borrower";
import {
  attachmentsForScope, type AttachmentConfig, type AttachmentItem,
} from "./attachments";
import { groupsFor, type DetailsConfig, type DetailGroup, type DetailChannel } from "./details";

export type ContractField = {
  key: KycFieldKey;
  label: string;
  help: string;
  required: boolean;
  /** Confirmed against the national registry rather than merely typed in. */
  verified: boolean;
  /** No two customers may share the value — the client can warn before submitting. */
  unique: boolean;
};

export type ContractDocument = {
  code: string;
  name: string;
  description: string;
  accept: string;
  multiple: boolean;
  maxSizeMb: number;
  /** A reader runs over it, so the client can say "this fills the form in". */
  parsed: boolean;
};

export type OnboardingContract = {
  /** The rail this surface should open on, already checked for reachability. */
  primary: OnboardingMethod;
  /** Every rail this surface may use, in the order to try them. */
  methods: { key: OnboardingMethod; label: string; blurb: string; ready: boolean }[];
  allowFallback: boolean;
  allowManualOverride: boolean;
  requireConsent: boolean;

  /** Only what this rail actually needs the human to type. */
  fields: ContractField[];
  /** The identity document this lender accepts. */
  idDocument: BorrowerConfig["kyc"]["idDocument"];

  ocr: { capture: "front" | "both"; allowEdit: boolean };
  selfie: { required: boolean; liveness: boolean };
  geo: { ask: boolean; required: boolean; places: ("business" | "home")[] };

  documents: ContractDocument[];
  /** The lender's own extra questions, already narrowed to this channel. */
  detailGroups: DetailGroup[];

  /** Age bounds, so a date picker can refuse a birthday nobody may borrow at. */
  age: { min: number; max: number } | null;
  joiningFee: { amount: number } | null;

  /**
   * What runs automatically, as a LIST OF LABELS only. A borrower is told their
   * identity will be checked; they are not told the score below which it fails.
   */
  automatedChecks: string[];

  /** False = this surface may not onboard at all, and should say so plainly. */
  enabled: boolean;
};

/** Which vault kinds are connected, so an unreachable rail is not offered. */
export type Reachability = { connectedVaults: string[] };

export function buildOnboardingContract(
  borrower: BorrowerConfig,
  attachments: AttachmentConfig,
  details: DetailsConfig,
  channel: DetailChannel,
  reach: Reachability,
): OnboardingContract {
  const o = borrower.onboarding;

  const surfaceEnabled =
    channel === "portal" ? o.channels.portal
      : channel === "ussd" ? o.channels.ussd
        : o.channels.console || o.channels.field;

  const ready = (m: OnboardingMethod) => {
    const spec = ONBOARDING_METHODS.find((x) => x.key === m)!;
    return !spec.needsVault || reach.connectedVaults.includes(spec.needsVault);
  };

  const methods = ONBOARDING_METHODS
    .filter((m) => o.methods[m.key])
    .map((m) => ({ key: m.key, label: m.label, blurb: m.blurb, ready: ready(m.key) }));

  // The configured primary, unless its credentials are missing — in which case fall
  // to the first rail that will actually work rather than opening on a dead screen.
  // Manual is the floor, and is always reachable.
  const primary: OnboardingMethod =
    o.methods[o.primary] && ready(o.primary)
      ? o.primary
      : (methods.find((m) => m.ready)?.key ?? "manual");

  // A hidden field does not exist for this lender, so it is not in the contract at
  // all — a client should never have to know the difference between "hidden" and
  // "absent". Required stays, because the form has to enforce it.
  const fields: ContractField[] = KYC_FIELDS
    .filter((f) => !borrower.kyc.fields[f.key].hidden)
    .map((f) => {
      const rule = borrower.kyc.fields[f.key];
      return {
        key: f.key,
        label: f.label,
        help: f.desc,
        required: rule.required,
        // Only meaningful when the lender actually runs the registry: "verified"
        // on a lender with no IPRS would be a promise the screen cannot keep.
        verified: rule.verify && o.methods.iprs && ready("iprs"),
        unique: rule.unique,
      };
    });

  const live = attachmentsForScope(attachments, "borrower");
  const wanted = new Set(borrower.attachments.onboarding);
  const documents: ContractDocument[] = live
    .filter((a: AttachmentItem) => wanted.has(a.code))
    .map((a) => ({
      code: a.code,
      name: a.name,
      description: a.description,
      accept: a.fileTypes.join(","),
      multiple: a.allowMultiple,
      maxSizeMb: a.maxSizeMb,
      parsed: a.parser !== "none",
    }));

  // The OCR rail needs the ID photo whether or not the lender listed it as an
  // onboarding attachment — it is the input to the rail, not a document request.
  if (primary === "ocr" || o.methods.ocr) {
    for (const code of o.ocr.capture === "both" ? ["ID_FRONT", "ID_BACK"] : ["ID_FRONT"]) {
      if (documents.some((d) => d.code === code)) continue;
      const spec = live.find((a) => a.code === code);
      if (spec) {
        documents.unshift({
          code: spec.code, name: spec.name, description: spec.description,
          accept: spec.fileTypes.join(","), multiple: false,
          maxSizeMb: spec.maxSizeMb, parsed: true,
        });
      }
    }
  }

  return {
    primary,
    methods,
    allowFallback: o.allowFallback,
    allowManualOverride: o.allowManualOverride,
    requireConsent: o.requireConsent,
    fields,
    idDocument: borrower.kyc.idDocument,
    ocr: { capture: o.ocr.capture, allowEdit: o.ocr.allowEdit },
    selfie: { required: o.selfie.required, liveness: o.selfie.liveness },
    geo: o.geo,
    documents,
    detailGroups: groupsFor(details, "borrower", channel),
    age: borrower.rules.age.enabled ? { min: borrower.rules.age.min, max: borrower.rules.age.max } : null,
    joiningFee: borrower.rules.joiningFee.enabled ? { amount: borrower.rules.joiningFee.amount } : null,
    // Labels only. Thresholds and blocking-ness are the lender's business, not the
    // applicant's, and publishing them would tell a fraudster exactly what to beat.
    automatedChecks: o.checks.map((c) => c.id),
    enabled: surfaceEnabled,
  };
}

/**
 * The fields a submission MUST carry under this contract, so the server can refuse
 * an incomplete record with the same rules the client rendered.
 */
export function requiredFields(contract: OnboardingContract): KycFieldKey[] {
  return contract.fields.filter((f) => f.required).map((f) => f.key);
}
