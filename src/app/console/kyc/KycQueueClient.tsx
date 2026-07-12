"use client";

// KYC Verification — the customers you have registered but not yet proved.
//
// The list is deliberately unflattering. It sorts OLDEST FIRST, it counts the days,
// and it says out loud how many of these people have already asked for money they
// cannot legally be given. A lender should be able to clear this screen every day; if
// it is long, that is the finding, not a rendering problem.
//
// Two ways out of the queue for each person, and one way to admit they were never real:
//   Verify at the counter — open the verification wizard with the customer present
//   Send them the link    — they finish it on their own phone, where their face is
//   Remove                — a customer who never applied and never verified is not a
//                           customer; deleting them is how the queue stays honest.
import { useState } from "react";
import Link from "next/link";
import { ShieldCheck, Search, Loader2, AlertCircle, Send, Trash2, ScanFace, Clock, CheckCircle2, UserCheck, Eye, XCircle } from "lucide-react";
import { useLoad } from "@/lib/hooks/useLoad";
import { PageHeader } from "@/components/shell/PageHeader";
import { BorrowerAvatar } from "@/components/kyc/BorrowerAvatar";

type Review = {
  sessionId: string;
  faceMatchScore: number | null;
  livenessScore: number | null;
  livenessPassed: boolean | null;
  iprsMatched: boolean | null;
  flags: string[];
  idFrontKey: string | null;
  selfieKey: string | null;
  vouchable: boolean;
};

type Row = {
  id: string;
  name: string;
  phone: string;
  nationalId: string | null;
  kycStatus: "NONE" | "IN_PROGRESS" | "PENDING_REVIEW" | "FAILED";
  branch: string | null;
  officer: string | null;
  selfRegistered: boolean;
  waitingDays: number;
  applications: number;
  loans: number;
  review: Review | null;
};

const STATUS: Record<Row["kycStatus"], { label: string; cls: string }> = {
  NONE: { label: "Not started", cls: "bg-zinc-900/5 text-zinc-600" },
  IN_PROGRESS: { label: "Half-finished", cls: "bg-amber-100 text-amber-700" },
  PENDING_REVIEW: { label: "Needs a human look", cls: "bg-sky-100 text-sky-700" },
  FAILED: { label: "Failed", cls: "bg-rose-100 text-rose-700" },
};

const SCOPE_NOTE: Record<string, string> = {
  OWN: "You're seeing the customers you registered.",
  BRANCH: "You're seeing your branch's customers.",
  BRANCH_TREE: "You're seeing every customer in your region.",
  ORG: "You're seeing every customer in the organisation.",
};

