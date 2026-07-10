"use client";

// The top bar. Two invariants the founder set, honored at every width:
//   · the org's logo sits at the FAR LEFT at all times, linking home;
//   · the profile menu sits at the FAR RIGHT whenever someone is signed in.
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

export function OrgLogo({ org, size = 8 }: { org: Pick<ShellOrg, "name" | "logoUrl">; size?: 8 | 9 }) {
  const px = size === 9 ? "h-9 w-9" : "h-8 w-8";
  if (org.logoUrl) {
    // Org logos are tiny and often data-URLs (simulation mode) or public-bucket
    // URLs; next/image adds nothing here but a remotePatterns config burden.
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={org.logoUrl} alt={`${org.name} logo`} className={`${px} shrink-0 rounded-lg object-contain`} />;
  }
  return (
    <div className={`${px} flex shrink-0 items-center justify-center rounded-lg text-sm font-bold text-white`} style={{ backgroundColor: "var(--brand)" }}>
      {org.name.slice(0, 1)}
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
  return (
    <header className="no-print sticky top-0 z-30 border-b border-zinc-900/10 bg-white/70 backdrop-blur-xl">
      <div className="flex h-14 items-center gap-2 px-3 sm:px-4">
        {/* Far left: the org's own logo, always. */}
        <Link href="/console" className="flex min-w-0 items-center gap-2.5" aria-label={`${org.name} — console home`}>
          <OrgLogo org={org} />
          <div className="min-w-0 hidden min-[400px]:block">
            <p className="truncate text-sm font-bold leading-tight text-zinc-900">{org.name}</p>
            <p className="truncate text-[10px] leading-tight text-zinc-500">
              {org.slug}.birgenai.com · {org.mode === "NATIVE" ? "Native book" : "Bridged (ServiceSuite)"}
            </p>
          </div>
        </Link>

        {/* Sidebar controls sit AFTER the logo so the logo keeps the corner. */}
        <button
          type="button"
          onClick={onOpenDrawer}
          className="ml-1 rounded-lg border border-zinc-900/10 bg-white/70 p-2 text-zinc-600 hover:bg-white lg:hidden"
          aria-label="Open navigation"
        >
          <Menu className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={onToggleSidebar}
          className="ml-1 hidden rounded-lg border border-zinc-900/10 bg-white/70 p-2 text-zinc-600 hover:bg-white lg:block"
          aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
        >
          {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
        </button>

        <div className="flex-1" />

        {org.status !== "ACTIVE" && (
          <span className="hidden rounded-md bg-amber-100 px-2 py-1 text-[11px] font-semibold text-amber-700 sm:inline-block">
            <ShieldCheck className="-mt-0.5 mr-1 inline h-3 w-3" />
            Pending activation
          </span>
        )}

        {/* Far right: the authenticated profile, always. */}
        <ProfileMenu name={user.name} email={user.email} role={user.role} />
      </div>
    </header>
  );
}
