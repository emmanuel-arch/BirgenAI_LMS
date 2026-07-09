"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import {
  Users, FileText, Banknote, Route, ScanFace, Gauge, ArrowRight, Loader2, Copy, Check,
  Building2, UserRound, ShieldCheck, Landmark,
} from "lucide-react";

// Guided demo: one-click sign in as any role, or open the borrower journeys.
// Everything is wired to the seeded "BirgenAI Demo Microfinance" org and its
// closed ML loop. Password is intentionally public — this is a sandbox.
const PASSWORD = "Demo1234!";

const ROLES = [
  { email: "admin@demo.birgenai.com", name: "Amina Yusuf", role: "Org Admin", icon: Building2, shows: "Everything: vault, products, workflows, team, platform view", tone: "#6d28d9" },
  { email: "officer@demo.birgenai.com", name: "Brian Otieno", role: "Loan Officer", icon: FileText, shows: "Application queue, AI pre-screen + SHAP reasons, tier-1 approvals", tone: "#3b82f6" },
  { email: "manager@demo.birgenai.com", name: "Carol Njeri", role: "Branch Manager", icon: Users, shows: "Second-tier approvals, branch dashboard", tone: "#0ea5e9" },
  { email: "risk@demo.birgenai.com", name: "David Kimani", role: "Credit Risk Manager", icon: Gauge, shows: "Final approvals (OTP), portfolio risk, PAR", tone: "#10b981" },
  { email: "finance@demo.birgenai.com", name: "Esther Wafula", role: "Finance Officer", icon: Banknote, shows: "Maker-checker disbursement, float ledger, reconciliation", tone: "#f59e0b" },
  { email: "ro1@demo.birgenai.com", name: "Felix Barasa", role: "Relationship Officer", icon: Route, shows: "Field route planner — nearest-agent visits, verify on the ground", tone: "#e11d48" },
];

const BORROWERS = [
  { name: "Joyce Wanjiru", phone: "0712000001", nid: "29381746", tag: "3 loans cleared · score 742", journey: "returning" },
  { name: "Lucy Chebet", phone: "0712000003", nid: "27461829", tag: "Graduated (5 cleared) · self-service", journey: "returning" },
  { name: "Martin Kariuki", phone: "0712000004", nid: "33019284", tag: "In arrears · overdue installment", journey: "myloan" },
  { name: "New applicant", phone: "0799123456", nid: "12345678", tag: "Never borrowed — full KYC onboarding", journey: "new" },
];

