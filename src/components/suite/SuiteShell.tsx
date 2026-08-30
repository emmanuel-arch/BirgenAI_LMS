"use client";

// ─────────────────────────────────────────────────────────────────────────────
// THE SUITE CHROME — one shell, six systems.
//
// ── WHY THIS EXISTS ──────────────────────────────────────────────────────────
// The Analytics & Reporting grew its own shell because it needed one; ConnectDesk,
// PeopleHub and Ledgerly would each have grown a fourth, fifth and sixth. Four
// near-identical navigation rails is not six systems that feel like one product,
// it is four maintenance liabilities that drift apart over a quarter until a
// person who learned one has to learn the next.
//
// So the rail is generalised here and every satellite renders it. A change to
// the collapse behaviour, the drawer, the active state or the brand block is a
// change to all of them, at once, by construction.
//
// ── WHAT IS THE SAME EVERYWHERE, AND WHAT IS NOT ─────────────────────────────
// SAME: the lender's mark in the top-left corner, the dark rail against a light
// canvas, the module → item tree with its blurb-on-active, the collapse control
// and its persisted preference, the mobile drawer, the identity pill, the type
// scale, the way back to the console.
//
// DIFFERENT: exactly two things. The ACCENT — each system's colour from the
// suite launcher, carried into the active state, the brand tile and the header
// rule — and the NAME. That is the whole of it. A lender should be able to tell
// which system they are in from the corner of their eye and from nothing else,
// because everything else is a thing they already know how to use.
//
// ── THE LOGO ─────────────────────────────────────────────────────────────────
// The lender's own mark sits top-left in every system. It renders on a white
// card rather than straight onto the dark rail, and that is not decoration:
// lenders upload transparent PNGs drawn for white letterhead, and floated onto a
// near-black rail they either vanish or come back as a grey smear. The card is
// the letterhead. Without a logo the system falls back to a tinted monogram.
// ─────────────────────────────────────────────────────────────────────────────

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X, PanelLeftClose, PanelLeftOpen, ArrowUpRight } from "lucide-react";
import { useLoad } from "@/lib/hooks/useLoad";
import type { ResolvedSuiteApp } from "@/lib/suite/hosts";
import IdentityMenu from "@/components/shell/IdentityMenu";
import ThemeSwitch from "@/components/shell/ThemeSwitch";
import { navIcon } from "@/components/shell/icons";

// ── The nav shape every system speaks ────────────────────────────────────────
// Deliberately the same shape the console's registry and the studio's use, so a
// system's menu can be written once and filtered server-side by rights.

export type SuiteNavItem = {
  key: string;
  label: string;
  href: string;
  icon: string;
  /** One line under the label when active — what this screen answers. */
  blurb: string;
  ready?: boolean;
  exact?: boolean;
  /** A live count rendered as a pill: an unworked queue, an open ticket count. */
  badge?: number | string | null;
};

export type SuiteNavModule = {
  key: string;
  label: string;
  icon: string;
  items: SuiteNavItem[];
};

export type SuiteOrg = { name: string; slug: string; logoUrl: string | null; logoScale?: number | null };
export type SuiteUser = { name: string; email?: string | null; role?: string | null };

/** Which system this is — the only thing that differs between the six. */
export type SuiteIdentity = {
  /** Must match the id in SUITE_APPS so the identity menu marks the right door. */
  id: string;
  name: string;
  accent: string;
  /** Second gradient stop for the brand tile. */
  accent2?: string;
  /** One line in the header — what this system is doing right now. */
  strap: string;
};

