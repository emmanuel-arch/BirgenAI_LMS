"use client";

// ─────────────────────────────────────────────────────────────────────────────
// THE APP SWITCHER — the grip in the console top bar.
//
// The one piece of chrome that tells a lender, from inside the product, that they
// bought a suite rather than an LMS. Same gesture as Google Workspace or
// Atlassian: hit the grip (or ⌘K / Ctrl-K), pick a system, and you are already
// in it — no second login, no re-picking your organisation.
//
// It deliberately shows systems the person is NOT yet inside as well, greyed and
// honest, because a switcher that hides what exists is a switcher nobody learns
// the shape of.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Grip, KeyRound, ArrowUpRight } from "lucide-react";
import { SUITE_APPS } from "@/lib/suite/apps";
import type { ResolvedSuiteApp } from "@/lib/suite/hosts";

export default function SuiteSwitcher({
  currentId = "lms", hosts = [],
}: {
  currentId?: string;
  /** Resolved server-side: each system's live href once it has its own origin. */
  hosts?: ResolvedSuiteApp[];
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
      // ⌘K / Ctrl-K toggles — the gesture people already have in their fingers.
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

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Switch system"
        title="Switch system  (⌘K)"
        className="panel flex items-center gap-1.5 rounded-xl px-2.5 py-[7px] text-[color:var(--ink-muted)] transition-colors hover:text-[color:var(--ink)]"
      >
        <Grip className="h-4 w-4" />
        <span className="hidden text-[11px] font-semibold sm:inline">Systems</span>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-2 w-[min(22rem,calc(100vw-1.5rem))] overflow-hidden rounded-2xl border border-[color:var(--ink)]/10 bg-white shadow-2xl"
        >
          <div className="flex items-center justify-between gap-2 border-b border-[color:var(--ink)]/[0.07] bg-[color:var(--ink)]/[0.02] px-3.5 py-2.5">
            <span className="flex items-center gap-1.5 text-[11px] font-semibold text-[color:var(--ink-body)]">
              <KeyRound className="h-3.5 w-3.5 text-[color:var(--brand)]" /> BirgenAI ID
            </span>
            <span className="text-[10px] text-[color:var(--ink-faint)]">one login · every system</span>
          </div>

          <div className="p-1.5">
            {SUITE_APPS.map((app) => {
              const here = app.id === currentId;
              const host = hosts.find((h) => h.id === app.id);
              // Cross-origin destinations get a plain anchor — the client router
              // cannot soft-navigate off this origin, and Link would only add a
              // failed prefetch before the full page load happens regardless.
              const Nav = (host?.federated ? "a" : Link) as typeof Link;
              return (
                <Nav
                  key={app.id}
                  href={host?.href ?? app.href}
                  onClick={() => setOpen(false)}
                  className={`group flex items-start gap-3 rounded-xl px-2.5 py-2.5 transition-colors ${
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
                    <span className="mt-0.5 block truncate font-mono text-[10px] text-[color:var(--ink-faint)]">
                      {app.subdomain}
                    </span>
                  </span>
                  {!here && (
                    <ArrowUpRight className="mt-1 h-3.5 w-3.5 shrink-0 text-[color:var(--ink-faint)] opacity-0 transition-opacity group-hover:opacity-100" />
                  )}
                </Nav>
              );
            })}
          </div>

          <Link
            href="/suite"
            onClick={() => setOpen(false)}
            className="flex items-center justify-between gap-2 border-t border-[color:var(--ink)]/[0.07] px-3.5 py-2.5 text-[11px] font-semibold text-[color:var(--ink-muted)] transition-colors hover:text-[color:var(--ink)]"
          >
            All systems &amp; how single sign-on works
            <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      )}
    </div>
  );
}
