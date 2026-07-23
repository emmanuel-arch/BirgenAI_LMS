// Print a lender's Internal Report API key + a ready-to-run example.
//   npx tsx scripts/report-key.ts mular
import "dotenv/config";
import { issueReportKey } from "@/lib/api/keys";

const slug = process.argv[2]?.trim();
if (!slug) { console.error("Usage: npx tsx scripts/report-key.ts <org-slug>"); process.exit(1); }

const key = issueReportKey(slug);
const base = (process.env.PUBLIC_BASE_URL?.trim() || "https://lms.birgenai.com").replace(/\/$/, "");

console.log(`\nInternal Report API key for "${slug}":\n\n  ${key}\n`);
console.log("Try it:\n");
console.log(`  curl -X POST ${base}/api/v1/crunch \\`);
console.log(`    -H "x-api-key: ${key}" \\`);
console.log(`    -F "statement=@statement.pdf" \\`);
console.log(`    -F "password=0000"\n`);
console.log("Returns { success, orgSlug, report } — the full Internal Report JSON.");
if (!process.env.REPORT_API_SECRET) console.log("\n⚠  REPORT_API_SECRET is not set — this key uses the dev fallback secret. Set it in prod before sharing keys.");
