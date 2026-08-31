"use client";

// ─────────────────────────────────────────────────────────────────────────────
// THE SUITE CHROME — one shell, five systems, and the console's own geometry.
//
// ── WHAT CHANGED, AND WHY IT HAD TO ──────────────────────────────────────────
// This shell used to draw a near-black navigation rail, flush to the left edge
// of the screen, against a pale page. Every satellite wore it. Put the console
// beside ConnectDesk in light mode and they did not look like one product: the
// console floated a white letterhead card on artwork, and its four siblings
// looked like the admin panel that ships with a router.
//
// It was also, plainly, wrong. A dark rail on a light page is not a theme — it
// is two themes on one screen, and the moment a real dark mode arrived the rail
// was the ONE thing that could not get darker, because it was already black.
// White is white and dark is dark, or neither word means anything.
//
// So the geometry is now the console's, exactly (components/shell/Shell):
//
//   · The rail is a FLOATING `.panel` — inset from every edge, rounded, with the
//     artwork running underneath and around it. Its colours come from the token
//     layer, so it is a pale card in light and a dark card in dark, without a
//     single hex here.
//   · The lender's mark sits in a tall WHITE LETTERHEAD CARD at the head of the
//     column. Not because it is pretty: lenders upload transparent PNGs drawn
//     for white paper, and floated onto a near-black rail they came back as a
//     grey smear. The card is the letterhead.
//   · Page content sits on a `.canvas`. That is the rule the console settled on
//     and the one this shell was missing — TYPE NEVER TOUCHES THE ARTWORK. The
//     old header laid "Micromart Africa · reading the live book" and every page
//     title straight onto a photograph of a filament web, and whether you could
//     read them depended on which filament happened to be underneath.
//
// ── WHAT STILL DIFFERS BETWEEN THE FIVE ──────────────────────────────────────
// The ACCENT, the NAME, the NAV and the STRAP. That is the whole list. The
// accent is bound to `--brand` for this subtree, so the active nav pill, the
// page-header icon and the focus rings all take the system's colour through the
// idiom the rest of the codebase already uses — a satellite gets its own
// identity without a single component learning which system it is in.
//
// The FLOOR is chosen per system too, and is not this file's business: see
// components/shell/Backdrop and lib/theme/skins.
// ─────────────────────────────────────────────────────────────────────────────

import { Suspense, useEffect, useState, type CSSProperties } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X, PanelLeftClose, PanelLeftOpen, ArrowUpRight } from "lucide-react";
import { useLoad } from "@/lib/hooks/useLoad";
import type { ResolvedSuiteApp } from "@/lib/suite/hosts";
import IdentityMenu from "@/components/shell/IdentityMenu";
import ThemeSwitch from "@/components/shell/ThemeSwitch";
import SkinMenu from "@/components/shell/SkinMenu";
import Backdrop from "@/components/shell/Backdrop";
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

/** Which system this is — the only thing that differs between the five. */
export type SuiteIdentity = {
  /** Must match the id in SUITE_APPS so the identity menu marks the right door. */
  id: string;
  name: string;
  accent: string;
  /** Second gradient stop for the monogram and the floor's far corner. */
  accent2?: string;
  /** One line beside the lender's name — what this system is doing right now. */
  strap: string;
  /**
   * Some systems are read at a desk and some are read across a boardroom table.
   * A reports grid with twelve columns and a 1,000-row table needs the width;
   * PeopleHub's directory does not, and stretching it to 1600px only makes the
   * eye travel further between a name and the number beside it.
   */
  canvas?: "standard" | "wide";
};

