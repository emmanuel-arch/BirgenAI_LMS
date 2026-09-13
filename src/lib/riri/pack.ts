// ─────────────────────────────────────────────────────────────────────────────
// THE KNOWLEDGE PACK — the file a lender writes to train Riri on their own facts.
//
// This is the format that makes "put your model in my system and train it on my
// JSON" a product rather than a liability. One schema, validated at ingest, used by
// every surface. It replaces three dialects of the same idea that already exist:
// the Hub's `src/data/kb/*.json`, the C# `SsKbEntry`, and the body that
// `AiIntelligence/SeedLenderKnowledge` accepts.
//
// ── THE LINE THIS FILE ENFORCES ──────────────────────────────────────────────
//
//   A TENANT PACK MAY STATE A FACT ABOUT THE TENANT.
//   IT MAY NEVER STATE A FACT ABOUT THE SOFTWARE.
//
// That single rule is what lets us hand the training surface to somebody else. The
// worst failure an assistant can have is not being wrong — it is being wrong in the
// register of documentation: a confident six-step path to a button that does not
// exist, which the user cannot tell apart from a real one until they are standing
// on the wrong screen blaming the software. Our own corpus cannot do that, because
// knowledge.ts and system-map.ts are CODE: an `href` is verified against the real
// route table and a deleted screen fails the build.
//
// A tenant's JSON has none of that protection, and it never can — it is uploaded by
// somebody who does not know what our routes are and is not present when we change
// them. So the format simply does not have the vocabulary to describe our software:
// no `href`, no `right`, no `feature`, no relative URL, and text that reads as
// navigation is refused at ingest with a reason. A wrong tenant pack sends somebody
// to the wrong paragraph about the wrong fee. It cannot send them to a button.
//
// ── WHY EVERY ANSWER CARRIES THE PACK ID ─────────────────────────────────────
// Founder's decision, 11 Sep 2026: her voice is ours, the facts are theirs, and the
// pack id is on every answer. `sourceRef()` is that. When a lender says "Riri told
// my customer the wrong fee", the answer is a pack id, a version and a date they
// uploaded — not an argument about whose model said what.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Where an entry's authority comes from — and therefore what Riri may do with it.
 *
 *  platform — ours, written in code, compile-checked. The ONLY authority that may
 *             produce a navigation action, because it is the only one that knows
 *             what the routes are and fails the build when they change.
 *  tenant   — theirs, uploaded. Facts about their products, fees, policies, hours.
 *  document — a real document, chunked. May be QUOTED AND CITED, never paraphrased
 *             into a figure: "the agreement says Safaricom handles activation
 *             queries (§6.4)" is a good answer; "Safaricom will fix it in 24 hours"
 *             is not, and nothing in the document supports it.
 */
export type PackAuthority = "platform" | "tenant" | "document";

/** Who may retrieve an entry. A staff-only pack must never reach a borrower. */
export type PackAudience = "customer" | "staff" | "developer" | "internal";

export type PackLang = "en" | "sw";

export type PackEntry = {
  /** Free-form grouping, shown in the training console. */
  category: string;
  /** The canonical phrasing. */
  question: string;
  /** How real people ask it — including Kiswahili and Sheng. Embedded with the question. */
  variants?: string[];
  /** The answer, in the tenant's own words. */
  answer: string;
  /** EXTERNAL absolute URL only. See assertNoAppRoute. */
  url?: string;
  /** When this became true. A fee answer with no date is a fee answer nobody can audit. */
  effective_from?: string;
  /** When somebody must look at it again. Retrieval de-ranks an overdue entry. */
  review_by?: string;
};

export type Pack = {
  /** Stable id, `owner.topic`. Re-uploading replaces THIS pack and nothing else. */
  pack: string;
  /**
   * Who owns these facts.
   *
   * `KE/LENDER/<KRA PIN>` — never a bare EntityId. EntityId 3003 is "Micromart
   * Check-off" on one server and "Axe — Boresha" on the other; a corpus keyed on it
   * would let whichever registered first silently own the other's answers.
   * `platform` is reserved for our own packs.
   */
  owner: string;
  /** Monotonic. Shown on every answer this pack produces. */
  version: number;
  authority: PackAuthority;
  audience: PackAudience[];
  lang: PackLang;
  /** Human note — what this pack is for, who maintains it. */
  description?: string;
  /** Document packs only: what is being cited, so a quote can name its source. */
  source?: { title: string; issuer?: string; dated?: string; ref?: string };
  entries: PackEntry[];
};

