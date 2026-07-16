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
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useLoad } from "@/lib/hooks/useLoad";
import {
  MoreVertical, UserPen, Users, Banknote, Gauge, Paperclip, UserCog, MessageSquare,
  Loader2, X, CheckCircle2, AlertTriangle, FileText, Upload, ScanFace, Calculator,
  Download, Trash2, Scale, MapPin, User, Receipt, ChevronRight, ShieldCheck,
  Building2, Home, Navigation,
} from "lucide-react";
import { PinDropMap, type LatLng } from "@/components/maps/PinDropMap";

type Kin = { name?: string; relationship?: string; phone?: string } | null;
type Props = {
  borrowerId: string;
  name: string;
  phone: string;
  email: string | null;
  nationalId: string | null;
  locationType: string | null;
  locationAddress: string | null;
  lat: number | null;
  lng: number | null;
  homeLat: number | null;
  homeLng: number | null;
  homeAddress: string | null;
  loanLimit: number | null;
  creditScore: number | null;
  riskBand: string | null;
  nextOfKin: Kin;
  verified: boolean;
};

type ModalKind = "info" | "kin" | "limit" | "score" | "assign" | "attachments" | "erase" | "location" | "locations" | "profile" | "limitcheck" | null;

/** Where a customer can be found. `address` may be null — a pin without one still routes. */
export type Place = {
  kind: "business" | "home";
  lat: number;
  lng: number;
  address: string | null;
};

/**
 * The places we hold for this customer.
 *
 * The primary pin (lat/lng) is whichever place was captured first — locationType says
 * which — and homeLat/homeLng holds a home captured alongside a business. So "which
 * pin is the business?" is a question about locationType, not about the column name.
 */
export function placesOf(p: {
  lat: number | null; lng: number | null; locationType: string | null; locationAddress: string | null;
  homeLat: number | null; homeLng: number | null; homeAddress: string | null;
}): Place[] {
  const out: Place[] = [];
  if (p.lat != null && p.lng != null) {
    out.push({
      kind: p.locationType === "home" ? "home" : "business",
      lat: p.lat, lng: p.lng, address: p.locationAddress,
    });
  }
  if (p.homeLat != null && p.homeLng != null && !out.some((x) => x.kind === "home")) {
    out.push({ kind: "home", lat: p.homeLat, lng: p.homeLng, address: p.homeAddress });
  }
  return out;
}

/** The browser takes it from here — the route answers with a Content-Disposition. */
function download(url: string) {
  window.location.href = url;
}

