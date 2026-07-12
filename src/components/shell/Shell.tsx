"use client";

// ─────────────────────────────────────────────────────────────────────────────
// THE CONSOLE CHROME — one background, and things floating on it.
//
// There is no bar across the top any more. The old layout hung a 56px control
// strip over the whole width and started the sidebar underneath it, so the
// entire product sat 4rem down from the top edge — the founder's phrase was
// "sagging its trousers". Now the SIDEBAR runs to the very top: the lender's
// letterhead card is the first thing in the top-left corner of the screen, with
// the collapse control as a slim tab at its side (see Sidebar). The only chrome
// on the right is a floating profile pill — and on mobile, the drawer button —
// sitting directly on the artwork.
//
// The page canvas is deliberately NARROWER than the space it sits in: capped
// and centred, with real gutters, so the artwork shows on every side of it
// instead of only in a 12px seam. The background is the product's signature;
// give it room.
//
// The CANVAS is also load-bearing, not decoration. The background is a
// photograph with grey waves in it, so text laid directly on it was legible in
// some places and invisible in others. Content sits on the canvas; the canvas
// is a known quantity; contrast is a property of the system instead of luck.
// (See globals.css.)
//
// The server layout computes WHO sees WHAT (rights × plan) and hands this shell
// a pre-filtered tree; all that lives here is presentation state — the desktop
// collapse toggle and the mobile drawer.
// ─────────────────────────────────────────────────────────────────────────────
import { Suspense, useEffect, useState } from "react";
import { useLoad } from "@/lib/hooks/useLoad";
import { Menu, ShieldCheck, X } from "lucide-react";
import type { NavModule } from "@/lib/nav/registry";
import type { ShellOrg, ShellUser } from "./types";
import Sidebar from "./Sidebar";
import ProfileMenu from "./ProfileMenu";
import ImpersonationBanner from "./ImpersonationBanner";

export default function Shell({
  nav,
  org,
  user,
  impersonator,
  children,
}: {
  nav: NavModule[];
  org: ShellOrg;
  user: ShellUser;
  impersonator?: { name: string } | null;
  children: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [drawer, setDrawer] = useState(false);

  // Hydrate the persisted preference after mount (SSR has no localStorage).
  useLoad(() => {
    try { setCollapsed(localStorage.getItem("lms:nav-collapsed") === "1"); } catch { /* private mode */ }
  });
  const toggleCollapsed = () => {
    setCollapsed((v) => {
      try { localStorage.setItem("lms:nav-collapsed", v ? "0" : "1"); } catch { /* private mode */ }
      return !v;
    });
  };

  // Drawer traps scroll while open (mobile).
  useEffect(() => {
    document.body.style.overflow = drawer ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [drawer]);

  return (
    <div className="min-h-screen text-[color:var(--ink-body)]">
      <div aria-hidden className="fixed inset-0 z-0 bg-[url('/images/white-background.png')] bg-cover bg-center" />

      <div className="relative z-10 flex min-h-screen flex-col">
        {impersonator && <ImpersonationBanner adminName={impersonator.name} orgName={org.name} />}

        {/* The gap is the design. Chrome and page float apart, and the artwork
            runs between them and around the edges of the screen. */}
        <div className="flex flex-1 gap-3 px-3 pb-6 pt-3 sm:gap-5 sm:px-5 lg:gap-6 lg:px-6">
          <aside
            className={`no-print panel sticky top-3 hidden h-[calc(100vh-1.5rem)] shrink-0 overflow-hidden rounded-2xl transition-[width] duration-200 lg:block ${
              collapsed ? "w-16" : "w-60"
            }`}
          >
            <Suspense fallback={null}>
              <Sidebar nav={nav} org={org} collapsed={collapsed} onToggleCollapse={toggleCollapsed} />
            </Suspense>
          </aside>

          <div className="flex min-w-0 flex-1 flex-col">
            {/* Floating controls on the artwork — drawer button (mobile) left,
                profile far right, nothing else. No slab, no border, no bar. */}
            <div className="no-print mb-3 flex h-10 shrink-0 items-center justify-between gap-2 lg:justify-end">
              <button
                type="button"
                onClick={() => setDrawer(true)}
                className="panel flex items-center justify-center rounded-xl p-2 text-[color:var(--ink-muted)] transition-colors hover:text-[color:var(--ink)] lg:hidden"
                aria-label="Open navigation"
              >
                <Menu className="h-4 w-4" />
              </button>
              <div className="flex items-center gap-2">
                {org.status !== "ACTIVE" && (
                  <span className="panel hidden items-center rounded-xl px-2.5 py-1.5 text-[11px] font-semibold text-amber-700 sm:inline-flex">
                    <ShieldCheck className="mr-1 h-3.5 w-3.5" />
                    Pending activation
                  </span>
                )}
                {/* Far right: the authenticated profile, always. */}
                <ProfileMenu name={user.name} email={user.email} role={user.role} />
              </div>
            </div>

            {/* Capped and centred: on a wide screen the artwork breathes on BOTH
                sides of the page, not just in the gutters. */}
            <main className="canvas mx-auto w-full max-w-6xl flex-1 rounded-2xl">{children}</main>
          </div>
        </div>
      </div>

      {/* Mobile drawer */}
      {drawer && (
        <div className="no-print fixed inset-0 z-50 lg:hidden">
          <div aria-hidden className="absolute inset-0 bg-zinc-950/40 backdrop-blur-sm" onClick={() => setDrawer(false)} />
          <div className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-white shadow-2xl">
            {/* The brand card at the head of the Sidebar is the drawer's header;
                the close button floats over its corner. */}
            <button
              type="button"
              onClick={() => setDrawer(false)}
              aria-label="Close navigation"
              className="absolute right-2 top-2 z-10 rounded-lg bg-white/80 p-2 text-zinc-500 shadow-sm hover:bg-zinc-900/5"
            >
              <X className="h-4 w-4" />
            </button>
            <div className="min-h-0 flex-1 pt-1">
              <Suspense fallback={null}>
                <Sidebar nav={nav} org={org} collapsed={false} onNavigate={() => setDrawer(false)} />
              </Suspense>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
