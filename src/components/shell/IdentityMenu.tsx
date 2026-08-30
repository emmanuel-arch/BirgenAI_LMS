"use client";

// ─────────────────────────────────────────────────────────────────────────────
// THE IDENTITY BUTTON — one control where there used to be two.
//
// The top-right of the console carried a "Systems" grip AND a profile pill, side
// by side. Two buttons, two dropdowns, two mental models — and they were answering
// the SAME question. "Which systems can I get into" and "who am I signed in as"
// are one question, because the answer to the first is derived entirely from the
// answer to the second: BirgenAI ID is what opens the other systems. Splitting
// them made the suite look like a feature bolted beside the account rather than
// what it is, which is the account.
//
// So: the grip stays (it is the learned affordance — Workspace, Atlassian, every
// suite has one) and the person's NAME stands beside it instead of the word
// "Systems". One press, one sheet: who you are, the systems that identity opens,
// and the account actions — change password, sign out.
//
// ⌘K / Ctrl-K still opens it, because that muscle memory belonged to the switcher
// and losing it would be a regression for the people who had it.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowUpRight, Grip, KeyRound, LogOut, ShieldCheck } from "lucide-react";
import { SUITE_APPS } from "@/lib/suite/apps";
import type { ResolvedSuiteApp } from "@/lib/suite/hosts";

