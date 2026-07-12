"use client";

// ─────────────────────────────────────────────────────────────────────────────
// THE CONSOLE CHROME — one background, and things floating on it.
//
// The old shell was three rectangles that happened to touch: a white bar, a white
// sidebar, and a page. Each had its own border, and the artwork was only visible
// in whatever the page didn't cover. It looked like three components, because it
// was three components.
//
// Now there is one surface — the lender's background — and everything else hovers
// over it on the same glass, with air between: the logo in the corner, the nav
// panel, the page canvas, and Riri, all the same material at the same altitude.
// That is the whole trick, and it is why it reads as one product.
//
// The CANVAS is also load-bearing, not decoration. The background is a photograph
// with grey waves in it, so text laid directly on it was legible in some places and
// invisible in others depending on where the sentence happened to fall. Content sits
// on the canvas; the canvas is a known quantity; contrast becomes a property of the
// system instead of a matter of luck. (See globals.css.)
//
// The server layout computes WHO sees WHAT (rights × plan) and hands this shell a
// pre-filtered tree; all that lives here is presentation state — the desktop
// collapse toggle and the mobile drawer.
// ─────────────────────────────────────────────────────────────────────────────
import { Suspense, useEffect, useState } from "react";
import { useLoad } from "@/lib/hooks/useLoad";
import { X } from "lucide-react";
import type { NavModule } from "@/lib/nav/registry";
import Sidebar from "./Sidebar";
import TopBar, { OrgLogo, type ShellOrg, type ShellUser } from "./TopBar";
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
        <TopBar
          org={org}
          user={user}
          collapsed={collapsed}
          onToggleSidebar={toggleCollapsed}
          onOpenDrawer={() => setDrawer(true)}
        />

        {/* The gap is the design. Chrome and page float apart, and the artwork runs
            between them and around the edges of the screen. */}
        <div className="flex flex-1 gap-3 px-3 pb-3 sm:px-4 sm:pb-4">
          <aside
            className={`no-print panel sticky top-[4.5rem] hidden h-[calc(100vh-5.5rem)] shrink-0 overflow-hidden rounded-2xl transition-[width] duration-200 lg:block ${
              collapsed ? "w-14" : "w-60"
            }`}
          >
            <Suspense fallback={null}>
              <Sidebar nav={nav} collapsed={collapsed} />
            </Suspense>
          </aside>

          <main className="canvas min-w-0 flex-1 rounded-2xl">{children}</main>
        </div>
      </div>

      {/* Mobile drawer */}
      {drawer && (
        <div className="no-print fixed inset-0 z-50 lg:hidden">
          <div aria-hidden className="absolute inset-0 bg-zinc-950/40 backdrop-blur-sm" onClick={() => setDrawer(false)} />
          <div className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-white shadow-2xl">
            <div className="flex h-16 items-center justify-between border-b border-zinc-900/8 px-4">
              <OrgLogo org={org} size="lg" />
              <button type="button" onClick={() => setDrawer(false)} aria-label="Close navigation" className="rounded-lg p-2 text-zinc-500 hover:bg-zinc-900/5">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="min-h-0 flex-1">
              <Suspense fallback={null}>
                <Sidebar nav={nav} collapsed={false} onNavigate={() => setDrawer(false)} />
              </Suspense>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