export default function DemoPage() {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const signInAs = async (email: string) => {
    setBusy(email); setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password: PASSWORD, orgSlug: "demo" }),
      });
      const data = await res.json();
      if (!data.success) { setError(data.message || "Could not sign in."); return; }
      router.push("/console");
    } catch { setError("Could not sign in."); } finally { setBusy(null); }
  };

  const copy = (text: string, key: string) => {
    navigator.clipboard?.writeText(text); setCopied(key); setTimeout(() => setCopied(null), 1500);
  };

  return (
    <div className="min-h-screen relative text-zinc-900" style={{ ["--brand" as never]: "#6d28d9", ["--brand-soft" as never]: "rgba(109,40,217,0.12)" }}>
      <div aria-hidden className="fixed inset-0 z-0 bg-[url('/images/white-background.png')] bg-cover bg-center" />
      <main className="relative z-10 mx-auto max-w-5xl px-4 sm:px-6 py-10">
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
          <div className="inline-flex items-center gap-1.5 rounded-full bg-[var(--brand-soft)] px-3 py-1 text-[11px] font-semibold" style={{ color: "var(--brand)" }}>
            <ShieldCheck className="h-3.5 w-3.5" /> Guided sandbox · BirgenAI Demo Microfinance
          </div>
          <h1 className="mt-4 text-3xl font-bold sm:text-4xl">See the whole platform, from every seat.</h1>
          <p className="mt-3 max-w-2xl text-zinc-600">
            A fully-seeded lender: real borrowers across the lifecycle, live loans, a geolocated field team, and
            a closed machine-learning loop with realised repayment outcomes. Sign in as any role — one click, no setup.
          </p>
          <p className="mt-2 text-xs text-zinc-400">Shared password <button onClick={() => copy(PASSWORD, "pw")} className="font-mono font-semibold text-zinc-600 underline">{PASSWORD}</button> {copied === "pw" && "✓ copied"}</p>
        </motion.div>

        {error && <div className="mt-4 rounded-lg border border-red-300 bg-red-50/90 px-3 py-2.5 text-sm text-red-700">{error}</div>}

        {/* Staff roles */}
        <h2 className="mt-9 flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-zinc-500"><Users className="h-4 w-4" /> Staff — sign in as a role</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {ROLES.map((r, i) => (
            <motion.div key={r.email} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}
              className="glass p-4 flex flex-col">
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl text-white shrink-0" style={{ backgroundColor: r.tone }}><r.icon className="h-4.5 w-4.5" /></div>
                <div className="min-w-0">
                  <p className="text-sm font-bold truncate">{r.role}</p>
                  <p className="text-[11px] text-zinc-500 truncate">{r.name}</p>
                </div>
              </div>
              <p className="mt-2.5 flex-1 text-xs leading-relaxed text-zinc-600">{r.shows}</p>
              <div className="mt-3 flex items-center gap-2">
                <button onClick={() => signInAs(r.email)} disabled={!!busy}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold text-white disabled:opacity-60" style={{ backgroundColor: "var(--brand)" }}>
                  {busy === r.email ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowRight className="h-3.5 w-3.5" />} Sign in
                </button>
                <button onClick={() => copy(r.email, r.email)} className="rounded-lg border border-zinc-900/15 bg-white/70 p-2 text-zinc-500 hover:bg-white" title="Copy email">
                  {copied === r.email ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                </button>
              </div>
            </motion.div>
          ))}
        </div>

        {/* Borrower journeys */}
        <h2 className="mt-9 flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-zinc-500"><UserRound className="h-4 w-4" /> Borrowers — walk the customer journeys</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {BORROWERS.map((b) => (
            <div key={b.phone} className="glass p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-bold">{b.name}</p>
                <span className="rounded-md bg-zinc-900/5 px-2 py-0.5 text-[10px] font-semibold text-zinc-600">{b.tag}</span>
              </div>
              <p className="mt-1 text-[11px] text-zinc-500">Phone {b.phone} · ID {b.nid}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {b.journey === "new" && (
                  <>
                    <Link href="/verify?lender=demo" className="demo-pill"><ScanFace className="h-3.5 w-3.5" /> Elite KYC</Link>
                    <Link href="/?lender=demo" className="demo-pill"><FileText className="h-3.5 w-3.5" /> Apply for a loan</Link>
                  </>
                )}
                {b.journey === "returning" && (
                  <>
                    <Link href="/?lender=demo" className="demo-pill"><FileText className="h-3.5 w-3.5" /> Apply (recognized)</Link>
                    <Link href="/myloan?lender=demo" className="demo-pill"><Landmark className="h-3.5 w-3.5" /> My loan</Link>
                  </>
                )}
                {b.journey === "myloan" && (
                  <Link href="/myloan?lender=demo" className="demo-pill"><Landmark className="h-3.5 w-3.5" /> My loan · Pay now</Link>
                )}
              </div>
            </div>
          ))}
        </div>

        <p className="mt-8 text-center text-xs text-zinc-400">
          Credentialed services (Smile ID, Daraja, CRB, SMS) run in high-fidelity <span className="font-semibold">simulation</span> until real keys are added in Settings → Vault — so the demo behaves exactly like production.
        </p>
      </main>

      <style jsx>{`
        :global(.demo-pill) {
          display: inline-flex; align-items: center; gap: 0.375rem;
          border-radius: 0.5rem; border: 1px solid rgba(0,0,0,0.1);
          background: rgba(255,255,255,0.7); padding: 0.5rem 0.75rem;
          font-size: 0.75rem; font-weight: 600; color: #3f3f46;
        }
        :global(.demo-pill:hover) { background: #fff; }
      `}</style>
    </div>
  );
}
