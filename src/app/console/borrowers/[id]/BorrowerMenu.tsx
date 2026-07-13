"use client";

// ─────────────────────────────────────────────────────────────────────────────
// The Customer-360 kebab — every way an officer may change this account, in one
// place, top-right of the identity card.
//
// Design rules:
//   • The MENU is grouped the way an officer thinks (who they are / what they
//     may borrow / their paperwork), not the way the API is shaped.
//   • Anything money-adjacent (limit, score) demands a written reason in the
//     modal itself — the API refuses without one, the UI says so up front.
//   • Every verb lands as an audit row; nothing here is a quiet edit.
//   • Saves call router.refresh(): the page's numbers are server-rendered, and
//     a modal that "saved" while the header still shows the old limit is a lie.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useLoad } from "@/lib/hooks/useLoad";
import {
  MoreVertical, UserPen, Users, Banknote, Gauge, Paperclip, UserCog, MessageSquare,
  Loader2, X, CheckCircle2, AlertTriangle, FileText, Upload, ScanFace,
} from "lucide-react";

type Kin = { name?: string; relationship?: string; phone?: string } | null;
type Props = {
  borrowerId: string;
  name: string;
  phone: string;
  email: string | null;
  nationalId: string | null;
  locationType: string | null;
  locationAddress: string | null;
  loanLimit: number | null;
  creditScore: number | null;
  riskBand: string | null;
  nextOfKin: Kin;
  verified: boolean;
};

type ModalKind = "info" | "kin" | "limit" | "score" | "assign" | "attachments" | null;

export function BorrowerMenu(props: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [modal, setModal] = useState<ModalKind>(null);
  const [toast, setToast] = useState<string | null>(null);
  const wrap = useRef<HTMLDivElement>(null);

  // Outside click + Escape close the menu — a dropdown that only closes on its
  // own button is a dropdown people fight with.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  const done = (msg: string) => {
    setModal(null);
    setToast(msg);
    router.refresh();
  };

  const sendKycLink = async () => {
    setOpen(false);
    try {
      const res = await fetch("/api/console/kyc/queue", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ borrowerId: props.borrowerId, action: "send-link" }),
      });
      const d = await res.json();
      setToast(d.success ? "Verification link sent to their phone." : d.message || "Could not send the link.");
    } catch { setToast("Could not send the link."); }
  };

  const item = (icon: React.ReactNode, label: string, sub: string, onClick: () => void) => (
    <button
      onClick={onClick}
      className="flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-zinc-900/[0.05]"
    >
      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg" style={{ backgroundColor: "var(--brand-soft)" }}>
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-[13px] font-semibold text-zinc-800">{label}</span>
        <span className="block text-[11px] leading-snug text-zinc-500">{sub}</span>
      </span>
    </button>
  );
  const groupLabel = (s: string) => (
    <p className="px-3 pb-1 pt-2.5 text-[9px] font-bold uppercase tracking-[0.14em] text-zinc-400">{s}</p>
  );
  const ic = { className: "h-3.5 w-3.5", style: { color: "var(--brand)" } as React.CSSProperties };

  return (
    <div ref={wrap} className="relative shrink-0">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="Manage this borrower"
        aria-expanded={open}
        className="flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-900/10 bg-white/70 text-zinc-500 transition-colors hover:bg-white hover:text-zinc-800"
      >
        <MoreVertical className="h-4.5 w-4.5" />
      </button>

      {open && (
        <div className="glass absolute right-0 top-11 z-30 w-72 rounded-2xl bg-white/[0.97] p-1.5 shadow-[0_16px_48px_rgba(0,0,0,0.14)] backdrop-blur-xl">
          {groupLabel("Account")}
          {item(<UserPen {...ic} />, "Update details", "Name, phone, ID, email, address", () => { setOpen(false); setModal("info"); })}
          {item(<Users {...ic} />, "Next of kin", props.nextOfKin?.name ? `${props.nextOfKin.name} · ${props.nextOfKin.relationship}` : "Who to call when they can't be reached", () => { setOpen(false); setModal("kin"); })}
          {item(<UserCog {...ic} />, "Officer & branch", "Move them to a different book", () => { setOpen(false); setModal("assign"); })}

          {groupLabel("Credit")}
          {item(<Banknote {...ic} />, "Loan limit", props.loanLimit != null ? `Currently KES ${Math.round(props.loanLimit).toLocaleString()}` : "No limit set — the engine decides", () => { setOpen(false); setModal("limit"); })}
          {item(<Gauge {...ic} />, "Credit score", props.creditScore != null ? `Currently ${props.creditScore} / 900` : "No score yet", () => { setOpen(false); setModal("score"); })}

          {groupLabel("Records")}
          {item(<Paperclip {...ic} />, "Attachments", "Upload and read their documents", () => { setOpen(false); setModal("attachments"); })}
          {!props.verified && item(<MessageSquare {...ic} />, "Send verification link", "Text them the KYC link", sendKycLink)}
          {!props.verified && item(<ScanFace {...ic} />, "Verify at the counter", "They're with you — run KYC now", () => { router.push(`/console/kyc/${props.borrowerId}?from=360`); })}
        </div>
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full bg-zinc-900 px-4 py-2 text-xs font-semibold text-white shadow-lg">
          {toast}
        </div>
      )}

      {modal === "info" && <InfoModal {...props} onClose={() => setModal(null)} onDone={done} />}
      {modal === "kin" && <KinModal {...props} onClose={() => setModal(null)} onDone={done} />}
      {modal === "limit" && <LimitModal {...props} onClose={() => setModal(null)} onDone={done} />}
      {modal === "score" && <ScoreModal {...props} onClose={() => setModal(null)} onDone={done} />}
      {modal === "assign" && <AssignModal {...props} onClose={() => setModal(null)} onDone={done} />}
      {modal === "attachments" && <AttachmentsModal {...props} onClose={() => setModal(null)} />}
    </div>
  );
}

