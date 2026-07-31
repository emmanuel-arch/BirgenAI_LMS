// ─────────────────────────────────────────────────────────────────────────────
// Every shipped template must publish cleanly once its deliberate blanks are
// filled. A template that cannot be published is worse than no template: it
// teaches a new lender that the validator is noise.
//
// Templates leave exactly one thing open — the approval workflows, which are
// per-org rows no shipped template can name (see templateBlanks). The check fills
// those with a stub and then holds the template to the FULL validator, so a
// template can never ship with an incoherent rate period, an uncapped recurring
// penalty, or a security-derived limit on a product that requires no security.
//
// It also round-trips the flat-column projection, because that projection is what
// a legacy product's first publish goes through — drift there would silently
// rewrite an existing lender's terms.
//
//   npx tsx scripts/verify-product-templates.ts
// ─────────────────────────────────────────────────────────────────────────────
import { PRODUCT_TEMPLATES, templateBlanks } from "../src/lib/products/templates";
import {
  validateProduct, projectToColumns, definitionFromColumns,
  type ProductDefinition,
} from "../src/lib/products/definition";

/** Fill the per-org blanks with stubs so the rest of the document can be judged. */
function withStubWorkflows(d: ProductDefinition): ProductDefinition {
  return {
    ...d,
    process: {
      ...d.process,
      newWorkflowId: d.process.newLoan === "approval" ? "stub-workflow" : d.process.newWorkflowId,
      repeatWorkflowId: d.process.repeatLoan === "approval" ? "stub-workflow" : d.process.repeatWorkflowId,
    },
  };
}

const drift = (a: Record<string, unknown>, b: Record<string, unknown>) =>
  Object.keys(a).filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));

let failed = 0;

for (const t of PRODUCT_TEMPLATES) {
  const filled = withStubWorkflows(t.definition);
  const issues = validateProduct(filled);

  if (issues.length) {
    failed++;
    console.log(`x ${t.name}`);
    for (const i of issues) console.log(`      ${i.path} — ${i.message}`);
    continue;
  }

  const c = projectToColumns(filled);
  const blanks = templateBlanks(t.definition);
  console.log(
    `+ ${t.name.padEnd(22)} KES ${Number(c.minPrincipal).toLocaleString()}-${Number(c.maxPrincipal).toLocaleString()}` +
    `  ·  ${c.repaymentPeriod} x ${c.repaymentPeriodUnit}  ·  ${c.interestRate}% ${c.interestMethod}/${c.interestPeriodUnit}` +
    (blanks.length ? `  ·  asks for: ${blanks.map((b) => b.split(".")[1]).join(", ")}` : ""),
  );

  // columns → definition → columns must be stable, or the projection is lossy in a
  // way that would corrupt a pre-versioning product on its first publish.
  const round = projectToColumns(definitionFromColumns(c as unknown as Record<string, unknown>));
  const lost = drift(c as unknown as Record<string, unknown>, round as unknown as Record<string, unknown>);
  if (lost.length) {
    failed++;
    console.log(`      ! projection round-trip drift: ${lost.join(", ")}`);
    for (const k of lost) {
      console.log(`          ${k}: ${JSON.stringify((c as never)[k])} -> ${JSON.stringify((round as never)[k])}`);
    }
  }
}

console.log(failed === 0 ? "\nAll templates valid." : `\n${failed} template(s) failed.`);
process.exit(failed === 0 ? 0 : 1);
