"use client";

// The left navigation — enterprise-style module groups with sub-items, rendered
// from the tree the server layout already filtered by role rights + plan.
// Active-state is scored (query match > exact > longest prefix) so exactly one
// item highlights even when deep links share a pathname.
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useState } from "react";
import { useLoad } from "@/lib/hooks/useLoad";
import { ChevronDown, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import type { NavModule, NavItem } from "@/lib/nav/registry";
import type { ShellOrg } from "./types";
import { navIcon } from "./icons";

/**
 * The lender's mark, at the head of their own navigation — the first thing the
 * eye lands on, and the thing that says "this is OUR system".
 *
 * It sits on a solid white card ON PURPOSE. Lenders upload transparent PNGs that
 * were designed against white letterhead; floated straight onto the artwork they
 * landed on whatever grey wave happened to be in that corner and looked broken.
 * The card is the letterhead. Inside it the logo gets the full width of the
 * column and centres itself — `object-contain` absorbs every aspect ratio a
 * lender can upload, so a wide wordmark and a square crest both fill the frame
 * without distortion and without us needing to know the file's dimensions.
 */
function BrandBlock({ org, collapsed, onNavigate }: { org: ShellOrg; collapsed: boolean; onNavigate?: () => void }) {
  return (
    <Link
      href="/console"
      onClick={onNavigate}
      aria-label={`${org.name} — console home`}
      title={org.name}
      className={`flex min-w-0 flex-1 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-zinc-900/[0.06] bg-white shadow-sm transition-all ${
        collapsed ? "h-12 px-1.5" : "min-h-20 px-4 py-3"
      }`}
    >
      {org.logoUrl ? (
        // Logos are data-URLs in simulation or public-bucket files live;
        // next/image buys nothing here but a remotePatterns config burden.
        //
        // logoScale grows the img's LAYOUT box (the letterhead card grows with it) —
        // NOT transform:scale(). A transform can't escape this frame's overflow-hidden,
        // so on a tightly-cropped logo that already fills its slot the old transform
        // dial just zoom-cropped inside the same rectangle and looked like it did
        // nothing. Width is still the physical cap: a wordmark can never render wider
        // than the rail. Collapsed keeps the transform — a 36px tile has no room to
        // grow, and zoom-crop is the only way to fill it.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={org.logoUrl}
          alt={`${org.name} logo`}
          className={`w-full object-contain ${collapsed ? "max-h-9" : ""}`}
          style={collapsed
            ? { transform: `scale(${(org.logoScale ?? 100) / 100})` }
            : { maxHeight: `${(56 * (org.logoScale ?? 100)) / 100}px` }}
        />
      ) : collapsed ? (
        <span className="flex h-9 w-9 items-center justify-center rounded-lg text-sm font-bold text-white" style={{ backgroundColor: "var(--brand)" }}>
          {org.name.slice(0, 1).toUpperCase()}
        </span>
      ) : (
        <span className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-sm font-bold text-white" style={{ backgroundColor: "var(--brand)" }}>
            {org.name.slice(0, 1).toUpperCase()}
          </span>
          <span className="truncate text-sm font-bold text-[color:var(--ink)]">{org.name}</span>
        </span>
      )}
    </Link>
  );
}

function parseHref(href: string): { base: string; query: [string, string][] } {
  const q = href.indexOf("?");
  if (q < 0) return { base: href, query: [] };
  return { base: href.slice(0, q), query: [...new URLSearchParams(href.slice(q + 1)).entries()] };
}

function scoreItem(item: NavItem, pathname: string, search: URLSearchParams): number {
  if (!item.href) return -1;
  const { base, query } = parseHref(item.href);
  const onPath = item.exact || query.length > 0
    ? pathname === base
    : pathname === base || pathname.startsWith(base + "/");
  if (!onPath) return -1;
  if (query.length > 0) {
    return query.every(([k, v]) => search.get(k) === v) ? 100 + query.length : -1;
  }
  // Exact item on its own path: wins outright with a clean URL; with query params
  // present it stays a candidate (40) but loses to a matching deep link (100).
  if (item.exact) return search.size === 0 ? 50 : 40;
  return base.length;
}

export default function Sidebar({
  nav,
  org,
  collapsed,
  onNavigate,
  onToggleCollapse,
}: {
  nav: NavModule[];
  org: ShellOrg;
  collapsed: boolean;
  /** Called on any link click — the mobile drawer closes itself with this. */
  onNavigate?: () => void;
  /** Desktop only. The collapse control lives BESIDE the letterhead — the logo
      owns the very corner of the screen; the drawer passes nothing and gets no
      toggle (it has its own close button). */
  onToggleCollapse?: () => void;
}) {
  const pathname = usePathname();
  const search = useSearchParams();
  const [closedModules, setClosedModules] = useState<string[]>([]);

  // Hydrate the persisted open/closed state after mount (SSR has no localStorage).
  useLoad(() => {
    try {
      const raw = localStorage.getItem("lms:nav-closed");
      if (raw) setClosedModules(JSON.parse(raw));
    } catch { /* first visit */ }
  });

  const toggleModule = (key: string) => {
    setClosedModules((prev) => {
      const next = prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key];
      try { localStorage.setItem("lms:nav-closed", JSON.stringify(next)); } catch { /* private mode */ }
      return next;
    });
  };

  // One winner across the whole tree, not per module.
  let activeKey: string | null = null;
  let best = -1;
  for (const mod of nav) {
    for (const item of mod.items) {
      const s = scoreItem(item, pathname, search);
      if (s > best) { best = s; activeKey = item.key; }
    }
  }

  return (
    <nav aria-label="Console" className="flex h-full flex-col">
      {/* The letterhead heads the column, in the very corner of the screen, and
          the collapse control sits at its side as a slim tab of the same white
          card — one object, two panes. Collapsed, the tab drops underneath so
          the narrow column stays a single clean stack. */}
      <div className={`mx-2 mt-2 mb-2 flex shrink-0 gap-1.5 ${collapsed ? "flex-col" : "items-stretch"}`}>
        <BrandBlock org={org} collapsed={collapsed} onNavigate={onNavigate} />
        {onToggleCollapse && (
          <button
            type="button"
            onClick={onToggleCollapse}
            aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
            title={collapsed ? "Expand" : "Collapse"}
            className={`flex shrink-0 items-center justify-center rounded-xl border border-zinc-900/[0.06] bg-white text-zinc-400 shadow-sm transition-colors hover:bg-zinc-50 hover:text-zinc-700 ${
              collapsed ? "h-8 w-full" : "w-7"
            }`}
          >
            {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          </button>
        )}
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2 pb-3">
      {nav.map((mod) => {
        const isClosed = collapsed ? false : closedModules.includes(mod.key) && !mod.items.some((i) => i.key === activeKey);
        const single = mod.items.length === 1 && mod.items[0].label.toLowerCase() === mod.label.toLowerCase();
        return (
          <div key={mod.key} className="mb-1">
            {!single && !collapsed && (
              <button
                type="button"
                onClick={() => toggleModule(mod.key)}
                className="t-label flex w-full items-center justify-between rounded-md px-2.5 py-1.5 transition-colors hover:text-[color:var(--ink)]"
              >
                {mod.label}
                <ChevronDown className={`h-3 w-3 transition-transform ${isClosed ? "-rotate-90" : ""}`} />
              </button>
            )}
            {!isClosed && (
              <div className="space-y-0.5">
                {mod.items.map((item) => {
                  const Icon = navIcon(item.icon);
                  const active = item.key === activeKey;
                  const cls = `group flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium transition-colors ${
                    active ? "text-white shadow-sm" : "text-[color:var(--ink-body)] hover:bg-zinc-900/[0.055] hover:text-[color:var(--ink)]"
                  } ${collapsed ? "justify-center px-0" : ""}`;
                  const style = active ? { backgroundColor: "var(--brand)" } : undefined;
                  const inner = (
                    <>
                      <Icon className={`h-4 w-4 shrink-0 ${active ? "" : "text-[color:var(--ink-faint)] group-hover:text-[color:var(--ink-body)]"}`} aria-hidden />
                      {!collapsed && <span className="truncate">{item.label}</span>}
                      {!collapsed && item.ready === false && (
                        <span className="ml-auto rounded bg-zinc-900/5 px-1.5 py-0.5 text-[9px] font-semibold text-[color:var(--ink-faint)]">SOON</span>
                      )}
                    </>
                  );
                  if (item.ready === false) {
                    return (
                      <div key={item.key} title={collapsed ? item.label : undefined} className={`${cls} cursor-default opacity-55`}>
                        {inner}
                      </div>
                    );
                  }
                  if (item.open) {
                    return (
                      <button key={item.key} type="button" data-riri-open={item.open} title={collapsed ? item.label : undefined} className={`${cls} w-full text-left`} onClick={onNavigate}>
                        {inner}
                      </button>
                    );
                  }
                  return (
                    <Link key={item.key} href={item.href!} title={collapsed ? item.label : undefined} className={cls} style={style} onClick={onNavigate}>
                      {inner}
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
      </div>
    </nav>
  );
}