// ── Shared modal chrome ────────────────────────────────────────────────────────

function Modal({ title, sub, children, onClose }: { title: string; sub?: string; children: React.ReactNode; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 p-4 backdrop-blur-sm sm:items-center" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="glass w-full max-w-md rounded-3xl bg-white/90 p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-bold">{title}</h2>
            {sub && <p className="mt-0.5 text-xs text-zinc-500">{sub}</p>}
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-900/5 hover:text-zinc-700"><X className="h-4 w-4" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

const FIELD = "w-full rounded-lg border border-zinc-900/15 bg-white/80 px-3 py-2.5 text-sm outline-none placeholder:text-zinc-400";

function useAction(onDone: (msg: string) => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (borrowerId: string, payload: Record<string, unknown>, msg: string) => {
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/console/borrowers/${borrowerId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
      });
      const d = await res.json();
      if (!d.success) { setError(d.message || "Could not save."); return; }
      onDone(msg);
    } catch { setError("Could not save."); } finally { setBusy(false); }
  };
  return { busy, error, run };
}

function SaveRow({ busy, onSave, onClose, label = "Save" }: { busy: boolean; onSave: () => void; onClose: () => void; label?: string }) {
  return (
    <div className="mt-4 flex items-center gap-2">
      <button onClick={onSave} disabled={busy}
        className="inline-flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50" style={{ backgroundColor: "var(--brand)" }}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} {label}
      </button>
      <button onClick={onClose} className="rounded-lg border border-zinc-900/15 bg-white/70 px-4 py-2.5 text-sm text-zinc-600">Cancel</button>
    </div>
  );
}

function Err({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p className="mt-3 flex items-start gap-1.5 rounded-lg border border-red-300 bg-red-50/90 px-3 py-2 text-xs text-red-700">
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {error}
    </p>
  );
}