export function KycQueueClient({ focusId }: { focusId: string | null }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [q, setQ] = useState("");
  const [canVerify, setCanVerify] = useState(false);
  const [canDelete, setCanDelete] = useState(false);
  const [canVouch, setCanVouch] = useState(false);
  const [scope, setScope] = useState<string>("ORG");
  const [blocked, setBlocked] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  const load = async (search = q) => {
    const res = await fetch(`/api/console/kyc/queue?q=${encodeURIComponent(search)}`);
    const data = await res.json();
    if (!data.success) throw new Error(data.message ?? "Could not load the queue.");
    setRows(data.borrowers);
    setCanVerify(data.canVerify);
    setCanDelete(data.canDelete);
    setCanVouch(data.canVouch);
    setScope(data.scope);
    setBlocked(data.blocked);
  };

  useLoad(async () => {
    try { await load(""); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not load the queue."); }
    finally { setLoading(false); }
  });

  const search = async (value: string) => {
    setQ(value);
    try { await load(value); } catch { /* keep the last good list */ }
  };

  const sendLink = async (r: Row) => {
    setBusy(r.id); setError(null); setNotice(null);
    try {
      const res = await fetch("/api/console/kyc/queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ borrowerId: r.id, action: "send-link" }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.message);
      setNotice(data.message);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not send the link.");
    } finally { setBusy(null); }
  };

  const remove = async (r: Row) => {
    setBusy(r.id); setError(null); setNotice(null);
    try {
      const res = await fetch(`/api/console/kyc/queue?id=${r.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!data.success) throw new Error(data.message);
      setNotice(data.message);
      setConfirming(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not remove them.");
    } finally { setBusy(null); }
  };

  if (loading) {
    return (
      <main className="mx-auto max-w-5xl px-4 sm:px-6 py-10">
        <p className="flex items-center gap-2 text-sm text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading the queue…</p>
      </main>
    );
  }

  const ordered = focusId ? [...rows].sort((a, b) => (a.id === focusId ? -1 : b.id === focusId ? 1 : 0)) : rows;

  return (
    <main className="mx-auto max-w-5xl px-4 sm:px-6 py-8">
      <PageHeader
        icon={ShieldCheck}
        title="KYC Verification"
        subtitle={<>Customers you have registered but not yet verified. No money can be disbursed to anyone on this
          list — verification is the gate. {SCOPE_NOTE[scope] ?? ""}</>}
      />

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <div className="flex min-w-[220px] flex-1 items-center gap-2 rounded-xl border border-zinc-900/12 bg-white/80 px-3">
          <Search className="h-4 w-4 shrink-0 text-[color:var(--ink-faint)]" />
          <input
            value={q}
            onChange={(e) => search(e.target.value)}
            placeholder="Search a name, phone or ID number…"
            className="flex-1 bg-transparent py-2.5 text-sm outline-none placeholder:text-[color:var(--ink-faint)]"
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-zinc-900/5 px-2.5 py-1 text-[12px] font-semibold text-[color:var(--ink-muted)]">{rows.length} waiting</span>
          {blocked > 0 && (
            <span className="rounded-full bg-rose-100 px-2.5 py-1 text-[12px] font-bold text-rose-700">{blocked} blocked from disbursement</span>
          )}
        </div>
      </div>

      {error && (
        <p className="mt-4 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] text-rose-700">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
        </p>
      )}
      {notice && (
        <p className="mt-4 flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[13px] text-emerald-700">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> {notice}
        </p>
      )}

      {ordered.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-emerald-200 bg-emerald-50/60 px-4 py-10 text-center">
          <CheckCircle2 className="mx-auto h-8 w-8 text-emerald-600" />
          <p className="mt-2 text-sm font-semibold text-emerald-800">Nobody is waiting.</p>
          <p className="mt-0.5 text-[13px] text-emerald-700">
            Every customer you can see has been verified. That is exactly how this screen should look.
          </p>
        </div>
      ) : (
        <div className="mt-5 space-y-2">
          {ordered.map((r) => {
            const s = STATUS[r.kycStatus];
            const stale = r.waitingDays >= 7;
            const isFocus = r.id === focusId;
            return (
              <div
                key={r.id}
                className={`rounded-xl border bg-white/70 px-4 py-3 ${isFocus ? "border-[color:var(--brand)] ring-2 ring-[color:var(--brand)]/20" : "border-zinc-900/10"}`}
              >
                <div className="flex flex-wrap items-start gap-3">
                  {/* Everyone here is unverified by definition, so every frame is dashed.
                      That is the point: the queue LOOKS unfinished until it is empty. */}
                  <BorrowerAvatar name={r.name} verified={false} size="sm" className="mt-0.5" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link href={`/console/borrowers/${r.id}`} className="text-[15px] font-semibold text-[color:var(--ink)] hover:underline">{r.name}</Link>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${s.cls}`}>{s.label}</span>
                      {(r.applications > 0 || r.loans > 0) && (
                        <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold text-rose-700">
                          Waiting on money — blocked
                        </span>
                      )}
                      {stale && (
                        <span className="flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700">
                          <Clock className="h-2.5 w-2.5" /> {r.waitingDays} days
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-[12px] text-[color:var(--ink-muted)]">
                      {r.phone}
                      {r.nationalId ? ` · ID ${r.nationalId}` : " · no ID captured"}
                      {r.branch ? ` · ${r.branch}` : ""}
                      {r.selfRegistered ? " · signed up themselves" : r.officer ? ` · registered by ${r.officer}` : ""}
                    </p>
                  </div>

                  <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                    {canVerify && (
                      <>
                        {/* Stays INSIDE the console. It used to open the borrower's own
                            portal in a new tab, which had no way of knowing which lender
                            it was serving and guessed — filing verifications against the
                            wrong org. See api/console/kyc/verify/route.ts. */}
                        <Link
                          href={`/console/kyc/${r.id}`}
                          className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] font-semibold text-white"
                          style={{ backgroundColor: "var(--brand)" }}
                        >
                          <ScanFace className="h-3.5 w-3.5" /> Verify at the counter
                        </Link>
                        <button
                          disabled={busy === r.id}
                          onClick={() => sendLink(r)}
                          className="flex items-center gap-1.5 rounded-lg border border-zinc-900/12 bg-white px-2.5 py-1.5 text-[12px] font-medium text-zinc-600 hover:text-zinc-900 disabled:opacity-50"
                        >
                          {busy === r.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} Send link
                        </button>
                      </>
                    )}
                    {canDelete && r.applications === 0 && r.loans === 0 && (
                      confirming === r.id ? (
                        <button
                          disabled={busy === r.id}
                          onClick={() => remove(r)}
                          className="rounded-lg bg-rose-600 px-2.5 py-1.5 text-[12px] font-semibold text-white disabled:opacity-50"
                        >
                          {busy === r.id ? "Removing…" : "Really remove"}
                        </button>
                      ) : (
                        <button
                          onClick={() => setConfirming(r.id)}
                          title="Remove this unverified customer"
                          className="flex h-7 w-7 items-center justify-center rounded-lg text-zinc-400 hover:bg-rose-50 hover:text-rose-600"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )
                    )}
                  </div>
                </div>

                {/* The review case: what the machine measured, the evidence, and —
                    for the appointed few — the override with their name on it. */}
                {r.review && (
                  <ReviewPanel
                    row={r}
                    canVouch={canVouch}
                    onVouched={async (msg) => { setNotice(msg); await load(); }}
                    onError={setError}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}

      <p className="mt-6 text-[12px] leading-relaxed text-zinc-400">
        Cases marked &ldquo;needs a human look&rdquo; or &ldquo;failed&rdquo; carry the machine&rsquo;s scores right on the card. A worn
        fifteen-year-old ID photo will fail an honest face-match on an honest customer — that is what
        &ldquo;vouch&rdquo; is for: someone senior compares the two faces themselves and puts their name on the
        override. A vouch can never clear an ID the national registry does not recognise.
      </p>
      <p className="mt-2 text-[12px] leading-relaxed text-zinc-400">
        &ldquo;Verify at the counter&rdquo; runs the wizard here, in the console, for a customer standing in front of you —
        their ID and face are captured, and your name goes on the record as the person who vouched for the match.
        &ldquo;Send link&rdquo; texts them a link so they can do it themselves, where an SMS code proves the phone is theirs.
        A customer who has never applied and never verified can be removed; one who has applied stays, because a declined
        application is still part of your record.
      </p>
    </main>
  );
}

// ── The review case, inline on the queue row ─────────────────────────────────

const FLAG_LABEL: Record<string, string> = {
  "low-id-quality": "ID photo quality below the bar",
  "liveness-failed": "Liveness not confirmed",
  "face-mismatch": "Face didn't match the ID portrait",
  "iprs-unmatched": "No record at the national registry",
};

function ReviewPanel({ row, canVouch, onVouched, onError }: {
  row: Row;
  canVouch: boolean;
  onVouched: (msg: string) => void | Promise<void>;
  onError: (msg: string) => void;
}) {
  const r = row.review!;
  const [comparing, setComparing] = useState(false);
  const [images, setImages] = useState<{ id?: string; selfie?: string } | null>(null);
  const [vouching, setVouching] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  // Each reveal mints a short-lived signed URL — and writes the audit row that
  // says this person looked at this document. That is why it is a click.
  const compare = async () => {
    if (comparing) { setComparing(false); return; }
    setComparing(true);
    if (images) return;
    const fetchOne = async (key: string | null) => {
      if (!key) return undefined;
      const res = await fetch(`/api/console/kyc/asset?key=${encodeURIComponent(key)}`);
      const data = await res.json();
      return data.success ? (data.url as string) : undefined;
    };
    try {
      const [id, selfie] = await Promise.all([fetchOne(r.idFrontKey), fetchOne(r.selfieKey)]);
      setImages({ id, selfie });
    } catch { setImages({}); }
  };

  const vouch = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/console/kyc/vouch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: r.sessionId, note }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.message);
      await onVouched(data.message);
    } catch (e) {
      onError(e instanceof Error ? e.message : "The vouch could not be recorded.");
    } finally { setBusy(false); }
  };

  const score = (label: string, value: number | null, good: boolean | null) => (
    <span className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold ring-1 ring-zinc-900/10">
      <span className="text-[color:var(--ink-muted)]">{label}</span>
      <span className={`tabular-nums ${good === false ? "text-rose-600" : good ? "text-emerald-600" : "text-[color:var(--ink)]"}`}>
        {value != null ? `${value}%` : "—"}
      </span>
    </span>
  );

  return (
    <div className="mt-3 rounded-lg border border-sky-200 bg-sky-50/60 p-3">
      <div className="flex flex-wrap items-center gap-1.5">
        {score("Face match", r.faceMatchScore, r.faceMatchScore != null ? r.faceMatchScore >= 85 : null)}
        {score("Liveness", r.livenessScore, r.livenessPassed)}
        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${r.iprsMatched === false ? "bg-rose-100 text-rose-700" : "bg-emerald-100 text-emerald-700"}`}>
          {r.iprsMatched === false ? <XCircle className="h-3 w-3" /> : <CheckCircle2 className="h-3 w-3" />} Registry
        </span>
        {r.flags.map((f) => (
          <span key={f} className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800">{FLAG_LABEL[f] ?? f}</span>
        ))}
        <span className="flex-1" />
        {(r.idFrontKey || r.selfieKey) && (
          <button onClick={compare} className="inline-flex items-center gap-1 rounded-lg border border-zinc-900/12 bg-white px-2 py-1 text-[11px] font-semibold text-zinc-600 hover:text-zinc-900">
            <Eye className="h-3 w-3" /> {comparing ? "Hide the evidence" : "Compare the faces"}
          </button>
        )}
        {canVouch && r.vouchable && !vouching && (
          <button onClick={() => setVouching(true)} className="inline-flex items-center gap-1 rounded-lg bg-sky-600 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-sky-700">
            <UserCheck className="h-3 w-3" /> Vouch for this match
          </button>
        )}
      </div>

      {comparing && (
        <div className="mt-2.5 grid max-w-sm grid-cols-2 gap-2">
          {[{ src: images?.id, label: "ID front" }, { src: images?.selfie, label: "Selfie" }].map((f) => (
            <div key={f.label}>
              <p className="mb-1 text-[9px] font-bold uppercase tracking-wider text-[color:var(--ink-faint)]">{f.label}</p>
              <div className="relative aspect-square overflow-hidden rounded-lg bg-zinc-900/10">
                {f.src ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={f.src} alt={f.label} className="h-full w-full object-cover" />
                ) : images ? (
                  <span className="absolute inset-0 flex items-center justify-center px-2 text-center text-[10px] text-[color:var(--ink-faint)]">not stored</span>
                ) : (
                  <span className="absolute inset-0 flex items-center justify-center"><Loader2 className="h-4 w-4 animate-spin text-zinc-400" /></span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {vouching && (
        <div className="mt-2.5">
          <p className="text-[11px] font-semibold text-sky-900">
            You are overriding the machine on {row.name}. Look at both faces first. Your name goes on the record.
          </p>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder="Why you are sure it's them — e.g. “ID photo is 15 years old; scars and features match, customer known to the Gikomba branch since 2021.”"
            className="mt-1.5 w-full rounded-lg border border-sky-300 bg-white px-2.5 py-2 text-[12px] outline-none placeholder:text-zinc-400"
          />
          <div className="mt-1.5 flex items-center gap-2">
            <button
              disabled={busy || note.trim().length < 10}
              onClick={vouch}
              className="inline-flex items-center gap-1 rounded-lg bg-sky-600 px-3 py-1.5 text-[11px] font-bold text-white disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <UserCheck className="h-3 w-3" />} Verify on my word
            </button>
            <button onClick={() => setVouching(false)} className="text-[11px] font-semibold text-zinc-500 hover:text-zinc-800">Cancel</button>
          </div>
        </div>
      )}

      {!r.vouchable && (
        <p className="mt-2 text-[11px] font-medium text-rose-700">
          The national registry has no record of this ID — a vouch cannot clear that. Re-check the document itself.
        </p>
      )}
    </div>
  );
}
