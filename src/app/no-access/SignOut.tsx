"use client";

// The sign-out control for /no-access.
//
// A <Link> would not do: /api/auth/logout is POST-only (a session that any GET
// could end is a session a third-party <img> tag could end), and a link to it
// answers 405 with a JSON body rendered as a page. So it is a button that posts,
// exactly as the identity menu's does.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut, Loader2 } from "lucide-react";

export default function SignOut({ backTo }: { backTo: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
        router.replace(backTo);
      }}
      className="inline-flex items-center gap-1.5 rounded-xl bg-invert px-4 py-2.5 text-[13px] font-semibold text-invert-fg transition-colors hover:bg-invert-2 disabled:opacity-60"
    >
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LogOut className="h-3.5 w-3.5" />} Sign out
    </button>
  );
}
