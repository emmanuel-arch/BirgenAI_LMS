"use client";

// ─────────────────────────────────────────────────────────────────────────────
// THE STUDIO'S CHROME — analytics as a SYSTEM, not a screen.
//
// The console's shell is a working tool: dense, pale, built to be stared at for
// eight hours while you process applications. The studio is read, not operated —
// often by someone senior, often on a large screen, often projected. So it gets
// its own chrome: a dark navigation rail against a light canvas, which is the
// arrangement every serious analytics product converges on for the same reason.
// The dark rail recedes and the charts come forward.
//
// What it deliberately KEEPS from the console: the collapse behaviour and its
// persisted preference, the mobile drawer, the identity menu, and the module →
// item nav shape. A person moving between the two systems should not have to
// learn a second way to navigate — that is the whole federation argument, made
// in the interface rather than in a slide.
//
// The nav tree arrives pre-filtered from the server (rights × bridged mode); this
// component holds presentation state only.
// ─────────────────────────────────────────────────────────────────────────────
import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X, PanelLeftClose, PanelLeftOpen, ArrowUpRight } from "lucide-react";
import { useLoad } from "@/lib/hooks/useLoad";
import type { StudioModule } from "@/lib/analytics/studio-nav";
import type { ResolvedSuiteApp } from "@/lib/suite/hosts";
import IdentityMenu from "@/components/shell/IdentityMenu";
import { navIcon } from "@/components/shell/icons";

/** The studio's own accent. Violet — its colour in the suite launcher. */
const STUDIO_ACCENT = "#7c3aed";

export type StudioOrg = { name: string; slug: string; mode: string; logoUrl: string | null };
export type StudioUser = { name: string; email?: string | null; role?: string | null };

