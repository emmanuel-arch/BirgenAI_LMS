import "dotenv/config";
import { getOrg } from "../src/lib/enterprise/connections";
import { micromartSavings, micromartScore } from "../src/lib/portal/micromart-standing";
import { readBookPosition } from "../src/lib/portal/micromart-book";
const t = async (l: string, f: () => Promise<unknown>) => { const s = Date.now(); let n = "";
  try { const r = await f(); n = r == null ? " (null)" : ""; } catch (e) { n = " THREW " + (e as Error).message; }
  console.log(`${String(Date.now()-s).padStart(7)} ms  ${l}${n}`); };
(async () => {
  const org = getOrg("micromart-fintech")!;
  const ID = 170497, ENT = 3005;
  console.log("\n— cold, one at a time —");
  await t("readBookPosition", () => readBookPosition(org, ENT, ID));
  await t("micromartSavings", () => micromartSavings(org, ID));
  await t("micromartScore  ", () => micromartScore(org, ENT, ID));
  console.log("\n— warm, same three —");
  await t("readBookPosition", () => readBookPosition(org, ENT, ID));
  await t("micromartSavings", () => micromartSavings(org, ID));
  await t("micromartScore  ", () => micromartScore(org, ENT, ID));
  console.log();
})().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
