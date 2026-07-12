"use client";

// The left navigation — enterprise-style module groups with sub-items, rendered
// from the tree the server layout already filtered by role rights + plan.
// Active-state is scored (query match > exact > longest prefix) so exactly one
// item highlights even when deep links share a pathname.
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useState } from "react";
import { useLoad } from "@/lib/hooks/useLoad";
import { ChevronDown } from "lucide-react";
import type { NavModule, NavItem } from "@/lib/nav/registry";
import { navIcon } from "./icons";

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
  collapsed,
  onNavigate,
}: {
  nav: NavModule[];
  collapsed: boolean;
  /** Called on any link click — the mobile drawer closes itself with this. */
  onNavigate?: () => void;
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
    <nav aria-label="Console" className="flex h-full flex-col gap-0.5 overflow-y-auto px-2 py-3">
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
    </nav>
  );
}