export default function StudioShell({
  nav, org, user, suiteHosts, consoleHref, children,
}: {
  nav: StudioModule[];
  org: StudioOrg;
  user: StudioUser;
  suiteHosts: ResolvedSuiteApp[];
  /** Where the lending console lives — its own origin once split out. */
  consoleHref: string;
  children: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [drawer, setDrawer] = useState(false);

  useLoad(() => {
    try { setCollapsed(localStorage.getItem("studio:nav-collapsed") === "1"); } catch { /* private mode */ }
  });
  const toggle = () => {
    setCollapsed((v) => {
      try { localStorage.setItem("studio:nav-collapsed", v ? "0" : "1"); } catch { /* private mode */ }
      return !v;
    });
  };

  useEffect(() => {
    document.body.style.overflow = drawer ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [drawer]);

  return (
    <div className="min-h-screen bg-[#f6f6f4] text-zinc-800">
      <div className="flex min-h-screen">
        {/* ── The rail ─────────────────────────────────────────────────── */}
        <aside
          className={`sticky top-0 hidden h-screen shrink-0 flex-col bg-[#15141b] transition-[width] duration-200 lg:flex ${
            collapsed ? "w-[68px]" : "w-64"
          }`}
        >
          <Suspense fallback={null}>
            <StudioNav
              nav={nav}
              org={org}
              collapsed={collapsed}
              onToggle={toggle}
              consoleHref={consoleHref}
            />
          </Suspense>
        </aside>

        {/* ── The canvas ───────────────────────────────────────────────── */}
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center justify-between gap-3 border-b border-zinc-900/[0.07] bg-[#f6f6f4]/85 px-4 backdrop-blur sm:px-6">
            <button
              type="button"
              onClick={() => setDrawer(true)}
              className="rounded-lg p-2 text-zinc-500 hover:bg-zinc-900/5 lg:hidden"
              aria-label="Open navigation"
            >
              <Menu className="h-4 w-4" />
            </button>
            <p className="hidden text-[11px] font-medium text-zinc-500 lg:block">
              <span className="font-semibold text-zinc-700">{org.name}</span>
              {" · "}reading the live book
            </p>
            <div className="ml-auto">
              <IdentityMenu
                name={user.name}
                email={user.email}
                role={user.role}
                orgName={org.name}
                currentId="analytics"
                hosts={suiteHosts}
              />
            </div>
          </header>

          <main className="min-w-0 flex-1">{children}</main>
        </div>
      </div>

      {/* ── Mobile drawer ────────────────────────────────────────────────── */}
      {drawer && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div aria-hidden className="absolute inset-0 bg-zinc-950/50 backdrop-blur-sm" onClick={() => setDrawer(false)} />
          <div className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-[#15141b]">
            <button
              type="button"
              onClick={() => setDrawer(false)}
              aria-label="Close navigation"
              className="absolute right-2 top-3 z-10 rounded-lg p-2 text-white/50 hover:bg-white/10"
            >
              <X className="h-4 w-4" />
            </button>
            <Suspense fallback={null}>
              <StudioNav nav={nav} org={org} collapsed={false} consoleHref={consoleHref} onNavigate={() => setDrawer(false)} />
            </Suspense>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function StudioNav({
  nav, org, collapsed, onToggle, onNavigate, consoleHref,
}: {
  nav: StudioModule[];
  org: StudioOrg;
  collapsed: boolean;
  onToggle?: () => void;
  onNavigate?: () => void;
  consoleHref: string;
}) {
  const pathname = usePathname();

  // Active is a PREFIX match except where the item asks for exact. Without the
  // exception "/analytics" matches every page in the studio and the Overview
  // entry never stops looking selected.
  const isActive = (href: string, exact?: boolean) =>
    exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Brand */}
      <div className={`flex shrink-0 items-center gap-2.5 px-4 py-4 ${collapsed ? "justify-center px-2" : ""}`}>
        <span
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[13px] font-black text-white"
          style={{ background: `linear-gradient(135deg, ${STUDIO_ACCENT}, #a855f7)` }}
          aria-hidden
        >
          A
        </span>
        {!collapsed && (
          <div className="min-w-0">
            <p className="truncate text-[13px] font-bold leading-tight text-white">Analytics Studio</p>
            <p className="truncate text-[10px] leading-tight text-white/40">{org.name}</p>
          </div>
        )}
        {onToggle && !collapsed && (
          <button
            type="button"
            onClick={onToggle}
            className="ml-auto rounded-md p-1.5 text-white/35 hover:bg-white/10 hover:text-white/70"
            aria-label="Collapse navigation"
          >
            <PanelLeftClose className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {onToggle && collapsed && (
        <button
          type="button"
          onClick={onToggle}
          className="mx-auto mb-2 rounded-md p-1.5 text-white/35 hover:bg-white/10 hover:text-white/70"
          aria-label="Expand navigation"
        >
          <PanelLeftOpen className="h-3.5 w-3.5" />
        </button>
      )}

      {/* Modules */}
      <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {nav.map((mod) => (
          <div key={mod.key} className="mb-1">
            {!collapsed && (
              <p className="px-3 pb-1 pt-3 text-[9px] font-bold uppercase tracking-[0.14em] text-white/30">{mod.label}</p>
            )}
            {collapsed && <div className="mx-3 my-2 h-px bg-white/10" aria-hidden />}
            {mod.items.map((item) => {
              const Icon = navIcon(item.icon);
              const active = isActive(item.href, item.exact);
              const dead = item.ready === false;

              const body = (
                <>
                  <Icon className="h-4 w-4 shrink-0" />
                  {!collapsed && (
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12.5px] font-medium leading-tight">{item.label}</span>
                      {active && <span className="mt-0.5 block truncate text-[10px] leading-tight text-white/45">{item.blurb}</span>}
                    </span>
                  )}
                  {!collapsed && dead && (
                    <span className="shrink-0 rounded bg-white/10 px-1 py-0.5 text-[8px] font-bold uppercase text-white/40">soon</span>
                  )}
                </>
              );

              const cls = `mb-0.5 flex items-center gap-2.5 rounded-lg px-3 py-2 transition-colors ${
                collapsed ? "justify-center px-2" : ""
              } ${
                active
                  ? "bg-white/[0.10] text-white"
                  : dead
                    ? "cursor-not-allowed text-white/25"
                    : "text-white/60 hover:bg-white/[0.06] hover:text-white/90"
              }`;

              if (dead) {
                return (
                  <div key={item.key} className={cls} title={`${item.blurb} — shipping soon`}>
                    {body}
                  </div>
                );
              }
              return (
                <Link
                  key={item.key}
                  href={item.href}
                  onClick={onNavigate}
                  title={collapsed ? `${item.label} — ${item.blurb}` : undefined}
                  className={cls}
                  style={active ? { boxShadow: `inset 2px 0 0 ${STUDIO_ACCENT}` } : undefined}
                >
                  {body}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      {/* The way back. A studio that cannot return you to the tool you came from
          is a dead end, and the console is where every number here is created. */}
      <div className="shrink-0 border-t border-white/[0.08] p-2">
        <Link
          href={consoleHref}
          className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-white/50 transition-colors hover:bg-white/[0.06] hover:text-white/90 ${
            collapsed ? "justify-center px-2" : ""
          }`}
          title="Back to the lending console"
        >
          <ArrowUpRight className="h-4 w-4 shrink-0" />
          {!collapsed && <span className="text-[12px] font-medium">Lending console</span>}
        </Link>
      </div>
    </div>
  );
}