// ── The verbs ─────────────────────────────────────────────────────────────────

function InfoModal(p: Props & { onClose: () => void; onDone: (m: string) => void }) {
  const [name, setName] = useState(p.name);
  const [phone, setPhone] = useState(p.phone);
  const [email, setEmail] = useState(p.email ?? "");
  const [nationalId, setNationalId] = useState(p.nationalId ?? "");
  const [address, setAddress] = useState(p.locationAddress ?? "");
  const { busy, error, run } = useAction(p.onDone);
  return (
    <Modal title="Update details" sub="Every change is audited under your name." onClose={p.onClose}>
      <div className="mt-4 space-y-3">
        <input className={FIELD} placeholder="Full name" value={name} onChange={(e) => setName(e.target.value)} />
        <input className={FIELD} inputMode="tel" placeholder="Phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
        <input className={FIELD} placeholder="Email (optional)" value={email} onChange={(e) => setEmail(e.target.value)} />
        <input className={FIELD} inputMode="numeric" placeholder="National ID" value={nationalId} onChange={(e) => setNationalId(e.target.value)} />
        <input className={FIELD} placeholder="Address / landmark" value={address} onChange={(e) => setAddress(e.target.value)} />
      </div>
      <Err error={error} />
      <SaveRow busy={busy} onClose={p.onClose}
        onSave={() => run(p.borrowerId, { action: "info", name, phone, email, nationalId, locationAddress: address }, "Details updated.")} />
    </Modal>
  );
}

function KinModal(p: Props & { onClose: () => void; onDone: (m: string) => void }) {
  const [name, setName] = useState(p.nextOfKin?.name ?? "");
  const [relationship, setRelationship] = useState(p.nextOfKin?.relationship ?? "");
  const [phone, setPhone] = useState(p.nextOfKin?.phone ?? "");
  const { busy, error, run } = useAction(p.onDone);
  return (
    <Modal title="Next of kin" sub="A collections contact — never a guarantor, never liable." onClose={p.onClose}>
      <div className="mt-4 space-y-3">
        <input className={FIELD} placeholder="Full name" value={name} onChange={(e) => setName(e.target.value)} />
        <input className={FIELD} placeholder="Relationship (spouse, parent, sibling…)" value={relationship} onChange={(e) => setRelationship(e.target.value)} />
        <input className={FIELD} inputMode="tel" placeholder="Phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
      </div>
      <Err error={error} />
      <SaveRow busy={busy} onClose={p.onClose}
        onSave={() => run(p.borrowerId, { action: "next-of-kin", name, relationship, phone }, "Next of kin saved.")} />
    </Modal>
  );
}

function LimitModal(p: Props & { onClose: () => void; onDone: (m: string) => void }) {
  const [limit, setLimit] = useState(p.loanLimit != null ? String(Math.round(p.loanLimit)) : "");
  const [note, setNote] = useState("");
  const { busy, error, run } = useAction(p.onDone);
  return (
    <Modal title="Loan limit" sub="Overrides what the limit engine derived. The note is mandatory — this is a credit decision." onClose={p.onClose}>
      <div className="mt-4 space-y-3">
        <div className="flex items-center gap-2 rounded-lg border border-zinc-900/15 bg-white/80 px-3">
          <span className="text-sm text-zinc-500">KES</span>
          <input className="flex-1 bg-transparent py-2.5 text-sm outline-none" inputMode="numeric"
            placeholder="Leave empty to clear the override"
            value={limit ? Number(limit).toLocaleString() : ""}
            onChange={(e) => setLimit(e.target.value.replace(/[^0-9]/g, ""))} />
        </div>
        <textarea className={`${FIELD} min-h-20`} placeholder="Why? (required — lands in the audit trail)" value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      <Err error={error} />
      <SaveRow busy={busy} onClose={p.onClose} label="Set limit"
        onSave={() => run(p.borrowerId, { action: "limit", loanLimit: limit || null, note }, "Loan limit updated.")} />
    </Modal>
  );
}

