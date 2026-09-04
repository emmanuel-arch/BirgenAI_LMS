// Lucide icons the nav registry may name. The registry stores icon NAMES so the
// server layout can serialize the filtered tree; this map turns them back into
// components client-side. An unknown name falls back to a dot, never a crash.
import {
  LayoutDashboard, Gauge, Users, UserPlus, ShieldCheck, FileText, FileClock, Landmark,
  FilePlus2, Banknote, Wallet, HandCoins, Scale, PhoneCall, CalendarClock, BrainCircuit,
  SlidersHorizontal, ScanLine, FileBarChart, MapPin, MessageSquare, Building2, Package,
  GitBranch, Palette, Settings2, KeyRound, Crown, Bot, Ticket, Mail, Ruler, LifeBuoy,
  Calculator, Target, LineChart, Navigation, Send, Map, FileLock2, Coins, MapPinOff, Circle,
  ScrollText, Handshake, Waypoints, Infinity as InfinityIcon,
  // Named by the Analytics & Reporting's own nav registry (src/lib/analytics/studio-nav.ts).
  // It is a separate system with its own menu, but it resolves icon names through
  // this same map — one fallback, one place to add a name.
  UserCheck, Building, Layers3, Filter, Radio, Compass, Table2, Bookmark,
  TriangleAlert, ArrowLeftRight, Cog, ChartNoAxesCombined, Wrench,
  // Named by the cross-system doors — the customer portal and the ConnectDesk floor.
  Smartphone, Headphones, ArrowUpRight,
  // Named by Customer 360's own section rail, which resolves through this same
  // map. `History` was already being asked for by the Timeline tab and silently
  // falling back to a dot.
  Paperclip, History,
  type LucideIcon,
} from "lucide-react";

const ICONS: Record<string, LucideIcon> = {
  LayoutDashboard, Gauge, Users, UserPlus, ShieldCheck, FileText, FileClock, Landmark,
  FilePlus2, Banknote, Wallet, HandCoins, Scale, PhoneCall, CalendarClock, BrainCircuit,
  SlidersHorizontal, ScanLine, FileBarChart, MapPin, MessageSquare, Building2, Package,
  GitBranch, Palette, Settings2, KeyRound, Crown, Bot, Ticket, Mail, Ruler, LifeBuoy,
  Calculator, Target, LineChart, Navigation, Send, Map, FileLock2, Coins, MapPinOff,
  ScrollText, Handshake, Waypoints,
  UserCheck, Building, Layers3, Filter, Radio, Compass, Table2, Bookmark,
  TriangleAlert, ArrowLeftRight, Cog, ChartNoAxesCombined, Wrench,
  // Named by the cross-system doors — the customer portal and the ConnectDesk floor.
  Smartphone, Headphones, ArrowUpRight,
  Paperclip, History,
  // `Infinity` is a global in TS, so the import is aliased; the registry still
  // names it "Infinity" like every other lucide icon.
  Infinity: InfinityIcon,
};

export function navIcon(name: string): LucideIcon {
  return ICONS[name] ?? Circle;
}
