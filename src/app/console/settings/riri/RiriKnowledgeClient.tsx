"use client";

// ─────────────────────────────────────────────────────────────────────────────
// THE RIRI TRAINING CONSOLE.
//
// Four jobs, top to bottom, in the order a lender actually does them:
//
//   1. WHO OWNS THESE FACTS — the KRA PIN, the white-label name, first response on/off.
//   2. WHAT IS LIVE — the packs published now, and the starter pack answering until
//      they publish their own, said plainly because every one of its answers says so.
//   3. THE WORKBENCH — paste or upload a pack, see every problem at once, and ask a
//      test question to read exactly what a customer would be told from the draft.
//   4. HISTORY — every version, and a one-click roll back.
//
// The rule it teaches without a lecture: a pack states facts about the LENDER. The
// validator refuses anything that describes the software, and the error says why.
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useRef, useState } from "react";
import {
  Sparkles, Loader2, AlertCircle, CheckCircle2, Upload, History, RotateCcw, Send, BookOpen, ShieldCheck, Info, Trash2, Wallet,
} from "lucide-react";
import { useLoad } from "@/lib/hooks/useLoad";
import { PageHeader } from "@/components/shell/PageHeader";
import { RiriAvatar } from "@/components/riri/RiriAvatar";
import type { RiriConfig } from "@/lib/config/riri";
import type { Pack } from "@/lib/riri/pack";

type Issue = { at?: string; path?: string; message: string; level?: "error" | "warning" };
type Revision = { version: number; changed: unknown; authorId: string | null; createdAt: string };
type Preview = { answeredFromRecord: boolean; intent: string; outcome: string; answer: string; sources: { id: string; label: string; starter?: boolean }[]; hits: { id: string; label: string; score: number; draft: boolean }[] };

const btn = "inline-flex items-center gap-1.5 rounded-lg border border-ash-900/10 px-3 py-2 text-[13px] font-medium text-ash-700 hover:bg-ash-900/5 disabled:opacity-50";
const primary = "inline-flex items-center gap-1.5 rounded-lg bg-navy px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-50";

