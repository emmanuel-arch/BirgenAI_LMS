"use client";

// Comms — campaign blasts, message templates, and the email log.
// Three deep-linkable tabs (?tab=):
//   Campaigns — compose to a live segment (audience counted before you send,
//               cost shown in SMS segments), history with delivery stats
//   Templates — every built-in SMS the platform sends, editable per org;
//               placeholders are validated so an override can't lose {code}
//   Email log — every transactional email with its outcome (invite, sign-in
//               code, approvals) — "did the system email them?" answered
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useLoad } from "@/lib/hooks/useLoad";
import {
  MessageSquare, FileText, Mail, Loader2, AlertTriangle, CheckCircle2, Send, Users, RotateCcw,
} from "lucide-react";

type Campaign = {
  id: string; name: string; message: string; audience: string; status: string;
  recipients: number; queued: number; sentAt: string | null; createdAt: string;
  delivery: { sent: number; queued: number; failed: number };
};
type Template = {
  key: string; defaultBody: string; placeholders: string[];
  override: { body: string; active: boolean; updatedAt: string } | null;
};
type EmailRow = { id: string; to: string; subject: string; template: string | null; state: string; error: string | null; createdAt: string };

const AUDIENCES: { key: string; label: string }[] = [
  { key: "ALL", label: "Every borrower" },
  { key: "ACTIVE_LOANS", label: "Active loans" },
  { key: "ARREARS", label: "In arrears" },
  { key: "CLEARED", label: "Repaid in full" },
  { key: "BROKEN_PTP", label: "Broken promise" },
];

const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

export default function CommsPage() {
  return (
    <Suspense fallback={null}>
      <Comms />
    </Suspense>
  );
}

