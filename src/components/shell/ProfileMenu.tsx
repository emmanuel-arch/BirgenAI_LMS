"use client";

// The profile dropdown — pinned to the top bar's far right whenever a staff
// member is signed in. Identity, change-password, sign out.
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, KeyRound, LogOut, UserRound } from "lucide-react";

export default function ProfileMenu({
  name,
  email,
  role,
}: {
  name: string;
  email?: string | null;
  role?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [pw, setPw] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); setPw(false); } };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  const initial = (name || "?").trim().slice(0, 1).toUpperCase();

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-2 rounded-full border border-zinc-900/10 bg-white/70 py-1 pl-1 pr-2 hover:bg-white"
      >
        <span className="flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold text-white" style={{ backgroundColor: "var(--brand)" }}>
          {initial}
        </span>
        <span className="hidden sm:block max-w-[120px] truncate text-xs font-medium text-zinc-700">{name}</span>
        <ChevronDown className={`h-3.5 w-3.5 text-zinc-400 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div role="menu" className="absolute right-0 top-full z-50 mt-2 w-64 rounded-xl border border-zinc-900/10 bg-white p-1.5 shadow-xl">
          <div className="flex items-center gap-2.5 rounded-lg bg-zinc-50 px-3 py-2.5">
            <UserRound className="h-4 w-4 text-zinc-400" />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-zinc-900">{name}</p>
              <p className="truncate text-[11px] text-zinc-500">{role ?? "Staff"}{email ? ` · ${email}` : ""}</p>
            </div>
          </div>

          {!pw ? (
            <>
              <button
                type="button"
                onClick={() => setPw(true)}
                className="mt-1 flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] font-medium text-zinc-700 hover:bg-zinc-900/5"
              >
                <KeyRound className="h-4 w-4 text-zinc-400" /> Change password
              </button>
              <button
                type="button"
                onClick={async () => {
                  await fetch("/api/auth/logout", { method: "POST" });
                  router.replace("/login");
                }}
                className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] font-medium text-red-600 hover:bg-red-50"
              >
                <LogOut className="h-4 w-4" /> Sign out
              </button>
            </>
          ) : (
            <PasswordForm onDone={() => { setPw(false); setOpen(false); }} onCancel={() => setPw(false)} />
          )}
        </div>
      )}
    </div>
  );
}

function PasswordForm({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setMsg(null);
    const res = await fetch("/api/auth/password", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ current, next }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (res.ok) { setMsg("Password changed."); setTimeout(onDone, 900); }
    else setMsg(data.message ?? "Could not change the password.");
  };

  return (
    <form onSubmit={submit} className="mt-1 space-y-2 px-3 py-2">
      <input
        type="password" autoComplete="current-password" placeholder="Current password"
        value={current} onChange={(e) => setCurrent(e.target.value)}
        className="w-full rounded-lg border border-zinc-900/15 px-2.5 py-1.5 text-sm"
      />
      <input
        type="password" autoComplete="new-password" placeholder="New password (10+ characters)"
        value={next} onChange={(e) => setNext(e.target.value)}
        className="w-full rounded-lg border border-zinc-900/15 px-2.5 py-1.5 text-sm"
      />
      {msg && <p className="text-[11px] text-zinc-600">{msg}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={busy || !current || next.length < 10} className="flex-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-white disabled:opacity-50" style={{ backgroundColor: "var(--brand)" }}>
          {busy ? "Saving…" : "Save"}
        </button>
        <button type="button" onClick={onCancel} className="rounded-lg border border-zinc-900/15 px-2.5 py-1.5 text-xs font-medium text-zinc-600">
          Cancel
        </button>
      </div>
    </form>
  );
}