// ── Limits ───────────────────────────────────────────────────────────────────
// Bounded because this is an upload surface. A pack that is too large to review is
// a pack nobody reviews, which defeats the point of versioning it.
const MAX_ENTRIES = 500;
const MAX_ANSWER = 4000;
const MAX_QUESTION = 300;
const MAX_VARIANTS = 25;

const OWNER_RE = /^(platform|KE\/LENDER\/[A-Z0-9]{9,15})$/;
const PACK_ID_RE = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Phrasings that mean "the software works like this".
 *
 * Matched against tenant answers only. The intent is not to police prose — it is
 * that these specific shapes are the ones a user READS AS AN INSTRUCTION and acts
 * on. A tenant who wants to say "call us on 0700…" is unaffected; a tenant who
 * writes "go to Settings → Vault and click Save" is describing a screen they do
 * not control and cannot keep true.
 */
const NAVIGATION_PHRASING: { re: RegExp; why: string }[] = [
  // The verb is matched in either case; the TARGET must be capitalised, because a
  // capital is what distinguishes "go to Settings" (a screen we own and rename)
  // from "go to your nearest branch" (a fact about them).
  { re: /\b(?:[Gg]o|[Hh]ead|[Nn]avigate|[Pp]roceed)\s+(?:to|over to)\s+(?:the\s+)?[A-Z]/,
    why: "tells the user to go to a named screen" },
  { re: /\b(?:[Cc]lick|[Tt]ap|[Pp]ress|[Hh]it)\s+(?:on\s+)?(?:the\s+)?["'A-Z]/,
    why: "tells the user to press a named control" },
  { re: /[A-Za-z]\s*(?:→|->|>)\s*[A-Z]/,
    why: "uses a menu path (Settings → Vault)" },
  { re: /\b(?:open|select|choose)\s+(?:the\s+)?[A-Z][A-Za-z ]{2,}\s+(?:screen|page|tab|menu|button|module)\b/i,
    why: "names a screen, page or tab of the software" },
  { re: /\bin\s+(?:the\s+)?(?:console|portal|dashboard|app)\b.{0,40}\b(?:click|tap|go to|open|select)\b/i,
    why: "describes a sequence of actions inside the software" },
];

/**
 * Rails that are NOT ours, where step-by-step instructions are legitimate and often
 * the most useful thing a lender can write.
 *
 * "Dial *334# and choose Ratiba" is a tenant telling a customer how to use
 * Safaricom's menu. It is a real instruction about a real system, it does not change
 * when we ship, and refusing it would gut the single most valuable customer answer
 * we have. The rule exists to stop a tenant describing OUR screens — not every
 * screen in Kenya.
 */
const EXTERNAL_RAIL =
  /\b(?:m-?pesa|safaricom|ratiba|fuliza|sim ?toolkit|ussd|paybill|till|airtel|equity|co-?op|bank app|whatsapp)\b|\*\d{3,}#/i;

/**
 * …and the exemption's own limit.
 *
 * "Use Settings → Vault to connect M-Pesa" mentions an external rail and is still a
 * sentence about OUR screen — the rail is what the screen is for, not what the
 * instruction operates. So naming one of our surfaces, or using menu-path notation,
 * voids the exemption. Without this the rule is trivially bypassed by adding the
 * word "M-Pesa" to any walkthrough, which is exactly what a lender documenting an
 * integration would naturally do.
 */
const OUR_SURFACE =
  /(?:→|->)|\b(?:console|portal|dashboard|Settings|Vault|Micro ?Eazy|ServiceSuite|our (?:app|system|platform))\b/i;

/** The sentence a match landed in — the right unit for "is this about their rail or ours?". */
function sentenceAround(text: string, index: number): string {
  const start = Math.max(0, text.lastIndexOf(".", index - 1) + 1);
  const dot = text.indexOf(".", index);
  return text.slice(start, dot === -1 ? text.length : dot + 1);
}

export type PackIssue = {
  /** Where — `entries[3].answer`, or `owner`. */
  at: string;
  message: string;
  /** `error` refuses the pack. `warning` ingests it and flags it in the console. */
  level: "error" | "warning";
};

export type PackValidation =
  | { ok: true; pack: Pack; warnings: PackIssue[] }
  | { ok: false; issues: PackIssue[] };

const isStr = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;

/**
 * Validate an uploaded pack.
 *
 * Returns EVERY problem rather than the first, because the caller is a person
 * editing a JSON file and a validator that reveals one error per round-trip is a
 * validator people stop using. Errors refuse the pack; warnings let it through and
 * surface in the training console.
 */
export function validatePack(input: unknown): PackValidation {
  const issues: PackIssue[] = [];
  const err = (at: string, message: string) => issues.push({ at, message, level: "error" });
  const warn = (at: string, message: string) => issues.push({ at, message, level: "warning" });

  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false, issues: [{ at: "", message: "A pack must be a JSON object.", level: "error" }] };
  }
  const p = input as Record<string, unknown>;

  // ── Identity ───────────────────────────────────────────────────────────────
  if (!isStr(p.pack)) err("pack", "Missing `pack` — the stable id, e.g. \"micromart.products\".");
  else if (!PACK_ID_RE.test(p.pack)) err("pack", "`pack` must be lowercase letters, digits, dots and hyphens, e.g. \"micromart.products\".");

  if (!isStr(p.owner)) err("owner", "Missing `owner`.");
  else if (!OWNER_RE.test(p.owner))
    err("owner",
      "`owner` must be \"KE/LENDER/<KRA PIN>\" or \"platform\". A bare EntityId is not accepted — " +
      "the same EntityId names different lenders on different servers.");

  if (typeof p.version !== "number" || !Number.isInteger(p.version) || p.version < 1)
    err("version", "`version` must be a whole number, 1 or greater. It appears on every answer this pack produces.");

  const authority = p.authority;
  if (authority !== "platform" && authority !== "tenant" && authority !== "document")
    err("authority", "`authority` must be \"tenant\", \"document\" or \"platform\".");

  if (p.lang !== "en" && p.lang !== "sw")
    err("lang", "`lang` must be \"en\" or \"sw\".");

  // ── Audience ───────────────────────────────────────────────────────────────
  const allowed: PackAudience[] = ["customer", "staff", "developer", "internal"];
  if (!Array.isArray(p.audience) || p.audience.length === 0) {
    err("audience", "`audience` must list at least one of: customer, staff, developer, internal.");
  } else {
    for (const [i, a] of p.audience.entries())
      if (!allowed.includes(a as PackAudience)) err(`audience[${i}]`, `Unknown audience "${String(a)}".`);
    if ((p.audience as string[]).includes("internal") && (p.audience as string[]).includes("customer"))
      err("audience", "A pack cannot be both `internal` and `customer`. Internal content must never reach a borrower.");
  }

  // Only WE may write platform authority. It is the authority that can navigate.
  if (authority === "platform" && p.owner !== "platform")
    err("authority",
      "Only `owner: \"platform\"` may use `authority: \"platform\"`. Platform authority is the only one " +
      "permitted to produce a navigation action, and it lives in code, not in an upload.");

  if (authority === "document" && (typeof p.source !== "object" || p.source === null))
    err("source", "A document pack must declare `source` — at minimum a `title`, so a quote can name what it is quoting.");

  // ── Entries ────────────────────────────────────────────────────────────────
  if (!Array.isArray(p.entries) || p.entries.length === 0) {
    err("entries", "A pack must contain at least one entry.");
  } else if (p.entries.length > MAX_ENTRIES) {
    err("entries", `A pack may hold at most ${MAX_ENTRIES} entries. Split it into several packs by topic.`);
  } else {
    const seen = new Map<string, number>();

    p.entries.forEach((raw, i) => {
      const at = `entries[${i}]`;
      if (typeof raw !== "object" || raw === null) { err(at, "Each entry must be an object."); return; }
      const e = raw as Record<string, unknown>;

      if (!isStr(e.question)) err(`${at}.question`, "Missing `question`.");
      else if (e.question.length > MAX_QUESTION) err(`${at}.question`, `\`question\` is longer than ${MAX_QUESTION} characters.`);

      if (!isStr(e.answer)) err(`${at}.answer`, "Missing `answer`.");
      else if (e.answer.length > MAX_ANSWER) err(`${at}.answer`, `\`answer\` is longer than ${MAX_ANSWER} characters. Split it into several entries.`);

      if (!isStr(e.category)) warn(`${at}.category`, "No `category` — it will be filed as \"general\".");

      if (e.variants !== undefined) {
        if (!Array.isArray(e.variants)) err(`${at}.variants`, "`variants` must be a list of strings.");
        else if (e.variants.length > MAX_VARIANTS) err(`${at}.variants`, `At most ${MAX_VARIANTS} variants.`);
      }

      // Duplicate questions inside one pack make retrieval arbitrary between them.
      if (isStr(e.question)) {
        const key = e.question.trim().toLowerCase();
        const first = seen.get(key);
        if (first !== undefined) err(`${at}.question`, `Duplicates entries[${first}].question. Merge them or change one.`);
        else seen.set(key, i);
      }

      // ── THE RULE ────────────────────────────────────────────────────────────
      if (authority === "tenant") {
        if (isStr(e.url)) {
          const bad = appRouteProblem(e.url);
          if (bad) err(`${at}.url`, bad);
        }
        if (isStr(e.answer)) {
          const answer = e.answer;
          for (const nav of NAVIGATION_PHRASING) {
            const m = nav.re.exec(answer);
            if (!m) continue;
            // Instructions about somebody else's rail are fine — see EXTERNAL_RAIL —
            // unless the same sentence is also steering them around one of our screens.
            const sentence = sentenceAround(answer, m.index);
            if (EXTERNAL_RAIL.test(sentence) && !OUR_SURFACE.test(sentence)) continue;
            err(`${at}.answer`,
              `This ${nav.why}. A tenant pack may state facts about you — products, fees, hours, policy — ` +
              `but not about how the software works: those screens change without you, and an instruction ` +
              `that has gone stale is indistinguishable from a real one. Describe the outcome instead. ` +
              `(Steps for an external rail like M-Pesa or a USSD code are fine.)`);
            break;
          }
        }
      }

      for (const field of ["effective_from", "review_by"] as const) {
        const v = e[field];
        if (v === undefined) continue;
        if (!isStr(v) || !ISO_DATE_RE.test(v)) err(`${at}.${field}`, `\`${field}\` must be a date as YYYY-MM-DD.`);
      }
      if (isStr(e.effective_from) && isStr(e.review_by) && ISO_DATE_RE.test(e.effective_from) && ISO_DATE_RE.test(e.review_by)
          && e.review_by < e.effective_from)
        err(`${at}.review_by`, "`review_by` is before `effective_from`.");

      // Money without a date is the entry most likely to go quietly wrong.
      if (isStr(e.answer) && /\b(?:KES|Ksh|shillings?)\b|\b\d+(?:\.\d+)?\s*%/i.test(e.answer) && !isStr(e.review_by))
        warn(`${at}.review_by`,
          "This entry quotes a figure but has no `review_by`. Fees and rates change; an unreviewed figure is a wrong figure waiting to happen.");
    });
  }

  const errors = issues.filter((i) => i.level === "error");
  if (errors.length) return { ok: false, issues };

  return { ok: true, pack: input as Pack, warnings: issues };
}

