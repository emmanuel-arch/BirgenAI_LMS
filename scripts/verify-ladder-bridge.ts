// Exercise the bridged ladder end to end against Micromart's live book, the way
// /api/portal/ladder will call it.
import "dotenv/config";
import { getOrg } from "../src/lib/enterprise/connections";
import { micromartLadder, provenPrincipalFor } from "../src/lib/portal/micromart-ladder";

const org = getOrg("micromart")!;
const money = (n: number) => "KSh " + n.toLocaleString(undefined, { maximumFractionDigits: 0 });

(async () => {
  // The inversion, checked against the procedure's own formula first.
  console.log("── provenPrincipalFor, against the formula ──");
  for (const [P, pct] of [[5000, 15], [5000, 30], [6000, 30], [40000, 30], [100000, 30]] as const) {
    const newLimit = P + Math.min((P * pct) / 100, 5000);
    const got = provenPrincipalFor(newLimit, pct);
    const ok = Math.abs(got.principal - P) < 0.01;
    console.log(`   P=${String(P).padStart(6)} pct=${pct}%  -> limit ${String(newLimit).padStart(7)}  recovered ${String(got.principal).padStart(8)} capped=${String(got.capped).padEnd(5)} ${ok ? "OK" : "*** WRONG ***"}`);
  }

  for (const b of [22, 18797, 1000]) {
    const r = await micromartLadder({ org, entityId: 3005, borrowerId: b, max: 24 });
    if (!r.ok) { console.log(`\nborrower ${b}: UNREACHABLE — ${r.message}`); continue; }
    const { rungs, current, rawRows } = r.ladder;
    console.log(`\n── borrower ${b} · ${rawRows} raw rows -> ${rungs.length} rungs ──`);
    console.log(`   now ${current.limit == null ? "—" : money(current.limit)} · band ${current.riskBand ?? "—"} · cleared ${current.clearedLoans} · active ${current.activeLoans}`);
    for (const g of rungs)
      console.log(`   ${g.at.slice(0,10)}  ${money(g.previousLimit).padStart(12)} -> ${money(g.newLimit).padStart(12)}  ${g.direction.padEnd(4)} ${String(g.graduationPercent ?? "-")}%  proven ${money(g.provenPrincipal)}${g.cappedByCeiling ? "  [capped]" : ""}`);
    const startedAt = rungs.length ? rungs[rungs.length - 1].previousLimit : null;
    const gained = current.limit == null || startedAt == null ? null : current.limit - startedAt;
    const oldSum = rungs.filter((g) => g.direction === "up").reduce((s, g) => s + g.change, 0);
    console.log(`   startedAt ${startedAt == null ? "—" : money(startedAt)} · totalGained ${gained == null ? "—" : money(gained)}   (old sum-of-ups would have said ${money(oldSum)})`);
    if (!rungs.length) console.log("   (no movements)");
  }
})().catch((e) => { console.error("FAILED:", e instanceof Error ? e.message : e); process.exit(1); });

