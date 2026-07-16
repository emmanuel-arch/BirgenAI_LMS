// ─────────────────────────────────────────────────────────────────────────────
// IPRS — Kenya's national population registry, via Spinmobile.
//
// SIMULATION-FIRST like every credentialed provider here (kycMode, crbMode,
// storageMode): `iprsMode()` flips to live the moment the three IPRS_* env vars
// exist, and every caller falls back to the seeded simulation on ANY failure —
// a registry outage must degrade a lookup, never kill an onboarding.
//
// The wire protocol (docs.spinmobile.co, decoded July 2026):
//   POST {base}/analytics/auth/            {consumer_key, consumer_secret}
//     → {token, expires}                   (expires = epoch seconds)
//   POST {base}/analytics/account/iprs     Authorization: Bearer <token>
//     {search_type:"identity", identifier:<id no>, consent:"1",
//      consent_collected_by:<who took consent>}
//     → {code, message, data:{id_number, surname, first_name, other_name,
//        gender, date_of_birth, citizenship, serial_number, place_of_birth,
//        place_of_live, clan, ethnic_group, family, photo, signature, ...}}
//
// TWO RULES CALLERS MUST HONOUR:
//   • CONSENT IS NOT A FORM FIELD. A lookup names the human who collected the
//     customer's consent (consent_collected_by) — pass the staff member's name,
//     never a system string. The route layer enforces a ticked consent.
//   • EVERY LOOKUP COSTS MONEY. Spinmobile bills per call, so lookups are
//     rate-limited at the route and never fired speculatively.
//
// The token is cached on globalThis (NOT module scope — Next compiles each route
// into its own bundle and a module-level cache silently becomes one-per-bundle;
// the entitlements cache taught us that the hard way).
// ─────────────────────────────────────────────────────────────────────────────

export type IprsMode = "live" | "simulation";

export type IprsPerson = {
  idNumber: string | null;
  firstName: string | null;
  otherName: string | null;
  surname: string | null;
  fullName: string | null;
  gender: string | null;       // "Male" | "Female" as the registry spells it
  dob: string | null;          // as returned (registry format varies; shown, not parsed)
  citizenship: string | null;
  serialNumber: string | null;
  placeOfBirth: string | null;
  placeOfLive: string | null;
  /** The live registry (SHA-era dataset) also knows how to reach them. */
  phone: string | null;
  email: string | null;
  /** Registry portrait, when the bureau returns one (base64/bytes). */
  photo: string | null;
};

export type IprsLookupResult =
  | { ok: true; mode: "live"; person: IprsPerson }
  | { ok: false; mode: "live"; error: string; notFound?: boolean }
  | { ok: false; mode: "simulation"; error: string };

function cfg() {
  const baseUrl = (process.env.IPRS_BASE_URL ?? "").trim().replace(/\/+$/, "");
  const key = (process.env.IPRS_CONSUMER_KEY ?? "").trim();
  const secret = (process.env.IPRS_CONSUMER_SECRET ?? "").trim();
  return baseUrl && key && secret ? { baseUrl, key, secret } : null;
}

export function iprsMode(): IprsMode {
  return cfg() ? "live" : "simulation";
}

// Token cache — one per process, refreshed 60s before the registry says it dies.
type TokenCache = { token: string; expiresAtMs: number };
const g = globalThis as unknown as { __iprsToken?: TokenCache };