/**
 * Why this URL cannot be in a tenant pack, or null if it is fine.
 *
 * Relative URLs are the whole point: `/console/settings/vault` in a tenant's pack
 * is them asserting the shape of our product. It may be right today. It is not
 * theirs to keep true, and when it breaks the user blames the software.
 */
export function appRouteProblem(url: string): string | null {
  const u = url.trim();
  if (u.startsWith("/") || u.startsWith("./") || u.startsWith("../"))
    return "A tenant pack may only link to an absolute external URL (https://…). " +
           "In-app destinations come from the system map, which is verified against the real routes.";
  if (/^[a-z][a-z0-9+.-]*:/i.test(u)) {
    if (!/^https?:\/\//i.test(u)) return "Only http(s) links are accepted.";
    return null;
  }
  return "Links must be absolute and include https://.";
}

/**
 * What goes on the answer. Founder's decision: the facts are theirs, and they are
 * named — so an answer sourced from a tenant pack can always be traced back to the
 * exact upload that produced it.
 */
export type SourceRef = { pack: string; version: number; authority: PackAuthority; owner: string };

export const sourceRef = (p: Pack): SourceRef =>
  ({ pack: p.pack, version: p.version, authority: p.authority, owner: p.owner });

/**
 * The text that is embedded for retrieval — question, variants and answer together.
 *
 * Shared by every seeder so a pack retrieves identically wherever it was ingested
 * from. This is the same composition the Hub's seeder and the C# seeder each
 * implemented separately; having it in one place is the point.
 */
export const embeddableText = (e: PackEntry): string =>
  [e.question, ...(e.variants ?? []), e.answer].filter(Boolean).join(" ");
