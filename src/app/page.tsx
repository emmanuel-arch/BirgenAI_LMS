import { Banknote, Gauge, ShieldCheck, Building2, Bot, MapPin } from "lucide-react";

// Placeholder landing — Phase 1 replaces this with the ported borrower portal
// (subdomain-scoped white-label wizard). Kept server-rendered and static.
const PILLARS = [
  { icon: Gauge, title: "Explainable scoring", text: "Thin-file cashflow + origination engines, fused — with SHAP reasons on every decision." },
  { icon: ShieldCheck, title: "Elite KYC", text: "ID capture, liveness, face match, IPRS and a standardized white-background portrait." },
  { icon: Building2, title: "Your own organization", text: "Branches, roles, products, workflows, paybill, SMS — isolated per lender, configured in minutes." },
  { icon: Banknote, title: "Money that moves", text: "STK collections, C2B receipting, maker-checker B2C disbursement and float control." },
  { icon: MapPin, title: "Field, digitized", text: "Geo-pinned verification visits and route planning — the RO becomes an API." },
  { icon: Bot, title: "Riri intelligence", text: "Talk to your portfolio: OLB, PAR, due-today — grounded, tenant-scoped, audited." },
];

export default function Home() {
  return (
    <main className="flex-1 px-5 py-14 sm:py-20">
      <div className="mx-auto w-full max-w-4xl">
        <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: "var(--brand)" }}>
          BirgenAI_LMS
        </p>
        <h1 className="mt-3 text-3xl font-bold leading-tight text-zinc-900 sm:text-5xl">
          The AI-native loan management platform for licensed lenders.
        </h1>
        <p className="mt-4 max-w-2xl text-zinc-600">
          One platform, many lenders: BirgenAI Hub, Micromart, Axe and Buy Simu run here today —
          your organization can too. Borrowers get a Tala-grade experience; your officers get an
          intelligence-first console. BirgenAI is the technology provider; the licensed lender is
          always the lender of record.
        </p>

        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {PILLARS.map(({ icon: Icon, title, text }) => (
            <div key={title} className="glass p-5">
              <Icon className="h-6 w-6" style={{ color: "var(--brand)" }} aria-hidden />
              <h2 className="mt-3 text-sm font-semibold text-zinc-900">{title}</h2>
              <p className="mt-1 text-sm leading-relaxed text-zinc-600">{text}</p>
            </div>
          ))}
        </div>

        <p className="mt-10 text-xs text-zinc-400">
          Phase 0 scaffold · see <span className="font-mono">docs/LMS-2.0-BLUEPRINT.md</span> for the build plan.
        </p>
      </div>
    </main>
  );
}
