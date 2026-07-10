"use client";

// The console chrome: fixed left nav + sticky top bar around every module page.
// The server layout computes WHO sees WHAT (rights × plan) and hands this shell
// a pre-filtered tree; all that lives here is presentation state — the desktop
// collapse toggle and the mobile drawer.
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
    <div className="min-h-screen text-zinc-900">
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

        <div className="flex flex-1">
          {/* Desktop sidebar */}
          <aside
            className={`no-print sticky top-14 hidden h-[calc(100vh-3.5rem)] shrink-0 border-r border-zinc-900/10 bg-white/60 backdrop-blur-xl transition-[width] lg:block ${
              collapsed ? "w-14" : "w-60"
            }`}
          >
            <Suspense fallback={null}>
              <Sidebar nav={nav} collapsed={collapsed} />
            </Suspense>
          </aside>

          <main className="min-w-0 flex-1">{children}</main>
        </div>
      </div>

      {/* Mobile drawer */}
      {drawer && (
        <div className="no-print fixed inset-0 z-50 lg:hidden">
          <div aria-hidden className="absolute inset-0 bg-zinc-950/40" onClick={() => setDrawer(false)} />
          <div className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-white shadow-2xl">
            <div className="flex h-14 items-center justify-between border-b border-zinc-900/10 px-3">
              <div className="flex min-w-0 items-center gap-2.5">
                <OrgLogo org={org} />
                <p className="truncate text-sm font-bold">{org.name}</p>
              </div>
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
