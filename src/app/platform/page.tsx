// BirgenAI platform — the founder's cross-tenant board. A real session now
// guards the door (PlatformAdmin + platform_session cookie); the typed-secret
// box is gone. The API keeps the legacy bearer for scripts, one more release.
import { redirect } from "next/navigation";
import { platformAuth } from "@/lib/platform-auth";
import PlatformBoard from "./PlatformBoard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function PlatformPage() {
  const session = await platformAuth();
  if (!session?.admin) redirect("/platform/login");
  return <PlatformBoard adminName={session.admin.name} />;
}
