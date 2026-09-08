// ─────────────────────────────────────────────────────────────────────────────
// ADDITIONAL DETAILS — the fields WE did not think of, that this lender needs.
//
// Every lending system eventually meets a lender who must capture something its
// author never imagined: the sacco a customer belongs to, the route a matatu runs,
// the chief's location, the crop and the acreage. There are two ways to serve that.
// One is a column, which means a deploy, a migration, and a schema that grows a
// scar for every tenant. The other is to make the FIELD a first-class object.
//
// The system we are replacing chose the second, and was right to: `ApprovalFormItems`
// and the borrower "Forms"/"FormItems" pair let an admin declare a titled group and
// hang typed items off it. What it does not do is give those items any meaning:
//   · an item has a type but no constraints — a "Numeric" field accepts -9e99
//   · options for a dropdown are a comma-joined string in one column
//   · nothing says WHERE the field appears, so every group is asked everywhere
//   · nothing says whether the borrower may see it, only whether it is required
//   · deleting an item orphans every value ever captured under it
//
// Here a group is scoped, ordered and channel-aware, and an item carries its own
// validation. The values live on the record (Borrower.details), keyed by the item's
// stable `code`, so renaming a field's TITLE never orphans its data — which is the
// single most common way a system like this loses a year of capture.
// ─────────────────────────────────────────────────────────────────────────────
import type { ConfigIssue } from "./borrower";

/** Which record a group of fields hangs off. */
export const DETAIL_SCOPES = [
  { key: "borrower", label: "Borrower profile", blurb: "Captured once, on the customer." },
  { key: "loan", label: "Loan application", blurb: "Captured per application." },
  { key: "guarantor", label: "Guarantor", blurb: "Captured on the person standing surety." },
  { key: "security", label: "Security", blurb: "Captured on the collateral." },
  { key: "approval", label: "Approval stage", blurb: "Filled in by staff while a loan moves through a workflow." },
] as const;

export type DetailScope = (typeof DETAIL_SCOPES)[number]["key"];

/**
 * The input kinds an admin may choose from. Same vocabulary as the screen we are
 * replacing, plus the two it lacks (currency, and a live borrower/staff picker),
 * and minus nothing.
 */
export const DETAIL_TYPES = [
  { key: "text", label: "Text", blurb: "Alphanumeric characters, words, sentences." },
  { key: "textarea", label: "Long text", blurb: "Multi-line notes and descriptions." },
  { key: "numeric", label: "Numeric", blurb: "Integers or decimals." },
  { key: "currency", label: "Amount", blurb: "Money, formatted and validated as KES." },
  { key: "tel", label: "Telephone number", blurb: "A phone number, normalised to 2547…" },
  { key: "email", label: "Email address", blurb: "A valid email address." },
  { key: "radio", label: "Radio button", blurb: "One option from a short list." },
  { key: "checkbox", label: "Checkbox", blurb: "One or more options from a list." },
  { key: "dropdown", label: "Dropdown", blurb: "One option from a long list." },
  { key: "date", label: "Date only", blurb: "A calendar date." },
  { key: "time", label: "Time only", blurb: "Hours and minutes." },
  { key: "month", label: "Month only", blurb: "A month within a year." },
  { key: "year", label: "Year only", blurb: "A four-digit year." },
  { key: "boolean", label: "Yes / No", blurb: "A single switch." },
] as const;

export type DetailType = (typeof DETAIL_TYPES)[number]["key"];

/** Types whose answer is chosen from `options`. */
export const OPTION_TYPES: DetailType[] = ["radio", "checkbox", "dropdown"];
/** Types `min`/`max` mean something for. */
export const RANGED_TYPES: DetailType[] = ["numeric", "currency", "text", "textarea"];

/** Where a field is asked. A lender may collect internally without asking the customer. */
export const DETAIL_CHANNELS = [
  { key: "console", label: "Console", blurb: "Your staff, at the counter." },
  { key: "portal", label: "Customer app", blurb: "The borrower fills it in themselves." },
  { key: "ussd", label: "USSD", blurb: "Feature-phone flows. Keep these short." },
] as const;

export type DetailChannel = (typeof DETAIL_CHANNELS)[number]["key"];

export type DetailItem = {
  /** Stable key the captured VALUE is stored under. Never changes with the title. */
  code: string;
  title: string;
  description: string;
  type: DetailType;
  /** For radio / checkbox / dropdown. */
  options: string[];
  required: boolean;
  /** Numeric bounds, or text length bounds. Null = unbounded. */
  min: number | null;
  max: number | null;
  /** A regular expression the answer must match. Empty = no pattern. */
  pattern: string;
  /** Ghost text in the input. */
  placeholder: string;
  channels: DetailChannel[];
  active: boolean;
};

export type DetailGroup = {
  code: string;
  title: string;
  /** ServiceSuite's abbreviation column — the tag under the title in lists. */
  shortCode: string;
  description: string;
  scope: DetailScope;
  active: boolean;
  items: DetailItem[];
};

