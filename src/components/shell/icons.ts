// Lucide icons the nav registry may name. The registry stores icon NAMES so the
// server layout can serialize the filtered tree; this map turns them back into
// components client-side. An unknown name falls back to a dot, never a crash.
import {
  LayoutDashboard, Gauge, Users, UserPlus, ShieldCheck, FileText, FileClock, Landmark,
  FilePlus2, Banknote, Wallet, HandCoins, Scale, PhoneCall, CalendarClock, BrainCircuit,
  SlidersHorizontal, ScanLine, FileBarChart, MapPin, MessageSquare, Building2, Package,
  GitBranch, Palette, Settings2, KeyRound, Crown, Bot, Ticket, Mail, Ruler, LifeBuoy,
  Calculator, Target, LineChart, Navigation, Send, Map, FileLock2, Coins, MapPinOff, Circle,
  ScrollText, Handshake, Waypoints, Infinity as InfinityIcon, type LucideIcon,
} from "lucide-react";

const ICONS: Record<string, LucideIcon> = {
  LayoutDashboard, Gauge, Users, UserPlus, ShieldCheck, FileText, FileClock, Landmark,
  FilePlus2, Banknote, Wallet, HandCoins, Scale, PhoneCall, CalendarClock, BrainCircuit,
  SlidersHorizontal, ScanLine, FileBarChart, MapPin, MessageSquare, Building2, Package,
  GitBranch, Palette, Settings2, KeyRound, Crown, Bot, Ticket, Mail, Ruler, LifeBuoy,
  Calculator, Target, LineChart, Navigation, Send, Map, FileLock2, Coins, MapPinOff,
  ScrollText, Handshake, Waypoints,
  // `Infinity` is a global in TS, so the import is aliased; the registry still
  // names it "Infinity" like every other lucide icon.
  Infinity: InfinityIcon,
};

export function navIcon(name: string): LucideIcon {
  return ICONS[name] ?? Circle;
}
