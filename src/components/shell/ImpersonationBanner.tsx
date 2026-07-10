"use client";

// Always-visible strip when a platform admin is acting inside a lender's org.
// Impersonation must never be mistakable for a normal session — by the admin,
// or by anyone looking over a shoulder. The exit clears only the org session;
// the platform session survives (wired by /api/platform/impersonate, Commit D).
import { useRouter } from "next/navigation";
import { ShieldAlert } from "lucide-react";

export default function ImpersonationBanner({ adminName, orgName }: { adminName: string; orgName: string }) {
  const router = useRouter();
  return (
    <div className="no-print relative z-40 flex items-center justify-center gap-2 bg-amber-400 px-3 py-1.5 text-[12px] font-semibold text-amber-950">
      <ShieldAlert className="h-3.5 w-3.5 shrink-0" />
      <span className="truncate">
        Platform admin {adminName} — acting as {orgName}. Every action is audited.
      </span>
      <button
        type="button"
        onClick={async () => {
          await fetch("/api/platform/impersonate", { method: "DELETE" });
          router.replace("/platform");
        }}
        className="ml-2 shrink-0 rounded-md bg-amber-950/90 px-2 py-0.5 text-[11px] font-semibold text-amber-50 hover:bg-amber-950"
      >
        Return to platform
      </button>
    </div>
  );
}
