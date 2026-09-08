// A new workflow gets its own page, because a chain with stages, roles, checks and
// caps is not something to configure in a strip under a list.
import { WorkflowBuilder } from "@/components/workflows/WorkflowBuilder";

export const metadata = { title: "New workflow" };

export default function NewWorkflowPage() {
  return <WorkflowBuilder workflowId={null} />;
}
