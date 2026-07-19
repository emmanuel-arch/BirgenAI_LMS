// /<org>/login → /<org>. The branded login IS the org's landing page; this
// alias exists because "…/login" is what people type from muscle memory.
import { redirect } from "next/navigation";

export default async function OrgLoginAlias({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  redirect(`/${encodeURIComponent(org)}`);
}
