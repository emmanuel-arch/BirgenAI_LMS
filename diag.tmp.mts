import * as dotenv from "dotenv";
dotenv.config();
import { getOrg } from "./src/lib/enterprise/connections";
import { runReadOnlyQueryDirect } from "./src/lib/enterprise/mssql";
const org = getOrg("micromart")!;
try {
  const r = await runReadOnlyQueryDirect(org,
    `SELECT c.name FROM sys.columns c WHERE c.object_id=OBJECT_ID('OrganizationUnits') ORDER BY c.column_id`, [], { timeoutMs: 20000 });
  console.log("OrganizationUnits columns:", r.rows.map((x) => x.name).join(", "));
} catch (e) { console.log("ERR", String((e as Error).message).slice(0,160)); }
try {
  const r2 = await runReadOnlyQueryDirect(org,
    `SELECT DISTINCT PaybillNumber FROM OrganizationUnits WHERE PaybillNumber IS NOT NULL AND PaybillNumber <> ''`, [], { timeoutMs: 20000 });
  console.log("paybills (all units):", r2.rows.map((x) => x.PaybillNumber).slice(0, 12).join(", "));
} catch (e) { console.log("ERR2", String((e as Error).message).slice(0,160)); }