function ScoreModal(p: Props & { onClose: () => void; onDone: (m: string) => void }) {
  const [score, setScore] = useState(p.creditScore != null ? String(p.creditScore) : "");
  const [note, setNote] = useState("");
  const { busy, error, run } = useAction(p.onDone);
  return (
    <Modal
      title="Credit score"
      sub="A hand-set score enters the history marked MANUAL — it never masquerades as a model output."
      onClose={p.onClose}
    >
      <div className="mt-4 space-y-3">
        <div className="flex items-center gap-2 rounded-lg border border-zinc-900/15 bg-white/80 px-3">
          <input className="flex-1 bg-transparent py-2.5 text-sm outline-none" inputMode="numeric"
            placeholder="300 – 900 (empty to clear)" value={score}
            onChange={(e) => setScore(e.target.value.replace(/[^0-9]/g, "").slice(0, 3))} />
          <span className="text-xs text-zinc-400">/ 900</span>
        </div>
        <textarea className={`${FIELD} min-h-20`} placeholder="Why? (required — lands in the audit trail and the score history)" value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      <Err error={error} />
      <SaveRow busy={busy} onClose={p.onClose} label="Set score"
        onSave={() => run(p.borrowerId, { action: "score", creditScore: score || null, note }, "Credit score updated.")} />
    </Modal>
  );
}