async function spinToken(): Promise<string> {
  const c = cfg();
  if (!c) throw new Error("IPRS credentials not configured");

  const cached = g.__iprsToken;
  if (cached && cached.expiresAtMs - 60_000 > Date.now()) return cached.token;

  const res = await fetch(`${c.baseUrl}/analytics/auth/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ consumer_key: c.key, consumer_secret: c.secret }),
    signal: AbortSignal.timeout(Number(process.env.IPRS_TIMEOUT_SEC ?? 30) * 1000),
  });
  if (!res.ok) throw new Error(`IPRS auth failed (HTTP ${res.status})`);
  const data = (await res.json()) as { token?: string; expires?: string };
  if (!data.token) throw new Error("IPRS auth returned no token");

  // `expires` is epoch seconds; a missing/garbled value gets a conservative 10 min.
  const expires = Number(data.expires);
  const expiresAtMs = Number.isFinite(expires) && expires > 1_000_000_000 ? expires * 1000 : Date.now() + 600_000;
  g.__iprsToken = { token: data.token, expiresAtMs };
  return data.token;
}

// The wire shape drifted from the July-2026 docs: live lookups return the person
// under `response` (not `data`) with first/middle/last_name (not surname/other_name),
// plus contact + residence fields the docs never mentioned. Decoded from a real
// lookup on 2026-07-13; both spellings are accepted so a rollback on their side
// doesn't break us.
type SpinIprsData = {
  id_number?: string; surname?: string; first_name?: string; other_name?: string;
  middle_name?: string; last_name?: string; identification_number?: string;
  gender?: string; date_of_birth?: string; citizenship?: string; serial_number?: string;
  id_serial?: string; place_of_birth?: string; place_of_live?: string; photo?: string | null;
  phone?: string; email?: string;
  county?: string; sub_county?: string; ward?: string; village_estate?: string;
};

const s = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/** "NAIROBI / EMBAKASI EAST / EMBAKASI / Caltex-Donholm" → a residence line an officer can read. */
function residenceOf(d: SpinIprsData): string | null {
  const title = (v: string | null) =>
    v && v === v.toUpperCase() ? v.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()) : v;
  const parts = [s(d.village_estate), title(s(d.ward)), title(s(d.sub_county)), title(s(d.county))].filter(Boolean);
  // De-duplicate adjacent repeats (ward and sub-county are often the same word).
  const seen = new Set<string>();
  const out = parts.filter((p) => { const k = p!.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
  return out.length ? out.join(", ") : null;
}

/**
 * Look a person up in the registry by national ID. `consentCollectedBy` is the
 * staff member (or "borrower — portal") who took the customer's consent — it goes
 * on the wire and is the compliance record Spinmobile keeps on their side too.
 */
export async function spinIprsIdentity(nationalId: string, consentCollectedBy: string): Promise<IprsLookupResult> {
  const c = cfg();
  if (!c) return { ok: false, mode: "simulation", error: "IPRS credentials not configured" };

  const identifier = nationalId.replace(/\D/g, "");
  if (identifier.length < 6) return { ok: false, mode: "live", error: "ID number too short for a registry lookup.", notFound: true };

  try {
    const token = await spinToken();
    const res = await fetch(`${c.baseUrl}/analytics/account/iprs`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        search_type: "identity",
        identifier,
        consent: "1",
        consent_collected_by: consentCollectedBy.slice(0, 80),
      }),
      signal: AbortSignal.timeout(Number(process.env.IPRS_TIMEOUT_SEC ?? 30) * 1000),
    });

    // A stale token can slip the 60s margin — one retry with a fresh one.
    if (res.status === 401 || res.status === 403) {
      g.__iprsToken = undefined;
      return spinIprsIdentity(nationalId, consentCollectedBy);
    }
    if (!res.ok) return { ok: false, mode: "live", error: `Registry returned HTTP ${res.status}.` };

    const body = (await res.json().catch(() => ({}))) as {
      code?: unknown; message?: string; data?: SpinIprsData | null; response?: SpinIprsData | null;
    };
    const d = body.response ?? body.data;
    if (!d || (!d.first_name && !d.surname && !d.last_name && !d.id_number && !d.identification_number)) {
      return { ok: false, mode: "live", error: body.message || "No record found for that ID number.", notFound: true };
    }

    const firstName = s(d.first_name);
    const otherName = s(d.other_name) ?? s(d.middle_name);
    const surname = s(d.surname) ?? s(d.last_name);
    return {
      ok: true,
      mode: "live",
      person: {
        idNumber: s(d.id_number) ?? s(d.identification_number) ?? identifier,
        firstName, otherName, surname,
        fullName: [firstName, otherName, surname].filter(Boolean).join(" ") || null,
        gender: s(d.gender),
        dob: s(d.date_of_birth),
        citizenship: s(d.citizenship),
        serialNumber: s(d.serial_number) ?? s(d.id_serial),
        placeOfBirth: s(d.place_of_birth),
        placeOfLive: s(d.place_of_live) ?? residenceOf(d),
        phone: s(d.phone),
        email: s(d.email),
        photo: s(d.photo),
      },
    };
  } catch (e) {
    return { ok: false, mode: "live", error: e instanceof Error ? e.message : "Registry lookup failed." };
  }
}