const CANVAS_WIDTH = { standard: "max-w-6xl", wide: "max-w-[1560px]" } as const;

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

  // One preference key across all five. Collapsing the rail in ConnectDesk and
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

  // `--brand` is the console's own idiom for "this product's colour" and half
  // the shared components already read it. Binding the system accent to it here
  // is what makes PageHeader's icon, the active nav pill and every focus ring
  // turn violet in Analytics and rose in ConnectDesk — with no component
  // anywhere having to know which system it is being rendered inside.
  const vars = {
    "--accent": identity.accent,
    "--accent2": identity.accent2 ?? identity.accent,
    "--brand": identity.accent,
    "--brand-soft": `${identity.accent}1f`,
  } as CSSProperties;

  return (
    <div className="min-h-screen text-[color:var(--ink-body)]" style={vars}>
      <Backdrop systemId={identity.id} accent={identity.accent} accent2={identity.accent2} />

      <div className="relative z-10 flex min-h-screen flex-col">
        {/* The gap is the design. Chrome and page float apart, and the artwork
            runs between them and around the edges of the screen. */}
        <div className="flex flex-1 gap-3 px-3 pb-6 pt-3 sm:gap-5 sm:px-5 lg:gap-6 lg:px-6">
          <aside
            className={`no-print panel sticky top-3 hidden h-[calc(100vh-1.5rem)] shrink-0 overflow-hidden rounded-2xl transition-[width] duration-200 lg:block ${
              collapsed ? "w-16" : "w-60"
            }`}
          >
            <Suspense fallback={null}>
              <Rail identity={identity} nav={nav} org={org} collapsed={collapsed} onToggle={toggle} consoleHref={consoleHref} />
            </Suspense>
          </aside>

          <div className="flex min-w-0 flex-1 flex-col">
            {/* Floating controls on the artwork — no bar, no slab, no border.
                WHERE you are on the left and WHO you are on the right, at
                opposite ends of one line, because those are the two facts that
                qualify everything on the page beneath them.

                The strap sits on a `.panel` rather than on the artwork. In the
                old shell it was bare text over a photograph and it disappeared
                wherever the photograph happened to be pale. */}
            <div className="no-print mb-3 flex h-10 shrink-0 items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <button
                  type="button"
                  onClick={() => setDrawer(true)}
                  className="panel flex items-center justify-center rounded-xl p-2 text-[color:var(--ink-muted)] transition-colors hover:text-[color:var(--ink)] lg:hidden"
                  aria-label="Open navigation"
                >
                  <Menu className="h-4 w-4" />
                </button>
                <p className="panel hidden min-w-0 items-center gap-2 truncate rounded-xl px-3 py-2 text-[11px] font-medium text-[color:var(--ink-muted)] sm:flex">
                  <span
                    aria-hidden
                    className="h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{ backgroundColor: identity.accent }}
                  />
                  <span className="truncate font-semibold text-[color:var(--ink)]">{org.name}</span>
                  <span className="truncate">{identity.strap}</span>
                </p>
              </div>
              <div className="flex items-center gap-2">
                {headerRight}
                <SkinMenu systemId={identity.id} accent={identity.accent} />
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
            </div>

            {/* Capped and centred: on a wide screen the artwork breathes on BOTH
                sides of the page, not just in the gutters. */}
            <main className={`canvas mx-auto w-full flex-1 rounded-2xl ${CANVAS_WIDTH[identity.canvas ?? "wide"]}`}>
              {children}
            </main>
          </div>
        </div>
      </div>

      {/* Mobile drawer. `bg-paper`, not a hex — this is the one surface that used
          to be `#15141b` in both themes and therefore looked deliberate in
          neither. */}
      {drawer && (
        <div className="no-print fixed inset-0 z-50 lg:hidden">
          <div aria-hidden className="absolute inset-0 bg-zinc-950/40 backdrop-blur-sm" onClick={() => setDrawer(false)} />
          <div className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-paper shadow-2xl">
            <button
              type="button"
              onClick={() => setDrawer(false)}
              aria-label="Close navigation"
              className="absolute right-2 top-2 z-10 rounded-lg bg-paper/80 p-2 text-[color:var(--ink-muted)] shadow-sm hover:bg-[color:var(--ink)]/5"
            >
              <X className="h-4 w-4" />
            </button>
            <div className="min-h-0 flex-1 pt-1">
              <Suspense fallback={null}>
                <Rail identity={identity} nav={nav} org={org} collapsed={false} consoleHref={consoleHref} onNavigate={() => setDrawer(false)} />
              </Suspense>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * The lender's mark, at the head of their own navigation.
 *
 * Lifted from the console's Sidebar deliberately and not adapted: it is the
 * thing the founder pointed at, and two letterhead cards that are ALMOST the
 * same is worse than one that is copied. It sits on a solid white card because
 * lenders upload transparent PNGs designed against white letterhead; floated
 * onto artwork they land on whatever wave is in that corner and look broken.
 *
 * `logoScale` grows the img's LAYOUT box, not `transform: scale()` — a transform
 * cannot escape the frame's `overflow-hidden`, so on a tightly-cropped logo the
 * old dial just zoom-cropped inside the same rectangle and appeared to do
 * nothing. Collapsed keeps the transform: a 36px tile has no room to grow.
 */
function BrandBlock({
  org, identity, collapsed, onNavigate, href,
}: {
  org: SuiteOrg;
  identity: SuiteIdentity;
  collapsed: boolean;
  onNavigate?: () => void;
  href: string;
}) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-label={`${org.name} — ${identity.name} home`}
      title={org.name}
      className={`flex min-w-0 flex-1 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-[color:var(--ink)]/[0.06] bg-white shadow-sm transition-all ${
        collapsed ? "h-12 px-1.5" : "min-h-36 px-2 py-2.5"
      }`}
    >
      {org.logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={org.logoUrl}
          alt={`${org.name} logo`}
          className={`w-full object-contain ${collapsed ? "max-h-9" : ""}`}
          style={collapsed
            ? { transform: `scale(${(org.logoScale ?? 100) / 100})` }
            : { maxHeight: `${Math.min(150, (150 * (org.logoScale ?? 100)) / 100)}px` }}
        />
      ) : collapsed ? (
        <span
          className="flex h-9 w-9 items-center justify-center rounded-lg text-sm font-bold text-white"
          style={{ background: `linear-gradient(135deg, ${identity.accent}, ${identity.accent2 ?? identity.accent})` }}
        >
          {org.name.slice(0, 1).toUpperCase()}
        </span>
      ) : (
        <span className="flex min-w-0 items-center gap-2.5">
          <span
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-sm font-bold text-white"
            style={{ background: `linear-gradient(135deg, ${identity.accent}, ${identity.accent2 ?? identity.accent})` }}
          >
            {org.name.slice(0, 1).toUpperCase()}
          </span>
          {/* zinc-900, not an ink token: this card is white in BOTH themes — it
              is the lender's letterhead, not a surface of ours — so its text
              must not invert with the ramp. */}
          <span className="truncate text-sm font-bold text-zinc-900">{org.name}</span>
        </span>
      )}
    </Link>
  );
}

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

  // Where the letterhead links. The system's own front page, not the console's:
  // clicking a lender's mark inside ConnectDesk should go to the top of
  // ConnectDesk, the way it goes to the top of the console inside the console.
  const home = nav[0]?.items[0]?.href ?? consoleHref;

  return (
    <nav aria-label={identity.name} className="flex h-full flex-col">
      {/* The letterhead heads the column, in the very corner of the screen, with
          the collapse control as a slim tab of the same white card at its side —
          one object, two panes. Collapsed, the tab drops underneath so the
          narrow column stays a single clean stack. */}
      <div className={`mx-2 mb-2 mt-2 flex shrink-0 gap-1.5 ${collapsed ? "flex-col" : "items-stretch"}`}>
        <BrandBlock org={org} identity={identity} collapsed={collapsed} onNavigate={onNavigate} href={home} />
        {onToggle && (
          <button
            type="button"
            onClick={onToggle}
            aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
            title={collapsed ? "Expand" : "Collapse"}
            className={`flex shrink-0 items-center justify-center rounded-xl border border-[color:var(--ink)]/[0.06] bg-white text-zinc-400 shadow-sm transition-colors hover:bg-zinc-50 hover:text-zinc-700 ${
              collapsed ? "h-8 w-full" : "w-7"
            }`}
          >
            {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          </button>
        )}
      </div>

      {/* WHICH SYSTEM THIS IS. The console needs no such line — it is the
          anchor, and its letterhead is the whole statement. A satellite does:
          five products share this chrome, and the name plus the accent bar is
          how you know from the corner of your eye which one you are standing
          in. It is the ONLY chrome that differs between them. */}
      {!collapsed && (
        <div className="mx-2 mb-1 shrink-0 px-1">
          <p className="truncate text-[12px] font-bold leading-tight text-[color:var(--ink)]">{identity.name}</p>
          <span
            aria-hidden
            className="mt-1.5 block h-[3px] w-10 rounded-full"
            style={{ background: `linear-gradient(90deg, ${identity.accent}, ${identity.accent2 ?? identity.accent})` }}
          />
        </div>
      )}
      {collapsed && (
        <span
          aria-hidden
          className="mx-auto mb-1 block h-[3px] w-6 shrink-0 rounded-full"
          style={{ background: `linear-gradient(90deg, ${identity.accent}, ${identity.accent2 ?? identity.accent})` }}
        />
      )}

      <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2 pb-3 pt-1">
        {nav.map((mod) => (
          <div key={mod.key} className="mb-1">
            {!collapsed && <p className="t-label px-2.5 pb-1 pt-2.5">{mod.label}</p>}
            {collapsed && <div className="mx-3 my-2 h-px bg-[color:var(--ink)]/10" aria-hidden />}
            <div className="space-y-0.5">
              {mod.items.map((item) => {
                const Icon = navIcon(item.icon);
                const active = isActive(item.href, item.exact);
                const dead = item.ready === false;

                const cls = `group flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium transition-colors ${
                  active
                    ? "text-white shadow-sm"
                    : dead
                      ? "cursor-default opacity-55 text-[color:var(--ink-body)]"
                      : "text-[color:var(--ink-body)] hover:bg-[color:var(--ink)]/[0.055] hover:text-[color:var(--ink)]"
                } ${collapsed ? "justify-center px-0" : ""}`;
                const style = active ? { backgroundColor: identity.accent } : undefined;

                const inner = (
                  <>
                    <Icon
                      className={`h-4 w-4 shrink-0 ${active ? "" : "text-[color:var(--ink-faint)] group-hover:text-[color:var(--ink-body)]"}`}
                      aria-hidden
                    />
                    {!collapsed && (
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{item.label}</span>
                        {/* The blurb only on the active row. It answers "what is
                            this screen for" at the moment you are looking at it,
                            and stays out of the way of scanning the rest. */}
                        {active && (
                          <span className="mt-0.5 block truncate text-[10px] font-normal leading-tight text-white/70">
                            {item.blurb}
                          </span>
                        )}
                      </span>
                    )}
                    {!collapsed && item.badge != null && item.badge !== "" && (
                      <span
                        className="ml-auto shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-bold tabular-nums text-white"
                        style={{ backgroundColor: active ? "rgba(255,255,255,0.24)" : identity.accent }}
                      >
                        {item.badge}
                      </span>
                    )}
                    {!collapsed && dead && (
                      <span className="ml-auto shrink-0 rounded bg-[color:var(--ink)]/5 px-1.5 py-0.5 text-[9px] font-semibold text-[color:var(--ink-faint)]">
                        SOON
                      </span>
                    )}
                  </>
                );

                if (dead) {
                  return (
                    <div key={item.key} className={cls} title={`${item.blurb} — shipping soon`}>
                      {inner}
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
                    style={style}
                  >
                    {inner}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* The way back. Every satellite can return you to the tool the numbers are
          made in; a system with no exit is a dead end. */}
      <div className="shrink-0 border-t border-[color:var(--ink)]/[0.07] p-2">
        <Link
          href={consoleHref}
          onClick={onNavigate}
          className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[12px] font-medium text-[color:var(--ink-muted)] transition-colors hover:bg-[color:var(--ink)]/[0.055] hover:text-[color:var(--ink)] ${
            collapsed ? "justify-center px-0" : ""
          }`}
          title="Back to the lending console"
        >
          <ArrowUpRight className="h-4 w-4 shrink-0" />
          {!collapsed && <span className="truncate">Lending console</span>}
        </Link>
      </div>
    </nav>
  );
}
