"use client";

// ─────────────────────────────────────────────────────────────────────────────
// CHARGES, TIED TO THE PRODUCT.
//
// The one part of the builder that does NOT edit the definition. A fee is a price,
// and a price is a row: it changes on a Tuesday afternoon because a lender decided
// it does, and republishing a whole product version to move a processing fee from
// 5% to 6% would make the version history unreadable for the thing versions exist
// to protect — the terms a borrower agreed to.
//
// So this step reads and writes /api/console/charges directly, scoped to this
// product, and shows the shelf-wide fees that also land here as read-only context.
// That distinction is the one ServiceSuite's ProductFees table cannot draw: there,
// every fee belongs to exactly one product, so a lender charging the same KES 100
// CRB fee on eleven products maintains eleven rows and, inevitably, eleven prices.
//
// A product that has not been created yet has nothing to hang a fee off. Rather than
// invent a draft-charge concept, the step says so and the fees are added the moment
// the product exists — which is also when the lender can see what they are pricing.
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useState } from "react";
import Link from "next/link";
import { useLoad } from "@/lib/hooks/useLoad";
import {
  Plus, Loader2, AlertTriangle, CheckCircle2, Trash2, Lock, Coins, Pencil, X,
} from "lucide-react";
import {
  CHARGE_TRIGGERS, CHARGE_APPLY_AT, CHARGE_VALUE_TYPES, PERCENT_REFERENCES,
  EMPTY_CHARGE, describeCharge, validateCharge, priceCharge, type ChargeShape,
} from "@/lib/products/charges";
import {
  Toggle, Choice, NumberField, TextField, SelectField, Divider,
} from "@/components/settings/controls";

type Row = ChargeShape & { summary: string; locked: boolean; ownedByProduct: boolean };

export function ChargesStep({
  productId,
  /** Used to show what each fee actually costs on a real loan from this product. */
  sample,
}: {
  productId: string | null;
  sample: { principal: number; totalRepayable: number; instalment: number };
}) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<ChargeShape | null>(null);

  const load = useCallback(async () => {
    if (!productId) { setRows([]); return; }
    try {
      const res = await fetch(`/api/console/charges?productId=${productId}`);
      const d = await res.json();
      if (!d.success) { setError(d.message ?? "Could not load charges."); return; }
      setRows(d.charges ?? []);
      setError(null);
    } catch { setError("Could not reach the server."); }
  }, [productId]);
  useLoad(load);

  const issues = draft ? validateCharge(draft) : [];
  const issueFor = (path: string) => issues.find((i) => i.path === path)?.message ?? null;

  const save = async () => {
    if (!draft || issues.length) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      const res = await fetch("/api/console/charges", {
        method: draft.id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...draft, productId }),
      });
      const d = await res.json();
      if (!d.success) { setError(d.message ?? "Could not save the charge."); return; }
      setNotice(`${draft.name} saved — ${describeCharge(draft)}.`);
      setDraft(null);
      await load();
    } catch { setError("Could not reach the server."); } finally { setBusy(false); }
  };

  const remove = async (id: string) => {
    setBusy(true); setError(null); setNotice(null);
    try {
      const res = await fetch(`/api/console/charges?id=${id}`, { method: "DELETE" });
      const d = await res.json();
      if (!d.success) { setError(d.message ?? "Could not remove the charge."); return; }
      if (d.message) setNotice(d.message);
      await load();
    } catch { setError("Could not reach the server."); } finally { setBusy(false); }
  };

  const setActive = async (r: Row, isActive: boolean) => {
    await fetch("/api/console/charges", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: r.id, isActive }),
    });
    await load();
  };

  if (!productId) {
    return (
      <div className="rounded-xl bg-[color:var(--ink)]/[0.03] px-4 py-6 text-center">
        <Coins className="mx-auto h-5 w-5 text-[color:var(--ink-faint)]" />
        <p className="mt-2 text-[13px] font-semibold text-[color:var(--ink)]">Fees come after the product exists</p>
        <p className="t-meta mx-auto mt-1 max-w-md text-[12px]">
          Publish this product first, then come back and price it. A fee is a row against
          a real product, not a draft — that is what stops it drifting from the terms.
        </p>
      </div>
    );
  }

  const own = (rows ?? []).filter((r) => r.ownedByProduct);
  const shelf = (rows ?? []).filter((r) => !r.ownedByProduct);

  return (
    <div className="space-y-5">
      {notice && (
        <p className="flex items-start gap-2 rounded-xl bg-emerald-500/10 px-3 py-2.5 text-[12px] text-emerald-800 ring-1 ring-emerald-600/20">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> {notice}
        </p>
      )}
      {error && (
        <p className="flex items-start gap-2 rounded-xl bg-red-500/10 px-3 py-2.5 text-[12px] text-red-800 ring-1 ring-red-600/20">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
        </p>
      )}

      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="t-label">This product&apos;s fees</p>
          <p className="t-meta text-[11px]">
            Priced against a sample loan of KES {sample.principal.toLocaleString()}.
          </p>
        </div>
        <button
          type="button"
          onClick={() => { setDraft({ ...EMPTY_CHARGE, productId }); setNotice(null); setError(null); }}
          className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-bold text-white"
          style={{ backgroundColor: "var(--brand)" }}
        >
          <Plus className="h-3.5 w-3.5" /> Add charge
        </button>
      </div>

      {rows === null ? (
        <div className="flex justify-center py-8"><Loader2 className="h-4 w-4 animate-spin text-[color:var(--ink-faint)]" /></div>
      ) : (
        <>
          {own.length === 0 ? (
            <p className="t-meta rounded-xl bg-[color:var(--ink)]/[0.03] px-3 py-2.5 text-[12px]">
              No fees of its own. The product costs what its interest rate says and nothing more.
            </p>
          ) : (
            <ul className="space-y-2">
              {own.map((r) => (
                <ChargeRow
                  key={r.id} r={r} sample={sample} busy={busy}
                  onEdit={() => setDraft(r)} onRemove={() => r.id && remove(r.id)}
                  onActive={(v) => setActive(r, v)}
                />
              ))}
            </ul>
          )}

          {shelf.length > 0 && (
            <>
              <Divider label="Also applies here" />
              <p className="t-meta text-[12px]">
                Shelf-wide fees, priced once and charged on every product. Change them on the{" "}
                <Link href="/console/charges" className="font-semibold underline">Charges</Link> screen.
              </p>
              <ul className="space-y-2">
                {shelf.map((r) => (
                  <ChargeRow key={r.id} r={r} sample={sample} busy={busy} readOnly />
                ))}
              </ul>
            </>
          )}
        </>
      )}

      {draft && (
        <ChargeDrawer
          draft={draft} setDraft={setDraft} onSave={save} busy={busy}
          issues={issues} issueFor={issueFor} sample={sample}
        />
      )}
    </div>
  );
}