export type DetailsConfig = { groups: DetailGroup[] };

/**
 * Nothing ships enabled. A lender's additional details are, by definition, the ones
 * we did not anticipate — inventing three for them would only be three fields every
 * tenant has to switch off. The Business Details group exists switched ON because it
 * is the one the reference tenant actually runs, and it doubles as the worked example
 * an admin copies.
 */
export const DETAILS_DEFAULTS: DetailsConfig = {
  groups: [
    {
      code: "BUSINESS_DETAILS",
      title: "Business details",
      shortCode: "BD",
      description: "What the customer does, and where they do it.",
      scope: "borrower",
      active: true,
      items: [
        {
          code: "BUSINESS_NAME", title: "Business name", description: "The trading name, as the customer gives it.",
          type: "text", options: [], required: true, min: 2, max: 80, pattern: "", placeholder: "",
          channels: ["console", "portal"], active: true,
        },
        {
          code: "BUSINESS_LOCATION", title: "Business location", description: "Town, estate or market.",
          type: "text", options: [], required: true, min: 2, max: 80, pattern: "", placeholder: "",
          channels: ["console", "portal"], active: true,
        },
        {
          code: "LANDMARK", title: "Landmark", description: "What a field officer would look for.",
          type: "text", options: [], required: false, min: null, max: 120, pattern: "", placeholder: "",
          channels: ["console", "portal"], active: true,
        },
      ],
    },
  ],
};

// ── Merge ─────────────────────────────────────────────────────────────────────

const str = (v: unknown, fallback = "") => (typeof v === "string" ? v : fallback);
const code = (v: unknown, fallback = "") =>
  str(v, fallback).toUpperCase().replace(/[^A-Z0-9_]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "").slice(0, 40);

function num(v: unknown): number | null {
  const n = Number(v);
  return v === null || v === undefined || v === "" || !Number.isFinite(n) ? null : n;
}

function mergeItem(raw: unknown): DetailItem | null {
  const o = (typeof raw === "object" && raw ? raw : {}) as Record<string, unknown>;
  const title = str(o.title).trim().slice(0, 80);
  const c = code(o.code) || code(title);
  if (!c) return null;

  const type = DETAIL_TYPES.some((t) => t.key === o.type) ? (o.type as DetailType) : "text";
  const channels: DetailChannel[] = Array.isArray(o.channels)
    ? (o.channels.filter((x) => DETAIL_CHANNELS.some((d) => d.key === x)) as DetailChannel[])
    : ["console"];

  return {
    code: c,
    title: title || c,
    description: str(o.description).slice(0, 240),
    type,
    // Options are meaningless off a choice field, and carrying them forward is how a
    // field that was once a dropdown keeps a stale list nobody can see to remove.
    options: OPTION_TYPES.includes(type) && Array.isArray(o.options)
      ? [...new Set(o.options.map((x) => String(x).trim()).filter(Boolean))].slice(0, 60)
      : [],
    required: Boolean(o.required),
    min: RANGED_TYPES.includes(type) ? num(o.min) : null,
    max: RANGED_TYPES.includes(type) ? num(o.max) : null,
    pattern: str(o.pattern).slice(0, 200),
    placeholder: str(o.placeholder).slice(0, 80),
    channels: channels.length ? channels : ["console"],
    active: o.active === undefined ? true : Boolean(o.active),
  };
}

function mergeGroup(raw: unknown): DetailGroup | null {
  const o = (typeof raw === "object" && raw ? raw : {}) as Record<string, unknown>;
  const title = str(o.title).trim().slice(0, 80);
  const c = code(o.code) || code(title);
  if (!c) return null;

  const seen = new Set<string>();
  const items: DetailItem[] = [];
  for (const r of Array.isArray(o.items) ? o.items : []) {
    const it = mergeItem(r);
    if (!it || seen.has(it.code)) continue;
    seen.add(it.code);
    items.push(it);
  }

  return {
    code: c,
    title: title || c,
    shortCode: str(o.shortCode, c.slice(0, 3)).toUpperCase().slice(0, 8),
    description: str(o.description).slice(0, 240),
    scope: DETAIL_SCOPES.some((s) => s.key === o.scope) ? (o.scope as DetailScope) : "borrower",
    active: o.active === undefined ? true : Boolean(o.active),
    items,
  };
}

/**
 * Fill a stored document forward. Unlike attachments there are no platform rows to
 * re-append: these fields are the lender's own, and an empty document is a valid,
 * complete answer — this lender asks for nothing extra.
 */
export function mergeDetailsConfig(stored: unknown): DetailsConfig {
  if (stored === undefined || stored === null) {
    return { groups: DETAILS_DEFAULTS.groups.map((g) => ({ ...g, items: g.items.map((i) => ({ ...i })) })) };
  }
  const s = (typeof stored === "object" ? stored : {}) as Record<string, unknown>;
  const seen = new Set<string>();
  const groups: DetailGroup[] = [];
  for (const r of Array.isArray(s.groups) ? s.groups : []) {
    const g = mergeGroup(r);
    if (!g || seen.has(g.code)) continue;
    seen.add(g.code);
    groups.push(g);
  }
  return { groups };
}

