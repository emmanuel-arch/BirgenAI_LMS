"use client";

import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";

export function SignOutButton() {
  const router = useRouter();
  return (
    <button
      onClick={async () => {
        await fetch("/api/auth/logout", { method: "POST" });
        router.replace("/login");
      }}
      className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-900/15 bg-white/70 px-2.5 py-1.5 text-xs font-medium text-zinc-700 hover:bg-white"
    >
      <LogOut className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Sign out</span>
    </button>
  );
}
