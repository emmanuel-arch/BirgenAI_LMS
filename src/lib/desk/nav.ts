// ─────────────────────────────────────────────────────────────────────────────
// CONNECTDESK'S OWN NAVIGATION.
//
// Same discipline as the console's registry and the studio's: serializable,
// rights-filtered on the server, and an entry exists exactly when the screen
// behind it exists.
//
// The order is the order a collections day actually runs, which is not the order
// the data model is in:
//
//   1. THE FLOOR      what is happening right now, across every queue
//   2. THE WORK       the queue an agent dials, and the case in front of them
//   3. THE PROMISES   what was committed to, and whether it arrived
//   4. THE PEOPLE     who is on the floor and what they produced
//   5. THE PIPELINE   the Fintech book, and what happens when it is connected
//   6. THE PLUMBING   dispositions, drift, and the shadow queue
//
// A collections floor opens on "where is the money today", not on a settings
// page, so The Floor is the root and everything else hangs off it.
// ─────────────────────────────────────────────────────────────────────────────

import type { Right } from "@/lib/rbac/rights";
import type { SuiteNavModule } from "@/components/suite/SuiteShell";
import { isDenied } from "@/lib/rbac/module-keys";

export type DeskNavItem = SuiteNavModule["items"][number] & {
  right?: Right;
  anyRight?: Right[];
};

export type DeskNavModule = Omit<SuiteNavModule, "items"> & { items: DeskNavItem[] };

export const DESK_NAV: DeskNavModule[] = [
  {
    key: "floor",
    label: "The floor",
    icon: "Radio",
    items: [
      {
        key: "home",
        label: "Live floor",
        href: "/desk",
        icon: "Gauge",
        blurb: "Every queue, every agent, every shilling — as it happens.",
        exact: true,
      },
      {
        key: "activity",
        label: "Activity stream",
        href: "/desk/activity",
        icon: "Waypoints",
        blurb: "Every event across all six systems, newest first.",
      },
    ],
  },
  {
    key: "work",
    label: "The work",
    icon: "PhoneCall",
    items: [
      {
        key: "queue",
        label: "Work queue",
        href: "/desk/queue",
        icon: "Layers3",
        blurb: "The list an agent dials, sorted by what is worth calling.",
      },
      {
        key: "callbacks",
        label: "Callbacks & tasks",
        href: "/desk/tasks",
        icon: "CalendarClock",
        blurb: "What was promised to be done, and when it is due.",
      },
    ],
  },
  {
    key: "promises",
    label: "Promises",
    icon: "Handshake",
    items: [
      {
        key: "ptp",
        label: "Promise board",
        href: "/desk/promises",
        icon: "Handshake",
        blurb: "Taken, kept, broken — and what that says about each agent.",
      },
      {
        key: "recoveries",
        label: "Recoveries",
        href: "/desk/recoveries",
        icon: "Coins",
        blurb: "Money that actually landed, attributed to the agent who earned it.",
      },
    ],
  },
  {
    key: "people",
    label: "The people",
    icon: "Users",
    items: [
      {
        key: "agents",
        label: "Agents",
        href: "/desk/agents",
        icon: "UserCheck",
        blurb: "The floor, ranked by cash — not by dials.",
      },
      {
        key: "phones",
        label: "Phone floor",
        href: "/desk/phones",
        icon: "Radio",
        blurb: "Extensions, seats and the raw PBX trace.",
      },
    ],
  },
  {
    key: "pipeline",
    label: "The pipeline",
    icon: "Waypoints",
    items: [
      {
        key: "fintech",
        label: "Fintech bridge",
        href: "/desk/pipeline",
        icon: "ArrowLeftRight",
        blurb: "Micromart Fintech's book, projected onto this floor.",
        right: "collections.manage",
      },
    ],
  },
  {
    key: "plumbing",
    label: "Plumbing",
    icon: "Wrench",
    items: [
      {
        key: "shadow",
        label: "Write queue",
        href: "/desk/shadow",
        icon: "FileLock2",
        blurb: "Every statement composed for CollectBox, before it runs.",
        right: "collections.manage",
      },
      {
        key: "taxonomy",
        label: "Dispositions",
        href: "/desk/taxonomy",
        icon: "Cog",
        blurb: "The vocabulary this floor runs on, checked against theirs.",
        right: "collections.manage",
      },
    ],
  },
];

/**
 * Filter the tree for one caller.
 *
 * ConnectDesk gates on the collections rights the console already defines rather
 * than inventing a parallel vocabulary — a supervisor who may work the book here
 * is the same supervisor who may work it there, and two answers to that question
 * is one answer too many.
 */
export function deskNavFor(
  rights: ReadonlySet<string>,
  opts: { badges?: Record<string, number | string | null>; denied?: ReadonlySet<string> } = {},
): SuiteNavModule[] {
  const { badges = {}, denied = new Set<string>() } = opts;
  return DESK_NAV.filter((mod) => !isDenied(denied, "callcenter", mod.key))
    .map((mod) => ({
      key: mod.key,
      label: mod.label,
      icon: mod.icon,
      items: mod.items
        .filter((i) => (!i.right || rights.has(i.right)) && (!i.anyRight || i.anyRight.some((r) => rights.has(r))))
        .map((i) => ({ ...i, badge: badges[i.key] ?? null })),
    }))
    .filter((m) => m.items.length > 0);
}

/** ConnectDesk's identity in the suite — rose, its colour on the launcher. */
export const DESK_IDENTITY = {
  id: "callcenter",
  name: "ConnectDesk",
  accent: "#be123c",
  accent2: "#f43f5e",
  strap: "working the live collections floor",
  // A case file is three columns of history beside a disposition pad, and the
  // work queue is a thousand rows. This system earns the width.
  canvas: "wide",
} as const;