export default function IdentityMenu({
  name,
  email,
  role,
  orgName,
  currentId = "lms",
  hosts,
}: {
  name: string;
  email?: string | null;
  role?: string | null;
  orgName?: string | null;
  currentId?: string;
  /**
   * The systems to offer, resolved server-side — each one's live href once it
   * has its own origin, and its branded door.
   *
   * REQUIRED, and it used to default to []. That default was the bug this prop
   * now prevents: the list rendered from SUITE_APPS and used `hosts` only to
   * look up an href, so a caller that forgot to pass it still showed all seven
   * systems — including the ones the lender had not bought. The switcher is on
   * every screen in every system, so it was the widest possible place for that
   * to leak. Now the list IS this array, and a caller that forgets does not
   * compile.
   */
  hosts: ResolvedSuiteApp[];
}) {
  const [open, setOpen] = useState(false);
  const [pw, setPw] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) { setOpen(false); setPw(false); }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setOpen(false); setPw(false); }
      // ⌘K / Ctrl-K toggles — inherited from the old switcher, deliberately kept.
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  const initial = (name || "?").trim().slice(0, 1).toUpperCase();

  return (
    <div ref={ref} className="relative">
      {/* ONE PILL, and now a QUIET one: grip · avatar.},
  q{          The name and the chevron came off because they were the only two things},
  q{          up here that grew with the DATA rather than holding a fixed shape — a},
  q{          long name pushed the pill wide and unbalanced a header whose left side},
  q{          is a precise segmented control. The affordance survives without them:},
  q{          the grip is the learned suite gesture, the avatar says who, and the name},
  q{          is the first line of the sheet this opens. It is still in the title},
  q{          attribute, so a hover answers it without a press. */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={`${name} — systems & account  (⌘K)`}
        className="panel flex items-center gap-2 rounded-2xl px-2.5 py-[5px] transition-colors hover:bg-paper"
      >
        <Grip className="h-4 w-4 shrink-0 text-[color:var(--ink-muted)]" />
        <span aria-hidden className="h-4 w-px shrink-0 bg-[color:var(--ink)]/10" />
        <span
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white"
          style={{ backgroundColor: "var(--brand)" }}
        >
          {initial}
        </span>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-2 w-[min(22.5rem,calc(100vw-1.5rem))] overflow-hidden rounded-2xl border border-[color:var(--ink)]/10 bg-paper shadow-2xl"
        >
          {/* WHO. The identity the systems below are opened with. */}
          <div className="flex items-center gap-3 border-b border-[color:var(--ink)]/[0.07] bg-[color:var(--ink)]/[0.02] px-3.5 py-3">
            <span
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white"
              style={{ backgroundColor: "var(--brand)" }}
            >
              {initial}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13.5px] font-semibold text-[color:var(--ink)]">{name}</p>
              <p className="truncate text-[11px] text-[color:var(--ink-muted)]">
                {role ?? "Staff"}{orgName ? ` · ${orgName}` : ""}
              </p>
              {email && <p className="truncate text-[10.5px] text-[color:var(--ink-faint)]">{email}</p>}
            </div>
          </div>

          {pw ? (
            <PasswordForm onDone={() => { setPw(false); setOpen(false); }} onCancel={() => setPw(false)} />
          ) : (
            <>
              <div className="flex items-center justify-between gap-2 px-3.5 pb-1 pt-2.5">
                <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-[color:var(--ink-faint)]">
                  <KeyRound className="h-3 w-3 text-[color:var(--brand)]" /> BirgenAI ID
                </span>
                <span className="text-[10px] text-[color:var(--ink-faint)]">one login · every system</span>
              </div>

              {/* The systems this identity opens. Ones you are not inside are shown
                  too, honestly labelled — a switcher that hides what exists is a
                  switcher nobody learns the shape of. */}
              <div className="max-h-[46vh] overflow-y-auto p-1.5">
                {hosts.map((host) => {
                  const app = SUITE_APPS.find((a) => a.id === host.id);
                  if (!app) return null;
                  const here = app.id === currentId;
                  // Cross-origin destinations get a plain anchor — the client router
                  // cannot soft-navigate off this origin, and Link would only add a
                  // failed prefetch before the full page load happens regardless.
                  const Nav = (host.federated || host.external ? "a" : Link) as typeof Link;
                  // Every hop goes through the destination system's own door, so
                  // switching from Ledgerly to ConnectDesk shows you ConnectDesk's
                  // name and colour on the way in rather than dropping you into an
                  // identically-shaped console and leaving you to read the header.
                  return (
                    <Nav
                      key={app.id}
                      href={here ? host.href : (host.door ?? host.href)}
                      {...(host.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                      onClick={() => setOpen(false)}
                      className={`group flex items-start gap-3 rounded-xl px-2.5 py-2 transition-colors ${
                        here ? "bg-[color:var(--ink)]/[0.04]" : "hover:bg-[color:var(--ink)]/[0.04]"
                      }`}
                    >
                      <span
                        className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ring-1"
                        style={{
                          backgroundColor: `${app.accent}1a`,
                          color: app.accent,
                          ["--tw-ring-color" as never]: `${app.accent}2e`,
                        }}
                      >
                        <app.icon className="h-[17px] w-[17px]" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5">
                          <span className="truncate text-[13px] font-semibold text-[color:var(--ink)]">{app.name}</span>
                          {here && (
                            <span className="rounded bg-[color:var(--ink)]/[0.07] px-1.5 py-px text-[9px] font-bold text-[color:var(--ink-muted)]">
                              HERE
                            </span>
                          )}
                          {!app.live && (
                            <span className="rounded bg-amber-500/15 px-1.5 py-px text-[9px] font-bold text-amber-700">
                              PREVIEW
                            </span>
                          )}
                        </span>
                        <span className="mt-0.5 block truncate text-[11px] text-[color:var(--ink-muted)]">
                          {app.purpose}
                        </span>
                      </span>
                      {!here && (
                        <ArrowUpRight className="mt-1.5 h-3.5 w-3.5 shrink-0 text-[color:var(--ink-faint)] opacity-0 transition-opacity group-hover:opacity-100" />
                      )}
                    </Nav>
                  );
                })}
              </div>

              {/* ACCOUNT. The things you do to the identity itself, not with it. */}
              <div className="border-t border-[color:var(--ink)]/[0.07] p-1.5">
                <Link
                  href="/suite"
                  onClick={() => setOpen(false)}
                  className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[12.5px] font-medium text-[color:var(--ink-body)] transition-colors hover:bg-[color:var(--ink)]/[0.04]"
                >
                  <ShieldCheck className="h-4 w-4 text-[color:var(--ink-faint)]" />
                  All systems &amp; how single sign-on works
                </Link>
                <button
                  type="button"
                  onClick={() => setPw(true)}
                  className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[12.5px] font-medium text-[color:var(--ink-body)] transition-colors hover:bg-[color:var(--ink)]/[0.04]"
                >
                  <KeyRound className="h-4 w-4 text-[color:var(--ink-faint)]" /> Change password
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    await fetch("/api/auth/logout", { method: "POST" });
                    router.replace("/login");
                  }}
                  className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[12.5px] font-medium text-red-600 transition-colors hover:bg-red-50"
                >
                  <LogOut className="h-4 w-4" /> Sign out
                </button>
              </div>
            </>
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
    <form onSubmit={submit} className="space-y-2 px-3.5 py-3">
      <input
        type="password" autoComplete="current-password" placeholder="Current password"
        value={current} onChange={(e) => setCurrent(e.target.value)}
        className="w-full rounded-lg border border-[color:var(--ink)]/15 px-2.5 py-1.5 text-sm"
      />
      <input
        type="password" autoComplete="new-password" placeholder="New password (10+ characters)"
        value={next} onChange={(e) => setNext(e.target.value)}
        className="w-full rounded-lg border border-[color:var(--ink)]/15 px-2.5 py-1.5 text-sm"
      />
      {msg && <p className="text-[11px] text-[color:var(--ink-muted)]">{msg}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={busy || !current || next.length < 10} className="flex-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-white disabled:opacity-50" style={{ backgroundColor: "var(--brand)" }}>
          {busy ? "Saving…" : "Save"}
        </button>
        <button type="button" onClick={onCancel} className="rounded-lg border border-[color:var(--ink)]/15 px-2.5 py-1.5 text-xs font-medium text-[color:var(--ink-muted)]">
          Cancel
        </button>
      </div>
    </form>
  );
}