// ── One row ───────────────────────────────────────────────────────────────────

function ChargeRow({
  r, sample, busy, readOnly, onEdit, onRemove, onActive,
}: {
  r: Row;
  sample: { principal: number; totalRepayable: number; instalment: number };
  busy: boolean;
  readOnly?: boolean;
  onEdit?: () => void;
  onRemove?: () => void;
  onActive?: (v: boolean) => void;
}) {
  const priced = priceCharge(r, sample);
  const locked = readOnly || r.locked;

  return (
    <li
      className="flex flex-wrap items-start justify-between gap-3 rounded-xl px-3 py-2.5 ring-1 ring-[color:var(--ink)]/[0.07]"
      style={r.isActive ? undefined : { opacity: 0.55 }}
    >
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-1.5 text-[13px] font-semibold text-[color:var(--ink)]">
          {r.name}
          <span className="rounded bg-[color:var(--ink)]/[0.06] px-1.5 py-0.5 font-mono text-[10px] tracking-wide">{r.code}</span>
          {r.locked && (
            <span className="inline-flex items-center gap-1 rounded-full bg-[color:var(--ink)]/[0.06] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[color:var(--ink-muted)]">
              <Lock className="h-2.5 w-2.5" /> Platform
            </span>
          )}
          <span
            className="rounded-full px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide"
            style={r.isMandatory
              ? { backgroundColor: "var(--brand-soft)", color: "var(--ink)" }
              : { backgroundColor: "rgba(15,15,25,0.06)", color: "var(--ink-muted)" }}
          >
            {r.isMandatory ? "Mandatory" : "Optional"}
          </span>
        </p>
        <p className="t-meta mt-0.5 text-[11px] leading-snug">
          {describeCharge(r)} · {CHARGE_APPLY_AT.find((a) => a.key === r.applyAt)?.label}
          {r.minPrincipal !== null || r.maxPrincipal !== null
            ? ` · loans ${r.minPrincipal ? `from KES ${r.minPrincipal.toLocaleString()}` : ""}${r.maxPrincipal ? ` to KES ${r.maxPrincipal.toLocaleString()}` : ""}`
            : ""}
          {r.glAccount ? ` · posts to ${r.glAccount}` : ""}
        </p>
      </div>

      <div className="flex items-center gap-3">
        <span className="text-right">
          <span className="block text-[13px] font-bold tabular-nums text-[color:var(--ink)]">
            {priced === null ? "—" : `KES ${Math.round(priced).toLocaleString()}`}
          </span>
          <span className="t-meta block text-[10px]">
            {priced === null ? "outside its band" : "on the sample loan"}
          </span>
        </span>
        {!locked && onActive && <Toggle label="Active" checked={r.isActive} onChange={onActive} />}
        {!locked && onEdit && (
          <button type="button" onClick={onEdit} disabled={busy}
            className="text-[color:var(--ink-faint)] hover:text-[color:var(--ink)]">
            <Pencil className="h-3.5 w-3.5" />
          </button>
        )}
        {!locked && onRemove && (
          <button type="button" onClick={onRemove} disabled={busy}
            className="text-[color:var(--ink-faint)] hover:text-red-500">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </li>
  );
}

// ── The editor ────────────────────────────────────────────────────────────────

function ChargeDrawer({
  draft, setDraft, onSave, busy, issues, issueFor, sample,
}: {
  draft: ChargeShape;
  setDraft: (c: ChargeShape | null) => void;
  onSave: () => void;
  busy: boolean;
  issues: { path: string; message: string }[];
  issueFor: (p: string) => string | null;
  sample: { principal: number; totalRepayable: number; instalment: number };
}) {
  const set = (p: Partial<ChargeShape>) => setDraft({ ...draft, ...p });
  const preview = issues.length === 0 ? priceCharge(draft, sample) : null;
  const percent = draft.valueType !== "fixed";

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-6">
      <div className="glass max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-t-2xl p-5 sm:rounded-2xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="t-display text-[1.15rem]">{draft.id ? "Edit charge" : "Add charge"}</h2>
            <p className="t-meta mt-0.5 text-[12px]">
              What it is called, when it is taken, how it is collected, and how much.
            </p>
          </div>
          <button type="button" onClick={() => setDraft(null)}
            className="rounded-lg p-1.5 text-[color:var(--ink-faint)] hover:text-[color:var(--ink)]">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-4 space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label="Name" value={draft.name} onChange={(v) => set({ name: v })} placeholder="Processing fee" />
            <TextField
              label="Short code" value={draft.code}
              onChange={(v) => set({ code: v.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12) })}
              placeholder="PF"
              help="The customer sees this on their M-Pesa prompt. Short, and never reused."
            />
          </div>
          {(issueFor("name") || issueFor("code")) && (
            <p className="flex items-start gap-1.5 rounded-lg bg-amber-500/10 px-2.5 py-2 text-[11.5px] text-amber-900 ring-1 ring-amber-600/20">
              <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" /> {issueFor("name") ?? issueFor("code")}
            </p>
          )}

          <TextField label="Description" value={draft.description} onChange={(v) => set({ description: v })}
            placeholder="Covers the cost of assessing and booking the loan." />

          <Divider label="Requirement" />
          <Choice
            label="Must it be taken?"
            value={draft.isMandatory ? "mandatory" : "optional"}
            onChange={(v) => set({ isMandatory: v === "mandatory" })}
            cols={2}
            options={[
              { value: "mandatory", label: "Mandatory", hint: "Applied to every loan on this product." },
              { value: "optional", label: "Optional", hint: "The applicant or officer chooses whether to include it." },
            ]}
          />

          <Divider label="When and how" />
          <Choice
            label="When it is raised"
            value={draft.trigger}
            onChange={(v) => set({ trigger: v as ChargeShape["trigger"] })}
            cols={3}
            options={CHARGE_TRIGGERS.map((t) => ({ value: t.key, label: t.label, hint: t.blurb }))}
          />
          <Choice
            label="How it is collected"
            value={draft.applyAt}
            onChange={(v) => set({ applyAt: v as ChargeShape["applyAt"] })}
            cols={3}
            options={CHARGE_APPLY_AT.map((a) => ({ value: a.key, label: a.label, hint: a.blurb }))}
          />
          {issueFor("applyAt") && (
            <p className="flex items-start gap-1.5 rounded-lg bg-amber-500/10 px-2.5 py-2 text-[11.5px] text-amber-900 ring-1 ring-amber-600/20">
              <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" /> {issueFor("applyAt")}
            </p>
          )}

          <Divider label="How much" />
          <Choice
            label="Value type"
            value={draft.valueType}
            onChange={(v) => set({ valueType: v as ChargeShape["valueType"] })}
            cols={3}
            options={CHARGE_VALUE_TYPES.map((t) => ({ value: t.key, label: t.label, hint: t.blurb }))}
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <NumberField
              label={percent ? "Percentage" : "Amount"}
              suffix={percent ? "%" : undefined}
              money={!percent}
              min={0} step={percent ? 0.25 : 1}
              value={draft.value}
              onChange={(v) => set({ value: v })}
            />
            {percent && (
              <SelectField
                label="Percentage of"
                value={draft.percentOf}
                onChange={(v) => set({ percentOf: v as ChargeShape["percentOf"] })}
                options={PERCENT_REFERENCES.map((r) => ({ value: r.key, label: r.label }))}
                help={PERCENT_REFERENCES.find((r) => r.key === draft.percentOf)?.blurb}
              />
            )}
          </div>
          {(issueFor("value") || issueFor("percentOf")) && (
            <p className="flex items-start gap-1.5 rounded-lg bg-amber-500/10 px-2.5 py-2 text-[11.5px] text-amber-900 ring-1 ring-amber-600/20">
              <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" /> {issueFor("value") ?? issueFor("percentOf")}
            </p>
          )}

          {draft.valueType === "hybrid" && (
            <div className="grid gap-4 sm:grid-cols-2">
              <NumberField
                label="Never less than" money min={0}
                value={draft.minValue ?? 0}
                onChange={(v) => set({ minValue: v > 0 ? v : null })}
                help="The floor. 0 = no floor."
              />
              <NumberField
                label="Never more than" money min={0}
                value={draft.maxValue ?? 0}
                onChange={(v) => set({ maxValue: v > 0 ? v : null })}
                help="The ceiling. 0 = no ceiling."
              />
            </div>
          )}
          {(issueFor("minValue") || issueFor("maxValue")) && (
            <p className="flex items-start gap-1.5 rounded-lg bg-amber-500/10 px-2.5 py-2 text-[11.5px] text-amber-900 ring-1 ring-amber-600/20">
              <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" /> {issueFor("minValue") ?? issueFor("maxValue")}
            </p>
          )}

          <Divider label="Which loans it applies to" />
          <div className="grid gap-4 sm:grid-cols-2">
            <NumberField
              label="From principal" money min={0}
              value={draft.minPrincipal ?? 0}
              onChange={(v) => set({ minPrincipal: v > 0 ? v : null })}
              help="0 = any loan size."
            />
            <NumberField
              label="Up to principal" money min={0}
              value={draft.maxPrincipal ?? 0}
              onChange={(v) => set({ maxPrincipal: v > 0 ? v : null })}
              help="0 = no upper bound. A product may price the same fee differently at different loan sizes."
            />
          </div>
          {issueFor("maxPrincipal") && (
            <p className="flex items-start gap-1.5 rounded-lg bg-amber-500/10 px-2.5 py-2 text-[11.5px] text-amber-900 ring-1 ring-amber-600/20">
              <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" /> {issueFor("maxPrincipal")}
            </p>
          )}

          <TextField
            label="GL account" value={draft.glAccount} onChange={(v) => set({ glAccount: v })}
            placeholder="4200 — Fee income"
            help="The income account this fee posts to in the journal. Optional, and free text — your chart of accounts is yours."
          />

          <div className="rounded-xl px-3 py-3 ring-1 ring-[color:var(--ink)]/[0.07]">
            <p className="t-label">On a KES {sample.principal.toLocaleString()} loan</p>
            <p className="mt-1 text-[1.35rem] font-bold tabular-nums" style={{ color: "var(--brand)" }}>
              {preview === null ? "—" : `KES ${Math.round(preview).toLocaleString()}`}
            </p>
            <p className="t-meta text-[11px]">
              {preview === null
                ? issues.length
                  ? "Resolve the problems above to see what this costs."
                  : "This charge does not apply to a loan of that size."
                : describeCharge(draft)}
            </p>
          </div>
        </div>

        <div className="mt-5 flex items-center justify-between gap-3">
          <button type="button" onClick={() => setDraft(null)}
            className="rounded-lg px-3 py-2 text-[12px] font-semibold text-[color:var(--ink-muted)] hover:text-[color:var(--ink)]">
            Cancel
          </button>
          <button
            type="button" onClick={onSave} disabled={busy || issues.length > 0}
            className="inline-flex items-center gap-1.5 rounded-lg px-5 py-2 text-[12px] font-bold text-white disabled:opacity-50"
            style={{ backgroundColor: "var(--brand)" }}
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
            Save charge
          </button>
        </div>
      </div>
    </div>
  );
}

