// Tests for the realm registry — which BOOK a manager is standing in.
//
//   npm run test:realms      (pure — no database, no cookies, no browser)
//
// The danger under test is quiet and expensive: a manager who believes they are
// in one entity while the console reads the other. connections.ts records that
// 13 phone numbers exist in BOTH Micromart books belonging to DIFFERENT people,
// so a realm that resolves wrong does not throw — it hands back a stranger's
// loan history and looks entirely normal doing it.
//
// So the assertions here are about REFUSAL as much as resolution: an unknown
// slug gets nothing, a tampered cookie gets the default rather than a guess,
// and a lender with one book gets an empty list rather than a list of one.
import {
  REALMS, realmsFor, defaultRealm, findRealm, brandFor, type Realm,
} from "@/lib/suite/realms";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, extra = "") => {
  if (cond) { pass++; console.log(`  PASS  ${name}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.log(`  FAIL  ${name}${extra ? ` — ${extra}` : ""}`); }
};

// The org brand the fintech realm inherits. Values are arbitrary — what matters
// is that they come out the other side untouched.
const ORG = { accent: "#4E4442", accentSoft: "rgba(78,68,66,0.12)", accent2: "#2E2725" };

// ── Contrast, the same way a browser computes it ─────────────────────────────
const relLum = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const contrastOnWhite = (hex: string) => (1.05) / (relLum(hex) + 0.05);

console.log("1. Micromart has two books, and they are the two real entities");
const mm = realmsFor("micromart");
ok("two realms", mm.length === 2, String(mm.length));
ok("SME is entity 3002", mm.find((r) => r.id === "sme")?.entityId === 3002);
ok("Fintech is entity 3005", mm.find((r) => r.id === "fintech")?.entityId === 3005);
ok("the two entity ids are distinct", new Set(mm.map((r) => r.entityId)).size === 2);
ok("each realm names a configured connection", mm.every((r) => !!r.connection));

console.log("\n2. A lender with one book has no switch");
ok("unknown slug → no realms", realmsFor("nobody").length === 0);
ok("a single-book lender has no realms", realmsFor("buysimu").length === 0);
ok("empty slug → no realms", realmsFor("").length === 0);
ok("null slug → no realms", realmsFor(null).length === 0);
ok("no org declares exactly one realm", Object.values(REALMS).every((l: Realm[]) => l.length !== 1));

console.log("\n2b. Axe has two books too — Boresha 3003, Stawi 3004");
const ax = realmsFor("axe");
ok("two realms", ax.length === 2, String(ax.length));
ok("Boresha is entity 3003", ax.find((r) => r.id === "boresha")?.entityId === 3003);
ok("Stawi is entity 3004", ax.find((r) => r.id === "stawi")?.entityId === 3004);
// The safety property. A live read found an EntityId 3003 on MICROMART's server
// too, holding a different book entirely. Axe must never be pointed at it.
ok("both read through Axe's OWN connection, never Micromart's", ax.every((r) => r.connection === "axe"));
ok("Axe's two accents differ", ax[0].brand?.accent !== ax[1].brand?.accent);
for (const r of ax) {
  ok(`${r.label} accent carries white text (AA)`, contrastOnWhite(r.brand!.accent) >= 4.5, `${contrastOnWhite(r.brand!.accent).toFixed(2)}:1`);
}

console.log("\n3. Exactly one default, and it is the book the console already wears");
ok("micromart has exactly one default", mm.filter((r) => r.isDefault).length === 1);
ok("the default is fintech", defaultRealm("micromart")?.id === "fintech");
ok("fintech inherits the org brand (nothing changes until you press it)", defaultRealm("micromart")?.brand === null);
ok("a lender with no realms has no default", defaultRealm("buysimu") === null);
for (const [slug, list] of Object.entries(REALMS)) {
  ok(`${slug}: at most one default`, list.filter((r) => r.isDefault).length <= 1);
  ok(`${slug}: realm ids are unique`, new Set(list.map((r) => r.id)).size === list.length);
}

console.log("\n4. An untrusted realm id can only ever select something declared");
ok("a good id resolves to itself", findRealm("micromart", "sme")?.id === "sme");
ok("a tampered id falls back to the default", findRealm("micromart", "../../etc/passwd")?.id === "fintech");
ok("an empty id falls back to the default", findRealm("micromart", "")?.id === "fintech");
ok("a null id falls back to the default", findRealm("micromart", null)?.id === "fintech");
ok("no realm can be conjured for a single-book lender", findRealm("buysimu", "sme") === null);
// The property that actually matters: whatever comes back is ON the list.
for (const probe of ["sme", "fintech", "SME", "3002", "admin", "", "__proto__"]) {
  const r = findRealm("micromart", probe);
  ok(`"${probe}" resolves to a declared realm`, !!r && mm.some((m) => m.id === r.id), r?.id ?? "null");
}

console.log("\n5. Branding: two colours off one logo, both legible");
const sme = brandFor(mm.find((r) => r.id === "sme")!, ORG);
const fin = brandFor(mm.find((r) => r.id === "fintech")!, ORG);
ok("fintech wears the org's own accent, untouched", fin.accent === ORG.accent, fin.accent);
ok("fintech wears the org's own soft fill", fin.accentSoft === ORG.accentSoft);
ok("SME does NOT wear the org's accent", sme.accent !== ORG.accent, sme.accent);
ok("SME is the logo gold, darkened", sme.accent === "#8C6512");
ok("SME's gradient ends on the true logo gold", sme.accent2 === "#E6B617");
ok(
  `SME accent carries white text (AA)`,
  contrastOnWhite(sme.accent) >= 4.5,
  `${contrastOnWhite(sme.accent).toFixed(2)}:1`,
);
ok(
  `fintech accent carries white text (AA)`,
  contrastOnWhite(fin.accent) >= 4.5,
  `${contrastOnWhite(fin.accent).toFixed(2)}:1`,
);
// The whole point of the colour is telling the two books apart at a glance.
ok(
  "the two accents are far apart, not two shades of one",
  Math.abs(relLum(sme.accent) - relLum(fin.accent)) > 0.03,
  `Δlum ${Math.abs(relLum(sme.accent) - relLum(fin.accent)).toFixed(3)}`,
);

console.log("\n6. A realm with no palette falls back cleanly");
const noAccent2 = brandFor(null, { accent: "#123456", accentSoft: "rgba(0,0,0,0.1)", accent2: null });
ok("null realm → the org's brand", noAccent2.accent === "#123456");
ok("a missing accent2 doubles the accent, never renders empty", noAccent2.accent2 === "#123456");

console.log(`\n${fail === 0 ? "OK" : "FAILED"} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