export default function SuiteShell({
  identity, nav, org, user, suiteHosts, consoleHref, headerRight, children,
}: {
  identity: SuiteIdentity;
  nav: SuiteNavModule[];
  org: SuiteOrg;
  user: SuiteUser;
  suiteHosts: ResolvedSuiteApp[];
  consoleHref: string;
  /** System-specific header controls — a live pulse, a shift button, a filter. */
  headerRight?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [drawer, setDrawer] = useState(false);

  // One preference key across all six. Collapsing the rail in ConnectDesk and
  // finding it expanded in Analytics is the kind of small betrayal that makes a
  // suite feel like separate products bolted together.
  useLoad(() => {
    try { setCollapsed(localStorage.getItem("suite:nav-collapsed") === "1"); } catch { /* private mode */ }
  });
  const toggle = () => {
    setCollapsed((v) => {
      try { localStorage.setItem("suite:nav-collapsed", v ? "0" : "1"); } catch { /* private mode */ }
      return !v;
    });
  };

  useEffect(() => {
    document.body.style.overflow = drawer ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [drawer]);

  return (
    <div
      className="relative min-h-screen text-ash-800"
      style={{ ["--accent" as never]: identity.accent, ["--accent2" as never]: identity.accent2 ?? identity.accent }}
    >
      {/* ── THE CANVAS ─────────────────────────────────────────────────────────
          The lending console has always sat on artwork (see components/shell/Shell)
          while the five satellites sat on flat #f6f6f4 — which is precisely why
          the console looked like a product and PeopleHub looked like an admin
          panel. Same suite, same rail, same type, and one of them had a floor.

          ── WHY A WASH RATHER THAN SIX MORE IMAGES ────────────────────────────
          The obvious fix is six tinted plates, one per system. It is the wrong
          one: six files to regenerate whenever the artwork changes, six chances
          for a tint to drift from the accent it is supposed to match, and ~600kB
          of images to say something CSS already knows. The accent is right here
          in `identity` — every system already declares it — so one shared plate
          plus a radial wash in that accent gives six distinctly-coloured canvases
          that cannot go out of sync with the colour code by construction.

          Opacity is deliberately low. This is a FLOOR, not a feature: the tint
          should be the thing you notice on walking into a room, not the thing you
          read. Every surface above it is a .panel or .canvas with its own opaque
          background, so no text ever sits on the wash directly. */}
      <div aria-hidden className="pointer-events-none fixed inset-0 z-0 bg-studio">
        <div className="absolute inset-0 bg-[url('/images/white-background.png')] bg-cover bg-center" />
        <div
          className="absolute inset-0 opacity-[0.20]"
          style={{
            background: `radial-gradient(1100px 720px at 88% -6%, ${identity.accent} 0%, transparent 62%),
                         radial-gradient(880px 620px at 4% 104%, ${identity.accent2 ?? identity.accent} 0%, transparent 58%)`,
          }}
        />
      </div>

      <div className="relative z-10 flex min-h-screen">
        <aside
          className={`sticky top-0 hidden h-screen shrink-0 flex-col bg-[#15141b] transition-[width] duration-200 lg:flex ${
            collapsed ? "w-[68px]" : "w-64"
          }`}
        >
          <Suspense fallback={null}>
            <Rail identity={identity} nav={nav} org={org} collapsed={collapsed} onToggle={toggle} consoleHref={consoleHref} />
          </Suspense>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          {/* The header sits ON the canvas now, so it is translucent rather than
              the old opaque #f6f6f4 — a solid bar would have cut a grey stripe
              across the artwork it is supposed to be floating over. The accent
              hairline underneath is what tells you which system you are in from
              the corner of your eye. */}
          <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-3 border-b border-ash-900/[0.07] bg-paper/55 px-4 backdrop-blur-xl sm:px-6">
            <span
              aria-hidden
              className="pointer-events-none absolute inset-x-0 bottom-0 h-px"
              style={{ background: `linear-gradient(90deg, ${identity.accent} 0%, transparent 55%)` }}
            />
            <button
              type="button"
              onClick={() => setDrawer(true)}
              className="rounded-lg p-2 text-ash-500 hover:bg-ash-900/5 lg:hidden"
              aria-label="Open navigation"
            >
              <Menu className="h-4 w-4" />
            </button>
            <p className="hidden min-w-0 truncate text-[11px] font-medium text-ash-500 lg:block">
              <span className="font-semibold text-ash-700">{org.name}</span>
              {" · "}
              {identity.strap}
            </p>
            <div className="ml-auto flex items-center gap-2">
              {headerRight}
              <ThemeSwitch />
              <IdentityMenu
                name={user.name}
                email={user.email}
                role={user.role}
                orgName={org.name}
                currentId={identity.id}
                hosts={suiteHosts}
              />
            </div>
          </header>

          <main className="min-w-0 flex-1">{children}</main>
        </div>
      </div>

      {drawer && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div aria-hidden className="absolute inset-0 bg-zinc-950/50 backdrop-blur-sm" onClick={() => setDrawer(false)} />
          <div className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-[#15141b]">
            <button
              type="button"
              onClick={() => setDrawer(false)}
              aria-label="Close navigation"
              className="absolute right-2 top-3 z-10 rounded-lg p-2 text-white/50 hover:bg-paper/10"
            >
              <X className="h-4 w-4" />
            </button>
            <Suspense fallback={null}>
              <Rail identity={identity} nav={nav} org={org} collapsed={false} consoleHref={consoleHref} onNavigate={() => setDrawer(false)} />
            </Suspense>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function Rail({
  identity, nav, org, collapsed, onToggle, onNavigate, consoleHref,
}: {
  identity: SuiteIdentity;
  nav: SuiteNavModule[];
  org: SuiteOrg;
  collapsed: boolean;
  onToggle?: () => void;
  onNavigate?: () => void;
  consoleHref: string;
}) {
  const pathname = usePathname();

  // Prefix match except where the item asks for exact — without that exception
  // the system's root entry matches every page beneath it and never stops
  // looking selected.
  const isActive = (href: string, exact?: boolean) =>
    exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* ── The lender's mark, top-left, in every system ─────────────────── */}
      <div className={`flex shrink-0 items-center gap-2.5 px-3 py-3.5 ${collapsed ? "justify-center px-2" : ""}`}>
        {org.logoUrl ? (
          <span
            className={`flex shrink-0 items-center justify-center overflow-hidden rounded-lg bg-paper shadow-sm ${
              collapsed ? "h-9 w-9 p-1" : "h-10 w-10 p-1"
            }`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={org.logoUrl} alt={`${org.name} logo`} className="max-h-full max-w-full object-contain" />
          </span>
        ) : (
          <span
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[13px] font-black text-white"
            style={{ background: `linear-gradient(135deg, ${identity.accent}, ${identity.accent2 ?? identity.accent})` }}
            aria-hidden
          >
            {org.name.slice(0, 1).toUpperCase()}
          </span>
        )}
        {!collapsed && (
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-bold leading-tight text-white">{identity.name}</p>
            <p className="truncate text-[10px] leading-tight text-white/40">{org.name}</p>
          </div>
        )}
        {onToggle && !collapsed && (
          <button
            type="button"
            onClick={onToggle}
            className="rounded-md p-1.5 text-white/35 hover:bg-paper/10 hover:text-white/70"
            aria-label="Collapse navigation"
          >
            <PanelLeftClose className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* The accent hairline is the system's signature — the one place the rail
          is not the same near-black in all six. */}
      <div
        aria-hidden
        className="mx-3 mb-1 h-px shrink-0"
        style={{ background: `linear-gradient(90deg, ${identity.accent}, transparent)` }}
      />

      {onToggle && collapsed && (
        <button
          type="button"
          onClick={onToggle}
          className="mx-auto mb-2 rounded-md p-1.5 text-white/35 hover:bg-paper/10 hover:text-white/70"
          aria-label="Expand navigation"
        >
          <PanelLeftOpen className="h-3.5 w-3.5" />
        </button>
      )}

      <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {nav.map((mod) => (
          <div key={mod.key} className="mb-1">
            {!collapsed && (
              <p className="px-3 pb-1 pt-3 text-[9px] font-bold uppercase tracking-[0.14em] text-white/30">{mod.label}</p>
            )}
            {collapsed && <div className="mx-3 my-2 h-px bg-paper/10" aria-hidden />}
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
                  {!collapsed && item.badge != null && item.badge !== "" && (
                    <span
                      className="shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-bold tabular-nums text-white"
                      style={{ backgroundColor: active ? "rgba(255,255,255,0.18)" : identity.accent }}
                    >
                      {item.badge}
                    </span>
                  )}
                  {!collapsed && dead && (
                    <span className="shrink-0 rounded bg-paper/10 px-1 py-0.5 text-[8px] font-bold uppercase text-white/40">soon</span>
                  )}
                </>
              );

              const cls = `mb-0.5 flex items-center gap-2.5 rounded-lg px-3 py-2 transition-colors ${
                collapsed ? "justify-center px-2" : ""
              } ${
                active
                  ? "bg-paper/[0.10] text-white"
                  : dead
                    ? "cursor-not-allowed text-white/25"
                    : "text-white/60 hover:bg-paper/[0.06] hover:text-white/90"
              }`;

              if (dead) {
                return <div key={item.key} className={cls} title={`${item.blurb} — shipping soon`}>{body}</div>;
              }
              return (
                <Link
                  key={item.key}
                  href={item.href}
                  onClick={onNavigate}
                  title={collapsed ? `${item.label} — ${item.blurb}` : undefined}
                  className={cls}
                  style={active ? { boxShadow: `inset 2px 0 0 ${identity.accent}` } : undefined}
                >
                  {body}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      {/* The way back. Every satellite can return you to the tool the numbers are
          made in; a system with no exit is a dead end. */}
      <div className="shrink-0 border-t border-white/[0.08] p-2">
        <Link
          href={consoleHref}
          className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-white/50 transition-colors hover:bg-paper/[0.06] hover:text-white/90 ${
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