function Comms() {
  const router = useRouter();
  const search = useSearchParams();
  const tab = (search.get("tab") ?? "campaigns") as "campaigns" | "templates" | "email";
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const setTab = (t: string) => router.replace(t === "campaigns" ? "/console/comms" : `/console/comms?tab=${t}`);

  return (
    <main className="mx-auto max-w-5xl px-4 sm:px-6 py-8">
      <h1 className="text-xl font-bold flex items-center gap-2">
        <MessageSquare className="h-5 w-5" style={{ color: "var(--brand)" }} /> SMS & Comms
      </h1>
      <p className="mt-1 text-sm text-zinc-500 max-w-2xl">
        Campaign blasts to live borrower segments, the wording of every SMS the platform sends, and the outbound
        email log. Campaigns ride your SMS credits — they queue when credits run out, never overdraw.
      </p>

      {notice && <div className="mt-4 flex items-start gap-2 rounded-lg border border-emerald-300 bg-emerald-50/90 px-3 py-2.5 text-sm text-emerald-700"><CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" /> {notice}</div>}
      {error && <div className="mt-4 flex items-start gap-2 rounded-lg border border-red-300 bg-red-50/90 px-3 py-2.5 text-sm text-red-700"><AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" /> {error}</div>}

      <div className="mt-5 flex gap-1.5">
        {[
          { key: "campaigns", label: "Campaigns", icon: MessageSquare },
          { key: "templates", label: "Templates", icon: FileText },
          { key: "email", label: "Email Log", icon: Mail },
        ].map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold ${tab === t.key ? "text-white" : "bg-white/70 text-zinc-600 border border-zinc-900/10 hover:bg-white"}`}
            style={tab === t.key ? { backgroundColor: "var(--brand)" } : undefined}>
            <t.icon className="h-3.5 w-3.5" /> {t.label}
          </button>
        ))}
      </div>

      {tab === "campaigns" && <CampaignsTab setNotice={setNotice} setError={setError} />}
      {tab === "templates" && <TemplatesTab setNotice={setNotice} setError={setError} />}
      {tab === "email" && <EmailTab setError={setError} />}
    </main>
  );
}

// ── Campaigns ─────────────────────────────────────────────────────────────────

function CampaignsTab({ setNotice, setError }: { setNotice: (s: string | null) => void; setError: (s: string | null) => void }) {
  const [campaigns, setCampaigns] = useState<Campaign[] | null>(null);
  const [name, setName] = useState("");
  const [audience, setAudience] = useState("ACTIVE_LOANS");
  const [message, setMessage] = useState("");
  const [estimate, setEstimate] = useState<{ recipients: number; segments: number; capped: boolean } | null>(null);
  const [busy, setBusy] = useState<"estimate" | "send" | null>(null);

  const load = async () => {
    const res = await fetch("/api/console/comms/campaigns");
    const data = await res.json();
    if (data.success) setCampaigns(data.campaigns);
    else setError(data.message || "Could not load campaigns.");
  };
  useLoad(load);

  const dryRun = async () => {
    setBusy("estimate"); setError(null); setEstimate(null);
    try {
      const res = await fetch("/api/console/comms/campaigns", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audience, message, dryRun: true }),
      });
      const data = await res.json();
      if (!data.success) { setError(data.message || "Could not count the audience."); return; }
      setEstimate({ recipients: data.recipients, segments: data.segments, capped: data.capped });
    } catch { setError("Could not count the audience."); } finally { setBusy(null); }
  };

  const send = async () => {
    if (!estimate) return;
    if (!confirm(`Send "${name}" to ${estimate.recipients} borrower${estimate.recipients === 1 ? "" : "s"} (~${estimate.recipients * estimate.segments} SMS)?`)) return;
    setBusy("send"); setError(null); setNotice(null);
    try {
      const res = await fetch("/api/console/comms/campaigns", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, audience, message }),
      });
      const data = await res.json();
      if (!data.success) { setError(data.message || "Could not send the campaign."); return; }
      setNotice(`Campaign queued to ${data.queued} of ${data.recipients} recipients. Messages without credit wait for a top-up.`);
      setName(""); setMessage(""); setEstimate(null);
      await load();
    } catch { setError("Could not send the campaign."); } finally { setBusy(null); }
  };

  const segments = Math.max(1, Math.ceil(message.length / 160));

  return (
    <div className="mt-4 space-y-4">
      <div className="glass p-5">
        <p className="text-sm font-semibold">New campaign</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="text-[11px] font-semibold text-zinc-600">Name</span>
            <span className="block text-[11px] text-zinc-500">For your history — say what this was.</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Easter repayment drive"
              className="mt-1.5 w-full rounded-lg border border-zinc-900/15 bg-white/80 px-3 py-2.5 text-sm outline-none" />
          </label>
          <label className="block">
            <span className="text-[11px] font-semibold text-zinc-600">Who gets it</span>
            <span className="block text-[11px] text-zinc-500">Counted live from your book when you send.</span>
            <select value={audience} onChange={(e) => { setAudience(e.target.value); setEstimate(null); }}
              className="mt-1.5 w-full rounded-lg border border-zinc-900/15 bg-white/80 px-3 py-2.5 text-sm outline-none">
              {AUDIENCES.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}
            </select>
          </label>
        </div>
        <label className="mt-3 block">
          <span className="text-[11px] font-semibold text-zinc-600">Message</span>
          <span className="block text-[11px] text-zinc-500">{"{name}"} becomes each borrower&apos;s first name. {message.length}/480 characters · {segments} SMS segment{segments > 1 ? "s" : ""} per recipient.</span>
          <textarea value={message} onChange={(e) => { setMessage(e.target.value.slice(0, 480)); setEstimate(null); }} rows={3}
            placeholder="Hi {name}, pay your loan early this month and grow your limit! Dial your paybill or use Pay Now."
            className="mt-1.5 w-full rounded-lg border border-zinc-900/15 bg-white/80 px-3 py-2.5 text-sm outline-none" />
        </label>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button onClick={dryRun} disabled={busy !== null || message.trim().length < 10}
            className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-900/15 bg-white/70 px-4 py-2 text-xs font-semibold text-zinc-700 hover:bg-white disabled:opacity-50">
            {busy === "estimate" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Users className="h-3.5 w-3.5" />} Count the audience
          </button>
          {estimate && (
            <>
              <span className="text-xs text-zinc-600">
                <strong>{estimate.recipients}</strong> recipient{estimate.recipients === 1 ? "" : "s"} · ~<strong>{estimate.recipients * estimate.segments}</strong> SMS{estimate.capped ? " (capped at 5,000)" : ""}
              </span>
              <button onClick={send} disabled={busy !== null || name.trim().length < 3 || estimate.recipients === 0}
                className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
                style={{ backgroundColor: "var(--brand)" }}>
                {busy === "send" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} Send campaign
              </button>
              {estimate.recipients === 0 && <span className="text-[11px] text-zinc-400">Nobody matches this audience yet.</span>}
              {name.trim().length < 3 && estimate.recipients > 0 && <span className="text-[11px] text-zinc-400">Name the campaign to send.</span>}
            </>
          )}
        </div>
      </div>

      {campaigns === null ? (
        <div className="glass p-5 text-sm text-zinc-500 flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Loading history…</div>
      ) : campaigns.length === 0 ? (
        <div className="glass p-8 text-center text-sm text-zinc-500">No campaigns yet.</div>
      ) : (
        <div className="space-y-2">
          {campaigns.map((c) => (
            <div key={c.id} className="glass p-3.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold">{c.name} <span className="ml-1 rounded-md bg-zinc-900/5 px-2 py-0.5 text-[10px] font-semibold text-zinc-500">{AUDIENCES.find((a) => a.key === c.audience)?.label ?? c.audience}</span></p>
                  <p className="mt-0.5 text-[12px] text-zinc-600">&ldquo;{c.message}&rdquo;</p>
                </div>
                <div className="shrink-0 text-right text-[11px] text-zinc-500">
                  <p>{c.sentAt ? day(c.sentAt) : day(c.createdAt)} · {c.recipients} recipients</p>
                  <p className="mt-0.5">
                    <span className="text-emerald-600 font-semibold">{c.delivery.sent} sent</span>
                    {c.delivery.queued > 0 && <span className="text-sky-600"> · {c.delivery.queued} waiting for credit</span>}
                    {c.delivery.failed > 0 && <span className="text-red-600"> · {c.delivery.failed} failed</span>}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Templates ─────────────────────────────────────────────────────────────────

function TemplatesTab({ setNotice, setError }: { setNotice: (s: string | null) => void; setError: (s: string | null) => void }) {
  const [templates, setTemplates] = useState<Template[] | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const res = await fetch("/api/console/comms/templates");
    const data = await res.json();
    if (data.success) setTemplates(data.templates);
    else setError(data.message || "Could not load templates.");
  };
  useLoad(load);

  const save = async (key: string, body: string | null) => {
    setBusy(true); setError(null); setNotice(null);
    try {
      const res = await fetch("/api/console/comms/templates", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, body }),
      });
      const data = await res.json();
      if (!data.success) { setError(data.message || "Could not save."); return; }
      setNotice(body === null ? "Template restored to the built-in copy." : "Template saved — every future message uses your wording.");
      setEditing(null);
      await load();
    } catch { setError("Could not save."); } finally { setBusy(false); }
  };

  return (
    <div className="mt-4">
      <p className="text-[11px] text-zinc-500">
        The wording of every SMS the platform sends on your behalf. Placeholders in braces are filled at send time —
        an override must keep them, or the message loses its meaning.
      </p>
      {templates === null ? (
        <div className="glass mt-3 p-5 text-sm text-zinc-500 flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
      ) : (
        <div className="mt-3 space-y-2">
          {templates.map((t) => (
            <div key={t.key} className="glass p-3.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold">
                  <code className="rounded bg-zinc-900/5 px-1.5 py-0.5 text-[11px]">{t.key}</code>
                  {t.override && <span className="ml-2 rounded-md px-2 py-0.5 text-[10px] font-semibold text-white" style={{ backgroundColor: "var(--brand)" }}>customized</span>}
                </p>
                <div className="flex items-center gap-2">
                  {t.override && (
                    <button onClick={() => save(t.key, null)} disabled={busy}
                      className="inline-flex items-center gap-1 rounded-lg border border-zinc-900/15 bg-white/70 px-2.5 py-1 text-[11px] font-semibold text-zinc-600 hover:bg-white">
                      <RotateCcw className="h-3 w-3" /> Restore default
                    </button>
                  )}
                  <button onClick={() => { setEditing(editing === t.key ? null : t.key); setDraft(t.override?.body ?? t.defaultBody); }}
                    className="rounded-lg border border-zinc-900/15 bg-white/70 px-2.5 py-1 text-[11px] font-semibold text-zinc-600 hover:bg-white">
                    {editing === t.key ? "Close" : "Edit"}
                  </button>
                </div>
              </div>
              <p className="mt-1.5 text-[12px] text-zinc-600">{t.override?.body ?? t.defaultBody}</p>
              {editing === t.key && (
                <div className="mt-2">
                  <textarea value={draft} onChange={(e) => setDraft(e.target.value.slice(0, 480))} rows={3}
                    className="w-full rounded-lg border border-zinc-900/15 bg-white/80 px-3 py-2 text-sm outline-none" />
                  <div className="mt-1.5 flex items-center gap-2">
                    <button onClick={() => save(t.key, draft)} disabled={busy || draft.trim().length < 10}
                      className="rounded-lg px-3.5 py-1.5 text-[11px] font-semibold text-white disabled:opacity-50" style={{ backgroundColor: "var(--brand)" }}>
                      {busy ? <Loader2 className="inline h-3 w-3 animate-spin" /> : "Save"}
                    </button>
                    <span className="text-[10px] text-zinc-400">Must keep: {t.placeholders.map((p) => `{${p}}`).join(" ")}</span>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Email log ─────────────────────────────────────────────────────────────────

function EmailTab({ setError }: { setError: (s: string | null) => void }) {
  const [emails, setEmails] = useState<EmailRow[] | null>(null);

  useLoad(async () => {
    const res = await fetch("/api/console/comms/emails");
    const data = await res.json();
    if (data.success) setEmails(data.emails);
    else setError(data.message || "Could not load the email log.");
  });

  return (
    <div className="mt-4">
      {emails === null ? (
        <div className="glass p-5 text-sm text-zinc-500 flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
      ) : emails.length === 0 ? (
        <div className="glass p-8 text-center text-sm text-zinc-500">No emails sent yet.</div>
      ) : (
        <div className="glass overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-900/10 text-[10px] uppercase tracking-wide text-zinc-500">
                <th className="px-4 py-3">To</th>
                <th className="px-4 py-3">Subject</th>
                <th className="px-4 py-3">Kind</th>
                <th className="px-4 py-3">Outcome</th>
                <th className="px-4 py-3">When</th>
              </tr>
            </thead>
            <tbody>
              {emails.map((e) => (
                <tr key={e.id} className="border-b border-zinc-900/5 last:border-0">
                  <td className="px-4 py-2.5 text-zinc-700">{e.to}</td>
                  <td className="px-4 py-2.5 text-zinc-600 max-w-[280px] truncate">{e.subject}</td>
                  <td className="px-4 py-2.5"><code className="rounded bg-zinc-900/5 px-1.5 py-0.5 text-[10px] text-zinc-500">{e.template ?? "raw"}</code></td>
                  <td className="px-4 py-2.5">
                    {e.state === "SENT"
                      ? <span className="rounded-md bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">sent</span>
                      : <span className="rounded-md bg-red-100 px-2 py-0.5 text-[10px] font-semibold text-red-700" title={e.error ?? undefined}>failed</span>}
                    {e.state !== "SENT" && e.error && <span className="ml-1.5 text-[10px] text-zinc-400">{e.error.slice(0, 60)}</span>}
                  </td>
                  <td className="px-4 py-2.5 text-[11px] text-zinc-500">{when(e.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
