// Round-trip the new columns through the app's own Prisma client (driver adapter),
// so we are testing the path the console actually uses — not raw SQL.
import "dotenv/config";
import { rawPrisma as prisma } from "@/lib/prisma";

async function main() {
  const wf = await prisma.workflow.findFirst({
    select: { id: true, title: true, kind: true, multiApproval: true, isActive: true, updatedAt: true },
  });
  console.log("Workflow      :", wf ? `${wf.title} · kind=${wf.kind} · multi=${wf.multiApproval} · active=${wf.isActive}` : "none yet (columns readable)");

  const st = await prisma.workflowStage.findFirst({
    select: { id: true, title: true, checks: true, attachments: true, detailGroups: true, userIds: true, canReschedule: true, slaHours: true },
  });
  console.log("WorkflowStage :", st ? `${st.title} · checks=${JSON.stringify(st.checks)} · sla=${st.slaHours}h` : "none yet (columns readable)");

  const ch = await prisma.charge.findFirst({
    select: { id: true, name: true, percentOf: true, isMandatory: true, glAccount: true },
  });
  console.log("Charge        :", ch ? `${ch.name} · percentOf=${ch.percentOf} · mandatory=${ch.isMandatory} · gl=${ch.glAccount ?? "—"}` : "none yet (columns readable)");

  const b = await prisma.borrower.findFirst({ select: { id: true, details: true } });
  console.log("Borrower      :", b ? `details=${JSON.stringify(b.details)}` : "none yet (column readable)");

  const app = await prisma.loanApplication.findFirst({ select: { id: true, details: true } });
  console.log("Application   :", app ? `details=${JSON.stringify(app.details)}` : "none yet (column readable)");

  // The counts the workflows list renders, proving the new grouping query runs.
  const byKind = await prisma.workflow.groupBy({ by: ["kind"], _count: true });
  console.log("Workflows by kind:", byKind.map((r) => `${r.kind}=${r._count}`).join(", ") || "(no workflows)");
}

main()
  .then(() => { console.log("\nAll new columns readable through Prisma."); process.exit(0); })
  .catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