function AssignModal(p: Props & { onClose: () => void; onDone: (m: string) => void }) {
  const [staff, setStaff] = useState<{ id: string; name: string }[] | null>(null);
  const [branches, setBranches] = useState<{ id: string; name: string }[] | null>(null);
  const [officerId, setOfficerId] = useState("");
  const [branchId, setBranchId] = useState("");
  const { busy, error, run } = useAction(p.onDone);

  useEffect(() => {
    (async () => {
      try {
        const [t, b] = await Promise.all([
          fetch("/api/console/team").then((r) => r.json()),
          fetch("/api/console/branches").then((r) => r.json()),
        ]);
        setStaff(((t.staff ?? []) as { id: string; firstName?: string; otherName?: string; email?: string; status?: string }[])
          .filter((s) => s.status === "ACTIVE")
          .map((s) => ({ id: s.id, name: `${s.firstName ?? ""} ${s.otherName ?? ""}`.trim() || s.email || s.id })));
        const flat: { id: string; name: string }[] = [];
        const walk = (nodes: { id: string; name: string; children?: unknown[] }[], depth = 0) => {
          for (const n of nodes ?? []) { flat.push({ id: n.id, name: `${"— ".repeat(depth)}${n.name}` }); walk((n.children ?? []) as never, depth + 1); }
        };
        if (Array.isArray(b.tree)) walk(b.tree);
        else if (Array.isArray(b.branches)) b.branches.forEach((x: { id: string; name: string }) => flat.push({ id: x.id, name: x.name }));
        setBranches(flat);
      } catch { setStaff([]); setBranches([]); }
    })();
  }, []);

  const select = `${FIELD} appearance-none`;
  return (
    <Modal title="Officer & branch" sub="Whose book this customer sits on — visibility scopes follow it." onClose={p.onClose}>
      {!staff || !branches ? (
        <div className="mt-6 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-zinc-400" /></div>
      ) : (
        <div className="mt-4 space-y-3">
          <select className={select} value={officerId} onChange={(e) => setOfficerId(e.target.value)}>
            <option value="">Keep current officer</option>
            {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <select className={select} value={branchId} onChange={(e) => setBranchId(e.target.value)}>
            <option value="">Keep current branch</option>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>
      )}
      <Err error={error} />
      <SaveRow busy={busy} onClose={p.onClose} label="Reassign"
        onSave={() => run(p.borrowerId, { action: "assign", officerId: officerId || undefined, branchId: branchId || undefined }, "Borrower reassigned.")} />
    </Modal>
  );
}

// ── Attachments — the borrower's paperwork, read by the Document Parser ───────

type Doc = { id: string; kind: string; filename: string; status: string; confidence: number | null; createdAt: string };

function AttachmentsModal(p: Props & { onClose: () => void }) {
  const [docs, setDocs] = useState<Doc[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [kind, setKind] = useState("OTHER");
  const [password, setPassword] = useState("");
  const [needsPassword, setNeedsPassword] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    try {
      const res = await fetch(`/api/console/documents?borrowerId=${p.borrowerId}`);
      const d = await res.json();
      if (!d.success) { setError(d.message || "Could not load documents."); setDocs([]); return; }
      setDocs(d.documents ?? []);
    } catch { setError("Could not load documents."); setDocs([]); }
  };
  useLoad(load);

  const upload = (file: File) => {
    setBusy(true); setError(null);
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const res = await fetch("/api/console/documents", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kind, filename: file.name, file: String(reader.result), password: password || undefined, borrowerId: p.borrowerId }),
        });
        const d = await res.json();
        if (!d.success) {
          if (d.needsPassword) setNeedsPassword(true);
          setError(d.message || "Could not read that file.");
          return;
        }
        setNeedsPassword(false); setPassword("");
        await load();
      } catch { setError("Upload failed."); } finally { setBusy(false); }
    };
    reader.readAsDataURL(file);
  };

  return (
    <Modal title="Attachments" sub="Uploaded documents are parsed, stored privately, and attached to this record." onClose={p.onClose}>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <select className="rounded-lg border border-zinc-900/15 bg-white/80 px-2.5 py-2 text-xs outline-none" value={kind} onChange={(e) => setKind(e.target.value)}>
          {["NATIONAL_ID", "BANK_STATEMENT", "FEE_STRUCTURE", "INVOICE", "PERMIT", "OTHER"].map((k) => <option key={k} value={k}>{k.replace(/_/g, " ")}</option>)}
        </select>
        {needsPassword && (
          <input className="rounded-lg border border-zinc-900/15 bg-white/80 px-2.5 py-2 text-xs outline-none" placeholder="PDF password"
            value={password} onChange={(e) => setPassword(e.target.value)} />
        )}
        <button onClick={() => fileRef.current?.click()} disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-semibold text-white disabled:opacity-50" style={{ backgroundColor: "var(--brand)" }}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />} Upload
        </button>
        <input ref={fileRef} type="file" accept="application/pdf,image/*" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ""; }} />
      </div>
      <Err error={error} />
      <div className="mt-3 max-h-64 space-y-1.5 overflow-y-auto">
        {docs == null && <div className="flex justify-center py-4"><Loader2 className="h-4 w-4 animate-spin text-zinc-400" /></div>}
        {docs?.length === 0 && <p className="py-3 text-center text-xs text-zinc-500">Nothing on file yet.</p>}
        {docs?.map((d) => (
          <div key={d.id} className="flex items-center justify-between gap-2 rounded-lg border border-zinc-900/10 bg-white/60 px-3 py-2">
            <span className="flex min-w-0 items-center gap-2 text-xs">
              <FileText className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
              <span className="truncate font-medium text-zinc-700">{d.filename}</span>
            </span>
            <span className="flex shrink-0 items-center gap-1.5 text-[10px]">
              <span className="rounded bg-zinc-900/5 px-1.5 py-0.5 font-semibold text-zinc-500">{d.kind.replace(/_/g, " ")}</span>
              <span className={`rounded px-1.5 py-0.5 font-bold ${d.status === "PARSED" ? "bg-emerald-100 text-emerald-700" : d.status === "REVIEW" ? "bg-amber-100 text-amber-700" : "bg-zinc-900/5 text-zinc-500"}`}>{d.status}</span>
            </span>
          </div>
        ))}
      </div>
    </Modal>
  );
}