export default function RiriKnowledgeClient() {
  const [cfg, setCfg] = useState<RiriConfig | null>(null);
  const [version, setVersion] = useState(0);
  const [history, setHistory] = useState<Revision[]>([]);
  const [starter, setStarter] = useState<Pack | null>(null);
  const [orgName, setOrgName] = useState("your organisation");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [draft, setDraft] = useState("");
  const [checking, setChecking] = useState(false);
  const [check, setCheck] = useState<{ ok: boolean; issues: Issue[]; entries: number } | null>(null);
  const [question, setQuestion] = useState("What fees do you charge?");
  const [previewing, setPreviewing] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const file = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const [c, k] = await Promise.all([
        fetch("/api/config/riri", { cache: "no-store" }).then((r) => r.json()),
        fetch("/api/console/riri/knowledge", { cache: "no-store" }).then((r) => r.json()),
      ]);
      if (!c.success) throw new Error(c.message ?? "Could not load Riri's settings.");
      setCfg(c.value as RiriConfig);
      setVersion(c.version as number);
      setHistory((c.history ?? []) as Revision[]);
      if (k.success) {
        setStarter(k.starter as Pack | null);
        if (k.org?.name) setOrgName(k.org.name);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load Riri's settings.");
    }
  }, []);
  useLoad(load, []);

  const parsedDraft = (): unknown | null => {
    try { return draft.trim() ? JSON.parse(draft) : null; } catch { return null; }
  };

  const publishValue = async (value: RiriConfig, message: string) => {
    setSaving(true); setError(null); setNotice(null);
    try {
      const r = await fetch("/api/config/riri", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ value }) });
      const j = await r.json();
      if (r.status === 422 && Array.isArray(j.issues)) {
        setError(j.issues.map((i: Issue) => `${i.path}: ${i.message}`).join("\n"));
        return false;
      }
      if (!j.success) throw new Error(j.message ?? "Could not publish.");
      setCfg(j.value as RiriConfig);
      setVersion(j.version as number);
      setNotice(`${message} — published as version ${j.version}.`);
      void load();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not publish.");
      return false;
    } finally { setSaving(false); }
  };

  const validate = async () => {
    const pack = parsedDraft();
    if (!pack) { setCheck({ ok: false, entries: 0, issues: [{ message: "That isn't valid JSON yet.", level: "error" }] }); return; }
    setChecking(true);
    try {
      const j = await fetch("/api/console/riri/knowledge", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "validate", pack }) }).then((r) => r.json());
      setCheck({ ok: Boolean(j.ok), issues: (j.issues ?? []) as Issue[], entries: j.entries ?? 0 });
    } finally { setChecking(false); }
  };

  const runPreview = async () => {
    setPreviewing(true);
    try {
      const pack = parsedDraft();
      const j = await fetch("/api/console/riri/knowledge", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "preview", question, ...(pack ? { pack } : {}) }) }).then((r) => r.json());
      if (j.success) setPreview(j as Preview);
    } finally { setPreviewing(false); }
  };

  const publishDraft = async () => {
    const pack = parsedDraft() as Pack | null;
    if (!cfg || !pack || !check?.ok) return;
    const next: RiriConfig = { ...cfg, packs: [...cfg.packs.filter((p) => p.pack !== pack.pack), pack] };
    if (await publishValue(next, `“${pack.pack}” v${pack.version}`)) { setDraft(""); setCheck(null); }
  };

  const rollback = async (v: number) => {
    setSaving(true); setError(null); setNotice(null);
    try {
      const j = await fetch("/api/console/riri/knowledge", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "rollback", version: v }) }).then((r) => r.json());
      if (!j.success) throw new Error(j.message ?? "Could not roll back.");
      setNotice(`Restored version ${v} — now live as version ${j.version}.`);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not roll back."); }
    finally { setSaving(false); }
  };

  const useStarter = () => {
    if (!starter) return;
    const owner = cfg?.member.kraPin ? `KE/LENDER/${cfg.member.kraPin}` : starter.owner;
    setDraft(JSON.stringify({ ...starter, owner, version: Math.max(2, starter.version + 1) }, null, 2));
    setCheck(null);
  };

  if (!cfg) {
    return (
      <div className="space-y-5">
        <PageHeader icon={Sparkles} title="Riri Knowledge" />
        <div className="flex items-center gap-2 rounded-xl border border-ash-900/10 p-4 text-[13px] text-ash-600">
          {error ? <><AlertCircle className="h-4 w-4 text-rose-600" /> {error}</> : <><Loader2 className="h-4 w-4 animate-spin" /> Loading…</>}
        </div>
      </div>
    );
  }

  const starterLive = starter && !cfg.packs.some((p) => p.pack === starter.pack);

  return (
    <div className="space-y-5">
      <PageHeader
        icon={Sparkles}
        title="Riri Knowledge"
        subtitle={`Train Riri on ${orgName}'s own facts. Her voice is ours; the facts are yours, and every answer names the pack and version it came from.`}
      />

      {notice && <p className="flex items-center gap-2 rounded-lg bg-emerald-50 p-3 text-[13px] text-emerald-800"><CheckCircle2 className="h-4 w-4" /> {notice}</p>}
      {error && <p className="flex items-start gap-2 whitespace-pre-wrap rounded-lg bg-rose-50 p-3 text-[13px] text-rose-700"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> {error}</p>}

      {/* 1 · WHO OWNS THESE FACTS */}
      <section className="rounded-xl border border-ash-900/10 p-4">
        <div className="flex flex-wrap items-start gap-4">
          <span className="h-12 w-12 shrink-0 overflow-hidden rounded-full shadow ring-2 ring-white"><RiriAvatar size={48} /></span>
          <div className="grid min-w-0 flex-1 gap-3 sm:grid-cols-3">
            <label className="block">
              <span className="text-[11.5px] font-semibold text-ash-600">KRA PIN</span>
              <input
                value={cfg.member.kraPin ?? ""}
                onChange={(e) => setCfg({ ...cfg, member: { ...cfg.member, kraPin: e.target.value.toUpperCase() || null } })}
                placeholder="P051234567X"
                className="mt-1 w-full rounded-lg border border-ash-900/15 px-3 py-2 font-mono text-[13px] uppercase outline-none focus:border-navy"
              />
              <span className="mt-1 block text-[11px] text-ash-500">Owns every fact you publish — the key the Interchange knows you by.</span>
            </label>
            <label className="block">
              <span className="text-[11.5px] font-semibold text-ash-600">Assistant name</span>
              <input
                value={cfg.member.assistantName ?? ""}
                onChange={(e) => setCfg({ ...cfg, member: { ...cfg.member, assistantName: e.target.value || null } })}
                placeholder="Riri"
                className="mt-1 w-full rounded-lg border border-ash-900/15 px-3 py-2 text-[13px] outline-none focus:border-navy"
              />
              <span className="mt-1 block text-[11px] text-ash-500">White-label her name. Her voice and her rules never change.</span>
            </label>
            <div>
              <span className="text-[11.5px] font-semibold text-ash-600">First response for customers</span>
              <button
                type="button"
                onClick={() => setCfg({ ...cfg, customer: { firstResponse: !cfg.customer.firstResponse } })}
                className={`mt-1 flex w-full items-center justify-between rounded-lg border px-3 py-2 text-[13px] font-medium ${cfg.customer.firstResponse ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-ash-900/15 text-ash-600"}`}
              >
                {cfg.customer.firstResponse ? "On — Riri answers first" : "Off — straight to the team"}
                <span className={`h-5 w-9 rounded-full p-0.5 transition-colors ${cfg.customer.firstResponse ? "bg-emerald-500" : "bg-ash-300"}`}>
                  <span className={`block h-4 w-4 rounded-full bg-white shadow transition-transform ${cfg.customer.firstResponse ? "translate-x-4" : ""}`} />
                </span>
              </button>
            </div>
          </div>
          <button type="button" className={primary} disabled={saving} onClick={() => void publishValue(cfg, "Settings")}>
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Save
          </button>
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        {/* 2 · WHAT IS LIVE */}
        <section className="space-y-3">
          <h2 className="flex items-center gap-2 text-[14px] font-semibold text-ash-900"><BookOpen className="h-4 w-4" /> Live now</h2>
          <div className="rounded-xl border border-ash-900/10 p-3 text-[12.5px] text-ash-700">
            <p className="flex items-center gap-1.5 font-semibold text-ash-900"><ShieldCheck className="h-3.5 w-3.5 text-sky-600" /> platform.ratiba v1 · Platform</p>
            <p className="mt-0.5 text-ash-500">M-PESA Ratiba, from Safaricom&apos;s own agreement. True for every lender; ours to keep true.</p>
          </div>
          {starterLive && (
            <div className="rounded-xl border border-amber-300 bg-amber-50/60 p-3 text-[12.5px] text-amber-900">
              <p className="flex items-center gap-1.5 font-semibold"><Info className="h-3.5 w-3.5" /> {starter!.pack} v{starter!.version} · Starter pack</p>
              <p className="mt-0.5">
                Your customers are being answered from a starter pack we assembled from your published terms and fee sheet
                ({starter!.entries.length} entries). Every answer says it is unreviewed. Load it, check every figure, and publish it as yours.
              </p>
              <button type="button" onClick={useStarter} className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-white px-2.5 py-1.5 text-[12px] font-semibold text-amber-900 ring-1 ring-amber-300 hover:bg-amber-100">
                Load the starter into the workbench
              </button>
            </div>
          )}
          {cfg.packs.map((p) => (
            <div key={p.pack} className="flex items-start gap-3 rounded-xl border border-ash-900/10 p-3 text-[12.5px]">
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-ash-900">{p.pack} v{p.version} · {p.authority === "document" ? "Document" : "Your pack"}</p>
                <p className="mt-0.5 text-ash-500">{p.entries.length} entries · {p.audience.join(", ")} · {p.lang.toUpperCase()}</p>
              </div>
              <button type="button" className={btn} onClick={() => { setDraft(JSON.stringify(p, null, 2)); setCheck(null); }}>Edit</button>
              <button type="button" className={btn} disabled={saving} onClick={() => void publishValue({ ...cfg, packs: cfg.packs.filter((x) => x.pack !== p.pack) }, `Removed “${p.pack}”`)}>
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}

          {/* 4 · HISTORY */}
          <h2 className="flex items-center gap-2 pt-2 text-[14px] font-semibold text-ash-900"><History className="h-4 w-4" /> History · version {version}</h2>
          {history.length === 0 ? (
            <p className="text-[12.5px] text-ash-500">Nothing published yet.</p>
          ) : (
            <ol className="space-y-1">
              {history.map((h) => (
                <li key={h.version} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-[12.5px] hover:bg-ash-900/[0.03]">
                  <span className="w-10 font-semibold tabular-nums text-ash-900">v{h.version}</span>
                  <span className="min-w-0 flex-1 truncate text-ash-500">{new Date(h.createdAt).toLocaleString("en-KE", { dateStyle: "medium", timeStyle: "short" })} · {Array.isArray(h.changed) ? (h.changed as string[]).join(", ") : ""}</span>
                  {h.version !== version && (
                    <button type="button" className="inline-flex items-center gap-1 text-[12px] font-semibold text-navy hover:underline disabled:opacity-50" disabled={saving} onClick={() => void rollback(h.version)}>
                      <RotateCcw className="h-3 w-3" /> Roll back
                    </button>
                  )}
                </li>
              ))}
            </ol>
          )}
        </section>

        {/* 3 · THE WORKBENCH */}
        <section className="space-y-3 rounded-xl border border-ash-900/10 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 text-[14px] font-semibold text-ash-900"><Upload className="h-4 w-4" /> Workbench</h2>
            <div className="flex gap-2">
              <input ref={file} type="file" accept="application/json,.json" className="hidden" onChange={async (e) => { const f = e.target.files?.[0]; if (f) { setDraft(await f.text()); setCheck(null); } e.target.value = ""; }} />
              <button type="button" className={btn} onClick={() => file.current?.click()}><Upload className="h-3.5 w-3.5" /> Upload JSON</button>
              <button type="button" className={btn} disabled={checking || !draft.trim()} onClick={() => void validate()}>{checking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />} Validate</button>
              <button type="button" className={primary} disabled={saving || !check?.ok} onClick={() => void publishDraft()}>Publish pack</button>
            </div>
          </div>
          <textarea
            value={draft}
            onChange={(e) => { setDraft(e.target.value); setCheck(null); }}
            spellCheck={false}
            placeholder={'{\n  "pack": "yourlender.customer",\n  "owner": "KE/LENDER/<your KRA PIN>",\n  "version": 1,\n  "authority": "tenant",\n  "audience": ["customer"],\n  "lang": "en",\n  "entries": [{ "category": "fees", "question": "…", "variants": ["…"], "answer": "…", "review_by": "2026-12-01" }]\n}'}
            className="h-72 w-full resize-y rounded-lg border border-ash-900/15 bg-ash-950/[0.02] p-3 font-mono text-[12px] leading-relaxed outline-none focus:border-navy"
          />
          {check && (
            <div className={`rounded-lg p-3 text-[12.5px] ${check.ok ? "bg-emerald-50 text-emerald-900" : "bg-rose-50 text-rose-800"}`}>
              <p className="font-semibold">{check.ok ? `Ready to publish — ${check.entries} entries.` : "Not ready yet."}</p>
              {check.issues.length > 0 && (
                <ul className="mt-1.5 space-y-1">
                  {check.issues.map((i, n) => (
                    <li key={n} className="flex gap-1.5">
                      <span className={`mt-0.5 shrink-0 rounded px-1 text-[10px] font-bold uppercase ${i.level === "warning" ? "bg-amber-100 text-amber-800" : "bg-rose-100 text-rose-800"}`}>{i.level ?? "error"}</span>
                      <span><span className="font-mono text-[11px] opacity-70">{i.at ?? i.path}</span> {i.message}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <div className="border-t border-ash-900/10 pt-3">
            <p className="text-[12.5px] font-semibold text-ash-900">What would a customer be told?</p>
            <p className="text-[11.5px] text-ash-500">Asked against your live packs{draft.trim() ? " with the draft above in place of its published version" : ""}.</p>
            <div className="mt-2 flex gap-2">
              <input value={question} onChange={(e) => setQuestion(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void runPreview(); }} className="min-w-0 flex-1 rounded-lg border border-ash-900/15 px-3 py-2 text-[13px] outline-none focus:border-navy" />
              <button type="button" className={primary} disabled={previewing || !question.trim()} onClick={() => void runPreview()}>{previewing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} Ask</button>
            </div>
            {preview && (
              <div className="mt-3 flex gap-2.5">
                <span className="h-7 w-7 shrink-0 overflow-hidden rounded-full ring-2 ring-white"><RiriAvatar size={28} animated={false} /></span>
                <div className="min-w-0 flex-1 rounded-2xl rounded-tl-sm border border-ash-900/10 bg-white px-3 py-2.5">
                  {preview.answeredFromRecord && (
                    <p className="mb-1.5 flex items-center gap-1.5 rounded-md bg-sky-50 px-2 py-1 text-[11.5px] text-sky-800"><Wallet className="h-3 w-3" /> A real customer gets this from their own account, not from a pack.</p>
                  )}
                  <p className="whitespace-pre-wrap text-[12.5px] leading-relaxed text-ash-800">{preview.answer.replace(/\*\*/g, "")}</p>
                  <div className="mt-2 flex flex-wrap gap-1.5 border-t border-ash-900/5 pt-2">
                    {preview.sources.map((s) => <span key={s.id} className="rounded-full bg-violet-50 px-2 py-0.5 text-[10.5px] font-semibold text-violet-700">{s.label}</span>)}
                    <span className="text-[10.5px] text-ash-400">{preview.outcome === "resolved" ? "Resolved — no ticket" : "Offers a person"}</span>
                  </div>
                  {preview.hits.length > 1 && (
                    <p className="mt-1.5 text-[10.5px] text-ash-400">Also matched: {preview.hits.slice(1).map((h) => `${h.label} (${h.score})`).join(" · ")}</p>
                  )}
                </div>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