export function BorrowerMenu(props: Props) {
  const router = useRouter();
  // Mount + slide without setState-in-effect: opening mounts the drawer and a rAF
  // flips it into view; closing slides it out, then unmounts after the transition —
  // so no invisible full-screen overlay is ever left capturing clicks.
  const [mounted, setMounted] = useState(false);
  const [shown, setShown] = useState(false);
  const openDrawer = () => { setMounted(true); requestAnimationFrame(() => setShown(true)); };
  const closeDrawer = () => { setShown(false); setTimeout(() => setMounted(false), 300); };
  // The Needs-Location worklist deep-links here with ?drop=location — open straight
  // onto the pin-drop. Read from a lazy initial state (not an effect) so there is no
  // cascading render, and no Suspense boundary forced onto the page by useSearchParams.
  const [modal, setModal] = useState<ModalKind>(() =>
    typeof window !== "undefined" && new URLSearchParams(window.location.search).get("drop") === "location"
      ? "location" : null,
  );
  const [toast, setToast] = useState<string | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const places = placesOf(props);

  // The drawer closes on its own backdrop; Escape closes it from anywhere.
  useEffect(() => {
    if (!mounted) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") closeDrawer(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [mounted]);

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
    closeDrawer();
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
    <div ref={wrap} className="shrink-0">
      {/* The one way in — the kebab, pinned to the furthest top-right of the identity
          card by the page. Everything an officer may DO to this account opens from
          the right, as a drawer, so the card underneath stays a read. */}
      <button
        onClick={openDrawer}
        aria-label="Open the borrower menu"
        aria-expanded={mounted}
        className="flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-900/10 bg-white/70 text-zinc-500 transition-colors hover:bg-white hover:text-zinc-800"
      >
        <MoreVertical className="h-4.5 w-4.5" />
      </button>

      {mounted && (
        <div className="fixed inset-0 z-50">
          {/* THE ICE. The whole page behind freezes over — top to bottom, edge to edge —
              so the drawer reads as the only live thing on screen. A 1px blur (what this
              used to be) is not an effect, it is a rounding error: the page stayed sharp,
              the drawer looked pasted on, and nothing told the eye where to go.
              Click anywhere on it to close. */}
          <div
            className={`absolute inset-0 bg-zinc-900/25 backdrop-blur-md backdrop-saturate-[0.85] transition-opacity duration-300 ${shown ? "opacity-100" : "opacity-0"}`}
            onClick={() => closeDrawer()}
          />
          {/* The drawer. SOLID white — .glass's translucent background beats bg-* in the
              cascade, and the labels must stay readable over whatever is behind.
              A three-part column: the header and footer never move, only the middle
              scrolls, so the way out is always on screen. */}
          <div
            className={`absolute inset-y-0 right-0 flex w-[min(380px,92vw)] flex-col bg-white shadow-[0_0_80px_rgba(0,0,0,0.35)] transition-transform duration-300 ease-out ${shown ? "translate-x-0" : "translate-x-full"}`}
            role="dialog"
            aria-modal="true"
            aria-label={`Manage ${props.name}`}
          >
            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-zinc-900/10 px-4 py-3.5">
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-400">Borrower menu</p>
                <p className="truncate text-sm font-bold text-zinc-800">{props.name}</p>
              </div>
              <button onClick={() => closeDrawer()} className="shrink-0 rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-900/5 hover:text-zinc-700" aria-label="Close the borrower menu">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1.5">
              {groupLabel("Overview")}
              {item(<User {...ic} />, "Profile", "KYC, age, branch, officer, guarantor, limit & score", () => { closeDrawer(); setModal("profile"); })}
              {item(<Scale {...ic} />, "Check limit", "What they qualify for right now, per product", () => { closeDrawer(); setModal("limitcheck"); })}
              {item(<Receipt {...ic} />, "Customer statement", "Every shilling in and out, plus their savings", () => { router.push(`/console/borrowers/${props.borrowerId}/statement`); })}

              {groupLabel("Account")}
              {item(<UserPen {...ic} />, "Update details", "Name, phone, ID, email, address", () => { closeDrawer(); setModal("info"); })}
              {item(<Users {...ic} />, "Next of kin", props.nextOfKin?.name ? `${props.nextOfKin.name} · ${props.nextOfKin.relationship}` : "Who to call when they can't be reached", () => { closeDrawer(); setModal("kin"); })}
              {item(<UserCog {...ic} />, "Officer & branch", "Move them to a different book", () => { closeDrawer(); setModal("assign"); })}
              {item(
                <MapPin {...ic} />, "Locations",
                places.length
                  ? `${places.map((x) => (x.kind === "business" ? "Business" : "Home")).join(" · ")} — open a route to them`
                  : "No pin yet — drop it so they can be found and routed to",
                () => { closeDrawer(); setModal("locations"); },
              )}

              {groupLabel("Credit")}
              {item(<Banknote {...ic} />, "Loan limit", props.loanLimit != null ? `Currently KES ${Math.round(props.loanLimit).toLocaleString()}` : "No limit set — the engine decides", () => { closeDrawer(); setModal("limit"); })}
              {item(<Gauge {...ic} />, "Credit score", props.creditScore != null ? `Currently ${props.creditScore} / 900` : "No score yet", () => { closeDrawer(); setModal("score"); })}
              {item(<Calculator {...ic} />, "Crunch their statement", "Score their M-Pesa statement — the report saves back here", () => { router.push(`/console/crunch?borrowerId=${props.borrowerId}&from=360`); })}

              {groupLabel("Records")}
              {item(<Paperclip {...ic} />, "Attachments", "Upload and read their documents", () => { closeDrawer(); setModal("attachments"); })}
              {!props.verified && item(<MessageSquare {...ic} />, "Send verification link", "Text them the KYC link", sendKycLink)}
              {!props.verified && item(<ScanFace {...ic} />, "Verify at the counter", "They're with you — run KYC now", () => { router.push(`/console/kyc/${props.borrowerId}?from=360`); })}

              {/* Where a data-protection request actually arrives: an officer, with the
                  customer on the phone, asking for their data or asking to be forgotten. */}
              {groupLabel("Their data")}
              {item(<Download {...ic} />, "Give them a copy", "Everything you hold about them, as a file they can keep", () => {
                closeDrawer();
                download(`/api/console/compliance/export?scope=borrower&id=${props.borrowerId}`);
              })}
              {item(<Trash2 className="h-3.5 w-3.5 text-rose-500" />, "Erase them", "They asked to be forgotten — see what the law lets you delete", () => { closeDrawer(); setModal("erase"); })}
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full bg-zinc-900 px-4 py-2 text-xs font-semibold text-white shadow-lg">
          {toast}
        </div>
      )}

      {modal === "profile" && <ProfileModal borrowerId={props.borrowerId} onClose={() => setModal(null)} />}
      {modal === "limitcheck" && <LimitCheckModal borrowerId={props.borrowerId} onClose={() => setModal(null)} />}
      {modal === "info" && <InfoModal {...props} onClose={() => setModal(null)} onDone={done} />}
      {modal === "kin" && <KinModal {...props} onClose={() => setModal(null)} onDone={done} />}
      {modal === "limit" && <LimitModal {...props} onClose={() => setModal(null)} onDone={done} />}
      {modal === "score" && <ScoreModal {...props} onClose={() => setModal(null)} onDone={done} />}
      {modal === "assign" && <AssignModal {...props} onClose={() => setModal(null)} onDone={done} />}
      {modal === "location" && <LocationModal {...props} onClose={() => setModal(null)} onDone={done} />}
      {modal === "locations" && (
        <LocationsModal {...props} onClose={() => setModal(null)} onPin={() => setModal("location")} />
      )}
      {modal === "attachments" && <AttachmentsModal {...props} onClose={() => setModal(null)} />}
      {modal === "erase" && <EraseModal {...props} onClose={() => setModal(null)} onDone={done} />}
    </div>
  );
}

// ── Erasure ───────────────────────────────────────────────────────────────────
//
// THE OFFICER READS THE TRUTH BEFORE THEY PROMISE IT. The customer is very often on
// the phone when this modal opens, and "yes, we've deleted you" is the wrong answer
// for anyone who has ever taken a loan — POCAMLA makes us keep the financial record
// for seven years. So the modal opens by ASKING THE SERVER what erasing this
// particular person would really do, and shows the answer in words the officer can
// read down the line, before there is anything to press.
//
// Raising the request does not erase anyone. It goes to the register for a second
// pair of eyes (/console/compliance).

type Assessment = {
  mode: "HARD_DELETE" | "ANONYMISE";
  summary: string;
  destroys: string[];
  retains: { what: string; count: number; basis: string }[];
  alreadyErased: boolean;
};

function EraseModal(p: Props & { onClose: () => void; onDone: (m: string) => void }) {
  const [assessment, setAssessment] = useState<Assessment | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The assessment is computed server-side from live data — never guessed here.
  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/console/borrowers/${p.borrowerId}/erasure-assessment`);
      const d = await res.json();
      if (!d.success) { setError(d.message || "Could not work out what may be erased."); return; }
      setAssessment(d.assessment);
    } catch { setError("Could not reach the server."); }
  }, [p.borrowerId]);
  useLoad(load);

  const raise = async () => {
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/console/compliance", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "BORROWER_ERASURE", borrowerId: p.borrowerId, reason }),
      });
      const d = await res.json();
      if (!d.success) { setError(d.message || "Could not raise the request."); return; }
      p.onDone("Erasure requested. It waits in Compliance for a second pair of eyes.");
    } catch { setError("Could not reach the server."); } finally { setBusy(false); }
  };

  return (
    <Modal title="Erase this customer" sub="What the law lets you delete — and what it makes you keep." onClose={p.onClose}>
      {!assessment && !error && (
        <p className="mt-4 flex items-center gap-2 text-sm text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" /> Working out what may be erased…</p>
      )}
      <Err error={error} />

      {assessment?.alreadyErased && (
        <p className="mt-4 rounded-lg bg-zinc-900/5 px-3 py-2.5 text-sm text-zinc-600">This customer has already been erased.</p>
      )}

      {assessment && !assessment.alreadyErased && (
        <>
          <div className={`mt-4 rounded-xl border px-3 py-2.5 ${assessment.mode === "HARD_DELETE" ? "border-rose-300 bg-rose-50" : "border-amber-300 bg-amber-50"}`}>
            <p className={`flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide ${assessment.mode === "HARD_DELETE" ? "text-rose-700" : "text-amber-700"}`}>
              <Scale className="h-3.5 w-3.5" />
              {assessment.mode === "HARD_DELETE" ? "Everything can go" : "Anonymise — the loan record must stay"}
            </p>
            <p className="mt-1 text-[12px] leading-relaxed text-zinc-700">{assessment.summary}</p>
          </div>

          <div className="mt-3">
            <p className="text-[10px] font-bold uppercase tracking-wide text-zinc-400">Destroyed, permanently</p>
            <ul className="mt-1 space-y-0.5 text-[12px] text-zinc-600">
              {assessment.destroys.map((d, i) => <li key={i}>• {d}</li>)}
            </ul>
          </div>

          {assessment.retains.length > 0 && (
            <div className="mt-3">
              <p className="text-[10px] font-bold uppercase tracking-wide text-zinc-400">Kept — the law requires it</p>
              <ul className="mt-1 space-y-1 text-[12px] text-zinc-600">
                {assessment.retains.map((r, i) => (
                  <li key={i}>• {r.what}<span className="block pl-2 text-[10px] italic text-zinc-400">{r.basis}</span></li>
                ))}
              </ul>
            </div>
          )}

          <label className="mt-4 block">
            <span className="text-xs font-semibold text-zinc-600">Why is this being erased?</span>
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2}
              placeholder="The customer asked us to delete their data on 14 July, by phone."
              className={`${FIELD} mt-1`} />
            <span className="text-[10px] text-zinc-400">Goes on the record. An ODPC inspector reads this.</span>
          </label>

          <div className="mt-4 flex items-center gap-2">
            <button onClick={raise} disabled={busy || reason.trim().length < 10}
              className="inline-flex items-center gap-2 rounded-lg bg-rose-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-50">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />} Request erasure
            </button>
            <button onClick={p.onClose} className="rounded-lg border border-zinc-900/15 bg-white/70 px-4 py-2.5 text-sm text-zinc-600">Cancel</button>
          </div>
          <p className="mt-2 text-[10px] text-zinc-400">Nothing is deleted yet — this goes to Compliance for a second pair of eyes.</p>
        </>
      )}
    </Modal>
  );
}

// ── Shared modal chrome ────────────────────────────────────────────────────────

function Modal({ title, sub, children, onClose, wide }: { title: string; sub?: string; children: React.ReactNode; onClose: () => void; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 p-4 backdrop-blur-sm sm:items-center" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      {/* Solid white for the same cascade reason as the kebab dropdown. */}
      <div className={`max-h-[92vh] w-full overflow-y-auto rounded-3xl border border-zinc-900/10 bg-white p-5 shadow-2xl ${wide ? "max-w-lg" : "max-w-md"}`}>
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

// ── Profile — the whole customer, read-only, on one card ─────────────────────

type Profile = {
  name: string; phone: string; email: string | null; nationalId: string | null;
  age: number | null; gender: string | null; language: string | null; address: string | null;
  branch: string | null; officer: string | null; customerSince: string;
  kyc: { status: string; provider?: string | null; livenessPassed?: boolean | null; faceMatchScore?: number | null; iprsMatched?: boolean | null; iprsName?: string | null; idQualityScore?: number | null; verifiedAt?: string | null };
  guarantor: { name: string; phone: string; relationship: string | null; status: string; amount: number | null } | null;
  nextOfKin: { name?: string; relationship?: string; phone?: string } | null;
  creditScore: number | null; behaviouralScore: number | null; riskBand: string | null;
  loanLimit: number | null; graduationCount: number; clearedLoans: number; activeLoans: number;
};

function PField({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-zinc-400">{label}</p>
      <p className="text-[13px] font-medium text-zinc-800">{value ?? "—"}</p>
    </div>
  );
}
function PSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-4">
      <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-zinc-400">{title}</p>
      <div className="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-2.5">{children}</div>
    </div>
  );
}

function ProfileModal({ borrowerId, onClose }: { borrowerId: string; onClose: () => void }) {
  const [p, setP] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);
  useLoad(async () => {
    try {
      const res = await fetch(`/api/console/borrowers/${borrowerId}/profile`);
      const d = await res.json();
      if (!d.success) { setError(d.message || "Could not load the profile."); return; }
      setP(d.profile);
    } catch { setError("Could not reach the server."); }
  });

  const Field = PField;
  const Section = PSection;

  return (
    <Modal wide title="Profile" sub={p ? p.name : "The whole customer, in one look."} onClose={onClose}>
      {!p && !error && <p className="mt-4 flex items-center gap-2 text-sm text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>}
      <Err error={error} />
      {p && (
        <>
          <Section title="Identity">
            <Field label="Phone" value={p.phone} />
            <Field label="National ID" value={p.nationalId} />
            <Field label="Age" value={p.age != null ? `${p.age} yrs` : "—"} />
            <Field label="Gender" value={p.gender ? p.gender[0].toUpperCase() + p.gender.slice(1) : "—"} />
            <Field label="Email" value={p.email} />
            <Field label="Language" value={p.language === "sw" ? "Swahili" : p.language === "en" ? "English" : p.language} />
            <div className="col-span-2"><Field label="Address" value={p.address} /></div>
          </Section>

          <Section title="Placement">
            <Field label="Branch" value={p.branch} />
            <Field label="Loan officer" value={p.officer} />
            <Field label="Customer since" value={new Date(p.customerSince).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })} />
            <Field label="Loans" value={`${p.activeLoans} active · ${p.clearedLoans} cleared`} />
          </Section>

          <Section title="KYC">
            <Field label="Status" value={<span className={p.kyc.status === "VERIFIED" ? "text-emerald-700" : "text-amber-700"}>{p.kyc.status}</span>} />
            <Field label="Provider" value={p.kyc.provider} />
            <Field label="Liveness" value={p.kyc.livenessPassed == null ? "—" : p.kyc.livenessPassed ? "Passed" : "Failed"} />
            <Field label="Face match" value={p.kyc.faceMatchScore != null ? `${p.kyc.faceMatchScore}` : "—"} />
            <Field label="IPRS" value={p.kyc.iprsMatched ? `Matched${p.kyc.iprsName ? ` · ${p.kyc.iprsName}` : ""}` : "—"} />
            <Field label="ID quality" value={p.kyc.idQualityScore != null ? `${p.kyc.idQualityScore}` : "—"} />
          </Section>

          <Section title="Credit">
            <Field label="Credit score" value={p.creditScore != null ? `${p.creditScore} / 900` : "—"} />
            <Field label="Behavioural" value={p.behaviouralScore != null ? `${Math.round(p.behaviouralScore)} / 100` : "—"} />
            <Field label="Risk band" value={p.riskBand} />
            <Field label="Loan limit" value={p.loanLimit != null ? `KES ${Math.round(p.loanLimit).toLocaleString()}` : "Engine-decided"} />
            <Field label="Graduated" value={p.graduationCount > 0 ? `×${p.graduationCount}` : "Not yet"} />
          </Section>

          {p.guarantor && (
            <Section title="Current guarantor">
              <Field label="Name" value={p.guarantor.name} />
              <Field label="Phone" value={p.guarantor.phone} />
              <Field label="Relationship" value={p.guarantor.relationship} />
              <Field label="Status" value={p.guarantor.status} />
              {p.guarantor.amount != null && <Field label="Guaranteed" value={`KES ${Math.round(p.guarantor.amount).toLocaleString()}`} />}
            </Section>
          )}

          {p.nextOfKin?.name && (
            <Section title="Next of kin">
              <Field label="Name" value={p.nextOfKin.name} />
              <Field label="Relationship" value={p.nextOfKin.relationship} />
              <Field label="Phone" value={p.nextOfKin.phone} />
            </Section>
          )}
        </>
      )}
    </Modal>
  );
}

// ── Check limit — what they qualify for right now, per product ────────────────

type LimitRow = {
  productId: string; productName: string; interestRate: number; interestMethod: string;
  guarantorRequired: boolean; securityRequired: boolean;
  approvedLimit: number; affordableInstallment: number | null; installmentCount: number | null; installmentUnit: string | null;
  borrowerClass: string;
};
type LimitBasis = { hasStatement: boolean; avgMonthlyNet: number | null; statementScore: number | null; borrowerClass: string; graduated: boolean; priorLoanCount: number };

function LimitCheckModal({ borrowerId, onClose }: { borrowerId: string; onClose: () => void }) {
  const [data, setData] = useState<{ basis: LimitBasis; products: LimitRow[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useLoad(async () => {
    try {
      const res = await fetch(`/api/console/borrowers/${borrowerId}/limit-check`);
      const d = await res.json();
      if (!d.success) { setError(d.message || "Could not check the limit."); return; }
      setData({ basis: d.basis, products: d.products });
    } catch { setError("Could not reach the server."); }
  });

  const rows = data?.products.slice().sort((a, b) => Number(b.approvedLimit > 0) - Number(a.approvedLimit > 0) || b.approvedLimit - a.approvedLimit) ?? [];
  const qualifies = rows.filter((r) => r.approvedLimit > 0).length;

  return (
    <Modal wide title="Check limit" sub="What they qualify for right now — before anyone applies." onClose={onClose}>
      {!data && !error && <p className="mt-4 flex items-center gap-2 text-sm text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" /> Sizing against their statement…</p>}
      <Err error={error} />
      {data && (
        <>
          <div className="mt-4 rounded-xl border border-zinc-900/10 bg-zinc-900/[0.02] px-3 py-2.5">
            {data.basis.hasStatement ? (
              <p className="text-[12px] text-zinc-600">
                Sized from a crunched statement — about <span className="font-semibold text-zinc-800">KES {Math.round(data.basis.avgMonthlyNet ?? 0).toLocaleString()}</span> net a month
                {data.basis.statementScore != null && <> · score <span className="font-semibold">{data.basis.statementScore}</span></>}.
              </p>
            ) : (
              <p className="text-[12px] text-amber-700">No crunched statement on file — limits rest on history alone. <span className="text-zinc-500">Crunch a statement for a sharper number.</span></p>
            )}
            <p className="mt-1 text-[11px] text-zinc-500">
              {data.basis.borrowerClass === "NEW" ? "First cycle with this lender — capped on the new-borrower ladder." : data.basis.borrowerClass === "GRADUATED" ? "Graduated — the upper tiers are unlocked." : `Returning · ${data.basis.priorLoanCount} repaid.`}
              {" "}Qualifies for <span className="font-semibold text-zinc-700">{qualifies}</span> of {rows.length} products.
            </p>
          </div>

          <div className="mt-3 space-y-2">
            {rows.map((r) => {
              const ok = r.approvedLimit > 0;
              return (
                <div key={r.productId} className={`rounded-xl border px-3 py-2.5 ${ok ? "border-emerald-200 bg-emerald-50/40" : "border-zinc-900/10 bg-zinc-900/[0.02] opacity-70"}`}>
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-zinc-800 flex items-center gap-1.5">
                      {r.productName}
                      {r.guarantorRequired && <ShieldCheck className="h-3 w-3 text-amber-500" />}
                    </p>
                    {ok ? (
                      <span className="text-sm font-bold" style={{ color: "var(--brand)" }}>KES {r.approvedLimit.toLocaleString()}</span>
                    ) : (
                      <span className="text-[11px] font-semibold text-zinc-400">Does not qualify</span>
                    )}
                  </div>
                  <p className="mt-0.5 text-[11px] text-zinc-500">
                    {Number(r.interestRate)}% {r.interestMethod}
                    {ok && r.affordableInstallment != null && (
                      <> · about <span className="font-medium text-zinc-700">KES {r.affordableInstallment.toLocaleString()}</span>/{(r.installmentUnit ?? "month").replace(/s$/, "")} × {r.installmentCount}</>
                    )}
                  </p>
                </div>
              );
            })}
          </div>
          <p className="mt-3 text-[10px] text-zinc-400 flex items-center gap-1">
            <ChevronRight className="h-3 w-3" /> The engine recomputes this at apply time and enforces it — this preview cannot flatter.
          </p>
        </>
      )}
    </Modal>
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

// The officer is standing with the customer and drops their pin by hand — the
// business (or home) they were registered without. Once saved, they surface on
// field routes and the disbursement location gate is satisfied.
// ── Locations ────────────────────────────────────────────────────────────────
//
// Where this customer can actually be found, and the one click that turns that into a
// route. An officer asking "where are they?" is almost never asking out of curiosity —
// they are about to go, or about to send someone. So the answer and the going are the
// same screen.
//
// The handoff to the Route Map is by ID, not coordinates: /console/field/map?to=<id>.
// The map re-reads the pin server-side, so a link that gets pasted into a chat cannot
// quietly send an agent to coordinates somebody edited in the URL bar.

function LocationsModal(p: Props & { onClose: () => void; onPin: () => void }) {
  const router = useRouter();
  const places = placesOf(p);

  const navigate = (place: Place) => {
    router.push(`/console/field/map?to=${p.borrowerId}&place=${place.kind}`);
  };

  return (
    <Modal title="Locations" sub={`Where ${p.name} can be found`} onClose={p.onClose}>
      {places.length === 0 ? (
        <div className="mt-4 rounded-2xl border border-dashed border-zinc-900/15 bg-zinc-50/60 p-5 text-center">
          <MapPin className="mx-auto h-6 w-6 text-zinc-300" />
          <p className="mt-2 text-sm font-semibold text-zinc-700">No location on file</p>
          <p className="mx-auto mt-1 max-w-xs text-xs leading-relaxed text-zinc-500">
            Nobody can be routed to them, and a disbursement will be refused while this lender
            requires a pin. Drop one while you are with them — the map reads their GPS.
          </p>
          <button
            onClick={() => { p.onClose(); p.onPin(); }}
            className="mt-3 inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold text-white"
            style={{ backgroundColor: "var(--brand)" }}
          >
            <MapPin className="h-3.5 w-3.5" /> Drop their pin
          </button>
        </div>
      ) : (
        <div className="mt-4 space-y-2">
          {places.map((place) => (
            <div key={place.kind} className="rounded-2xl border border-zinc-900/10 bg-white/70 p-3.5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 text-[13px] font-bold text-zinc-800">
                    <span className="flex h-6 w-6 items-center justify-center rounded-lg" style={{ backgroundColor: "var(--brand-soft)" }}>
                      {place.kind === "business" ? <Building2 className="h-3.5 w-3.5" style={{ color: "var(--brand)" }} /> : <Home className="h-3.5 w-3.5" style={{ color: "var(--brand)" }} />}
                    </span>
                    {place.kind === "business" ? "Business" : "Home"}
                  </p>
                  <p className="mt-1.5 text-xs leading-snug text-zinc-600">
                    {place.address ?? <span className="text-zinc-400">Pin dropped, no address written down</span>}
                  </p>
                  <p className="mt-1 font-mono text-[10px] text-zinc-400">
                    {place.lat.toFixed(5)}, {place.lng.toFixed(5)}
                  </p>
                </div>
                <button
                  onClick={() => navigate(place)}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-2 text-[11px] font-semibold text-white"
                  style={{ backgroundColor: "var(--brand)" }}
                >
                  <Navigation className="h-3.5 w-3.5" /> Directions
                </button>
              </div>
            </div>
          ))}
          <button
            onClick={() => { p.onClose(); p.onPin(); }}
            className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-zinc-900/15 py-2.5 text-xs font-semibold text-zinc-500 hover:bg-zinc-900/[0.03] hover:text-zinc-700"
          >
            <MapPin className="h-3.5 w-3.5" />
            {places.length === 1 ? `Add their ${places[0].kind === "business" ? "home" : "business"}` : "Update a pin"}
          </button>
        </div>
      )}
    </Modal>
  );
}

function LocationModal(p: Props & { onClose: () => void; onDone: (m: string) => void }) {
  const [which, setWhich] = useState<"business" | "home">(
    // Default to whichever pin is still MISSING, so the officer fills the gap.
    p.lat != null && p.homeLat == null ? "home" : "business",
  );
  const initial: LatLng | null =
    which === "home"
      ? (p.homeLat != null && p.homeLng != null ? { lat: p.homeLat, lng: p.homeLng } : null)
      : (p.lat != null && p.lng != null ? { lat: p.lat, lng: p.lng } : null);
  const [pin, setPin] = useState<LatLng | null>(initial);
  const [landmark, setLandmark] = useState("");
  const [street, setStreet] = useState("");
  const [lane, setLane] = useState("");
  const { busy, error, run } = useAction(p.onDone);

  // Switching business⇄home re-seeds the pin from that place's existing coordinates.
  const pick = (w: "business" | "home") => {
    setWhich(w);
    setPin(w === "home"
      ? (p.homeLat != null && p.homeLng != null ? { lat: p.homeLat, lng: p.homeLng } : null)
      : (p.lat != null && p.lng != null ? { lat: p.lat, lng: p.lng } : null));
  };

  return (
    <Modal
      wide
      title="Drop their location"
      sub="Place the pin where the customer actually is. It puts them on field routes and clears the disbursement location gate."
      onClose={p.onClose}
    >
      <div className="mt-4">
        <div className="inline-flex rounded-lg border border-zinc-900/12 bg-zinc-900/[0.03] p-0.5 text-xs font-semibold">
          {(["business", "home"] as const).map((w) => (
            <button key={w} onClick={() => pick(w)}
              className={`rounded-md px-3 py-1.5 capitalize transition-colors ${which === w ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500"}`}>
              {w}
            </button>
          ))}
        </div>

        <div className="mt-3">
          <PinDropMap value={pin} onChange={setPin} height={280} />
        </div>

        {/* A lat-lng is where; these three are how a boda actually finds it. */}
        <div className="mt-3 space-y-2">
          <input className={FIELD} placeholder="Landmark (e.g. next to Caltex Donholm)" value={landmark} onChange={(e) => setLandmark(e.target.value)} />
          <div className="flex gap-2">
            <input className={FIELD} placeholder="Street / road" value={street} onChange={(e) => setStreet(e.target.value)} />
            <input className={FIELD} placeholder="Lane / plot" value={lane} onChange={(e) => setLane(e.target.value)} />
          </div>
        </div>
      </div>

      <Err error={error} />
      <SaveRow busy={busy} onClose={p.onClose} label="Save pin"
        onSave={() => {
          if (!pin) return;
          run(p.borrowerId, {
            action: "location", locationType: which,
            lat: pin.lat, lng: pin.lng, landmark, street, lane,
          }, `${which === "home" ? "Home" : "Business"} location saved.`);
        }} />
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
