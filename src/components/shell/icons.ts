// Lucide icons the nav registry may name. The registry stores icon NAMES so the
// server layout can serialize the filtered tree; this map turns them back into
// components client-side. An unknown name falls back to a dot, never a crash.
import {
  LayoutDashboard, Gauge, Users, UserPlus, ShieldCheck, FileText, FileClock, Landmark,
  FilePlus2, Banknote, Wallet, HandCoins, Scale, PhoneCall, CalendarClock, BrainCircuit,
  SlidersHorizontal, ScanLine, FileBarChart, MapPin, MessageSquare, Building2, Package,
  GitBranch, Palette, Settings2, KeyRound, Crown, Bot, Ticket, Mail, Ruler, LifeBuoy,
  Calculator, Target, LineChart, Circle, type LucideIcon,
} from "lucide-react";

const ICONS: Record<string, LucideIcon> = {
  LayoutDashboard, Gauge, Users, UserPlus, ShieldCheck, FileText, FileClock, Landmark,
  FilePlus2, Banknote, Wallet, HandCoins, Scale, PhoneCall, CalendarClock, BrainCircuit,
  SlidersHorizontal, ScanLine, FileBarChart, MapPin, MessageSquare, Building2, Package,
  GitBranch, Palette, Settings2, KeyRound, Crown, Bot, Ticket, Mail, Ruler, LifeBuoy,
  Calculator, Target, LineChart,
};

export function navIcon(name: string): LucideIcon {
  return ICONS[name] ?? Circle;
}
