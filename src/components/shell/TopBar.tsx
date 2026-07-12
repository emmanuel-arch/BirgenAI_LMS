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
// Now the bar has no background at all. The logo floats directly on the artwork,
// big, in the corner where the sidebar and the top bar meet — the focal point the
// founder asked for — and the only other things up here are controls, each on its
// own floating pane of glass. The same treatment as the Riri dock, and the reason
// it reads as expensive: ONE background, things hovering over it, no seams.
//
// The two invariants survive, because they were always the right ones:
//   · the org's mark sits at the FAR LEFT, and it goes home;
//   · the profile sits at the FAR RIGHT whenever someone is signed in.
// ─────────────────────────────────────────────────────────────────────────────
import Link from "next/link";
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

/**
 * The org's mark, given room to actually be seen — a logo is the most expensive
 * thing a lender owns and it was being rendered at 32px beside its own name in
 * 13px type.
 *
 * An uploaded logo gets NO plate and NO rounding: these are transparent PNGs, and
 * the mark should sit on the background the way it sits on a letterhead. Only the
 * fallback — a lender who hasn't uploaded one yet — gets a coloured tile, because
 * a bare initial floating in space looks like a rendering bug.
 */
export function OrgLogo({ org, size = "md" }: {
  org: Pick<ShellOrg, "name" | "logoUrl">;
  size?: "md" | "lg";
}) {
  const box = size === "lg" ? "h-12 w-12" : "h-9 w-9";
  if (org.logoUrl) {
    // Org logos are tiny and often data-URLs (simulation mode) or public-bucket
    // URLs; next/image adds nothing here but a remotePatterns config burden.
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={org.logoUrl} alt={`${org.name} logo`} className={`${box} shrink-0 object-contain drop-shadow-sm`} />;
  }
  const tile = size === "lg" ? "h-12 w-12 rounded-2xl text-lg" : "h-9 w-9 rounded-xl text-sm";
  return (
    <div className={`${tile} flex shrink-0 items-center justify-center font-bold text-white shadow-sm`} style={{ backgroundColor: "var(--brand)" }}>
      {org.name.slice(0, 1).toUpperCase()}
    </div>
  );
}

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
      <div className="flex h-16 items-center gap-2 px-3 sm:px-4">
        {/* The corner. The logo owns it — at the seam where the two navs meet, sized
            to be the first thing the eye lands on. It is not IN the top bar and it is
            not IN the sidebar; it is the thing they meet at. The width tracks the
            sidebar so the mark stays aligned to the column beneath it. */}
        <Link
          href="/console"
          aria-label={`${org.name} — console home`}
          title={org.name}
          className={`flex shrink-0 items-center transition-[width] duration-200 ${collapsed ? "lg:w-14 lg:justify-center" : "lg:w-60"}`}
        >
          <OrgLogo org={org} size="lg" />
        </Link>

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
