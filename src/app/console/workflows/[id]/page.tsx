// Editing a workflow is the same builder that created it, pre-filled. One code path,
// so an edited chain can never drift from a created one — which is exactly how the
// old replace-path quietly dropped every stage's CRB gate.
import { WorkflowBuilder } from "@/components/workflows/WorkflowBuilder";

export const metadata = { title: "Workflow" };

export default async function EditWorkflowPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <WorkflowBuilder workflowId={id} />;
}