export function validateDetailsConfig(cfg: DetailsConfig): ConfigIssue[] {
  const out: ConfigIssue[] = [];
  const groupCodes = new Set<string>();

  cfg.groups.forEach((g, gi) => {
    if (g.title.trim().length < 2) out.push({ path: `groups.${gi}.title`, message: "Give the group a title." });
    if (groupCodes.has(g.code)) out.push({ path: `groups.${gi}.code`, message: `Two groups share the key ${g.code}.` });
    groupCodes.add(g.code);

    const itemCodes = new Set<string>();
    g.items.forEach((i, ii) => {
      const at = `groups.${gi}.items.${ii}`;
      if (i.title.trim().length < 2) out.push({ path: `${at}.title`, message: "Give the field a title." });
      if (itemCodes.has(i.code)) {
        out.push({ path: `${at}.code`, message: `${g.title}: two fields share the key ${i.code}.` });
      }
      itemCodes.add(i.code);

      if (OPTION_TYPES.includes(i.type) && i.options.length < 2) {
        out.push({ path: `${at}.options`, message: `${i.title}: a choice field needs at least two options.` });
      }
      if (i.min !== null && i.max !== null && i.min > i.max) {
        out.push({ path: `${at}.min`, message: `${i.title}: the minimum is above the maximum.` });
      }
      if (i.pattern) {
        try { new RegExp(i.pattern); }
        catch { out.push({ path: `${at}.pattern`, message: `${i.title}: that is not a valid pattern.` }); }
      }
      // A required field nobody can see is a loan that can never be submitted.
      if (i.required && i.active && i.channels.length === 0) {
        out.push({ path: `${at}.channels`, message: `${i.title} is required but is not asked anywhere.` });
      }
    });
  });

  return out;
}

// ── Readers ───────────────────────────────────────────────────────────────────

/** Live groups for one record kind, optionally narrowed to one channel. */
export function groupsFor(cfg: DetailsConfig, scope: DetailScope, channel?: DetailChannel): DetailGroup[] {
  return cfg.groups
    .filter((g) => g.active && g.scope === scope)
    .map((g) => ({
      ...g,
      items: g.items.filter((i) => i.active && (!channel || i.channels.includes(channel))),
    }))
    .filter((g) => g.items.length > 0);
}

/** Captured values, keyed by item code. What lives in `Borrower.details`. */
export type DetailValues = Record<string, string | number | boolean | string[] | null>;

/**
 * Check submitted values against the live definition.
 *
 * Returns issues addressed by item code, so a form can put each message under the
 * field that earned it. Unknown keys are ignored rather than rejected: a value
 * captured under a field the lender has since removed is history, not an error.
 */
export function validateDetailValues(
  groups: DetailGroup[],
  values: DetailValues,
): ConfigIssue[] {
  const out: ConfigIssue[] = [];
  for (const g of groups) {
    for (const i of g.items) {
      const v = values[i.code];
      const empty = v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);

      if (empty) {
        if (i.required) out.push({ path: i.code, message: `${i.title} is required.` });
        continue;
      }

      if (OPTION_TYPES.includes(i.type)) {
        const picked = Array.isArray(v) ? v.map(String) : [String(v)];
        if (i.type !== "checkbox" && picked.length > 1) {
          out.push({ path: i.code, message: `${i.title}: choose one.` });
        }
        for (const p of picked) {
          if (!i.options.includes(p)) out.push({ path: i.code, message: `${i.title}: "${p}" is not one of the options.` });
        }
        continue;
      }

      if (i.type === "numeric" || i.type === "currency") {
        const n = Number(v);
        if (!Number.isFinite(n)) { out.push({ path: i.code, message: `${i.title} must be a number.` }); continue; }
        if (i.min !== null && n < i.min) out.push({ path: i.code, message: `${i.title} must be at least ${i.min}.` });
        if (i.max !== null && n > i.max) out.push({ path: i.code, message: `${i.title} must be at most ${i.max}.` });
        continue;
      }

      const s = String(v);
      if (i.type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) {
        out.push({ path: i.code, message: `${i.title} must be an email address.` });
      }
      if (i.type === "tel" && s.replace(/\D/g, "").length < 9) {
        out.push({ path: i.code, message: `${i.title} must be a phone number.` });
      }
      if (i.min !== null && s.length < i.min) out.push({ path: i.code, message: `${i.title} must be at least ${i.min} characters.` });
      if (i.max !== null && s.length > i.max) out.push({ path: i.code, message: `${i.title} must be at most ${i.max} characters.` });
      if (i.pattern) {
        let re: RegExp | null = null;
        try { re = new RegExp(i.pattern); } catch { re = null; }
        if (re && !re.test(s)) out.push({ path: i.code, message: `${i.title} is not in the expected format.` });
      }
    }
  }
  return out;
}
