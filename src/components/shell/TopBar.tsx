"use client";

// ─────────────────────────────────────────────────────────────────────────────
// THE TOP BAR — and the argument for taking almost everything out of it.
//
// It used to be a white slab with a border, carrying the org's logo, the org's
// name, and the org's address ("techcrast.birgenai.com · Native book"). Three
// statements of the same fact, addressed to a person who has just logged into
// their own company's system and is not confused about which one it is. It also
// drew a hard line across the top of the screen, so the console read as three
// separate rectangles — bar, sidebar, page — rather than as one product.
//
// Now the bar has no background at all. The lender's mark lives at the head of
// the SIDEBAR on a white letterhead card (see Sidebar's BrandBlock — transparent
// logos need the surface they were designed for), so the only things up here are
// controls, each on its own floating pane of glass. The same treatment as the
// Riri dock, and the reason it reads as expensive: ONE background, things
// hovering over it, no seams.
//
// The invariant that survives: the profile sits at the FAR RIGHT whenever
// someone is signed in.
// ─────────────────────────────────────────────────────────────────────────────
import { Menu, PanelLeftClose, PanelLeftOpen, ShieldCheck } from "lucide-react";
import ProfileMenu from "./ProfileMenu";

export type ShellOrg = {
  name: string;
  slug: string;
  mode: string; // "NATIVE" | "BRIDGED"
  status: string; // "PENDING" | "ACTIVE" | ...
  logoUrl: string | null;
};

export type ShellUser = {
  name: string;
  email?: string | null;
  role?: string | null;
};

export default function TopBar({
  org,
  user,
  collapsed,
  onToggleSidebar,
  onOpenDrawer,
}: {
  org: ShellOrg;
  user: ShellUser;
  collapsed: boolean;
  onToggleSidebar: () => void;
  onOpenDrawer: () => void;
}) {
  // Every floating control is the same object: one small pane of the same glass.
  const pill = "panel flex items-center justify-center rounded-xl p-2 text-[color:var(--ink-muted)] transition-colors hover:text-[color:var(--ink)]";

  return (
    <header className="no-print sticky top-0 z-30">
      {/* The bar has no slab, but the page still scrolls underneath it. This is the
          compromise that lets both be true: a scrim that is near-white at the very
          top and gone by the bottom, so a heading sliding under the logo is hushed
          instead of colliding with it — and no border, no edge, nothing to see. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 bg-gradient-to-b from-white/80 via-white/45 to-transparent backdrop-blur-[6px] [mask-image:linear-gradient(to_bottom,black_50%,transparent)]"
      />
      <div className="flex h-14 items-center gap-2 px-3 sm:px-4">
        {/* The logo now heads the SIDEBAR, on its own white card — the letterhead
            treatment the founder asked for. Up here only controls remain, each on
            its own pane of glass. */}
        <button type="button" onClick={onOpenDrawer} className={`${pill} lg:hidden`} aria-label="Open navigation">
          <Menu className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={onToggleSidebar}
          className={`${pill} hidden lg:flex`}
          aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
        >
          {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
        </button>

        <div className="flex-1" />

        {org.status !== "ACTIVE" && (
          <span className="panel hidden items-center rounded-xl px-2.5 py-1.5 text-[11px] font-semibold text-amber-700 sm:inline-flex">
            <ShieldCheck className="mr-1 h-3.5 w-3.5" />
            Pending activation
          </span>
        )}

        {/* Far right: the authenticated profile, always. */}
        <ProfileMenu name={user.name} email={user.email} role={user.role} />
      </div>
    </header>
  );
}
