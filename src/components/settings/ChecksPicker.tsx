"use client";

// ─────────────────────────────────────────────────────────────────────────────
// THE CHECK PICKER — attach an automated verification, anywhere.
//
// One control, three homes: a product's evidence step, a workflow stage, and the
// borrower onboarding settings. That is the whole point of making a check a thing
// rather than a column — the screen for "run CRB here" is the same screen whether
// "here" is the front door or the finance stage, so a lender who wants to move it
// drags it, and nobody ships a migration.
//
// Two details earn their complexity:
//
//   THE CREDENTIAL WARNING. A check whose vault is empty is a queue that silently
//   never clears. The picker knows what each check needs (`requires`) and says so
//   with a link, before it is attached rather than at the counter.
//
//   BLOCKING IS A CHOICE, NOT A PROPERTY. The same bureau pull is a hard gate for
//   one lender and a note on the file for the next. Attaching a check is one click;
//   deciding whether it can stop the flow is a second, deliberate one.
// ─────────────────────────────────────────────────────────────────────────────
import { useMemo } from "react";
import Link from "next/link";
import { AlertTriangle, Check, Coins, Clock, ShieldAlert } from "lucide-react";
import {
  CHECK_GROUPS, CHECK_BY_ID, checksFor, defaultBinding,
  type CheckBinding, type CheckSurface, type CheckSpec,
} from "@/lib/workflow/checks";
import { Toggle, NumberField } from "./controls";

const COST_LABEL: Record<CheckSpec["cost"], string> = {
  free: "Free",
  metered: "Billed per call",
  billable: "Billed per call — you may pass it on",
};

const LATENCY_LABEL: Record<CheckSpec["latency"], string> = {
  instant: "Instant",
  seconds: "A few seconds",
  minutes: "A few minutes",
  human: "Waits for a person",
};

export function ChecksPicker({
  surface,
  value,
  onChange,
  /** Vault kinds that ARE configured, so the picker can warn about the rest. */
  connected = [],
  /** Checks that may not be detached here — a product forced them on. */
  locked = [],
  emptyHint,
}: {
  surface: CheckSurface;
  value: CheckBinding[];
  onChange: (next: CheckBinding[]) => void;
  connected?: string[];
  locked?: string[];
  emptyHint?: string;
}) {
  const available = useMemo(() => checksFor(surface), [surface]);
  const byId = useMemo(() => new Map(value.map((b) => [b.id, b])), [value]);

  const toggle = (id: string) => {
    if (locked.includes(id)) return;
    onChange(byId.has(id) ? value.filter((b) => b.id !== id) : [...value, defaultBinding(id)]);
  };
  const patch = (id: string, p: Partial<CheckBinding>) =>
    onChange(value.map((b) => (b.id === id ? { ...b, ...p } : b)));

  /** Credentials this check needs that the lender has not connected. */
  const missing = (spec: CheckSpec) =>
    spec.requires
      .filter((r) => r.kind === "vault" && !connected.includes(r.vaultKind))
      .map((r) => (r as { label: string }).label);

  return (
    <div className="space-y-5">
      {emptyHint && value.length === 0 && (
        <p className="rounded-xl bg-[color:var(--ink)]/[0.03] px-3 py-2.5 text-[12px] text-[color:var(--ink-muted)]">
          {emptyHint}
        </p>
      )}

      {CHECK_GROUPS.map((group) => {
        const rows = available.filter((c) => c.group === group);
        if (rows.length === 0) return null;
        return (
          <div key={group}>
            <div className="flex items-center gap-3 pb-2">
              <span className="t-label shrink-0">{group}</span>
              <span className="h-px flex-1 bg-[color:var(--ink)]/[0.08]" />
            </div>

            <div className="space-y-2">
              {rows.map((spec) => {
                const bound = byId.get(spec.id);
                const on = Boolean(bound);
                const isLocked = locked.includes(spec.id);
                const gaps = missing(spec);

                return (
                  <div
                    key={spec.id}
                    className="rounded-xl ring-1 transition-colors"
                    style={{
                      ["--tw-ring-color" as never]: on ? "var(--brand)" : "rgba(15,15,25,0.08)",
                      backgroundColor: on ? "var(--brand-soft)" : undefined,
                    }}
                  >
                    <div className="flex items-start justify-between gap-3 px-3 py-2.5">
                      <div className="min-w-0">
                        <p className="flex flex-wrap items-center gap-1.5 text-[13px] font-semibold text-[color:var(--ink)]">
                          {spec.label}
                          {isLocked && (
                            <span className="rounded-full bg-[color:var(--ink)]/[0.07] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[color:var(--ink-muted)]">
                              Required by the product
                            </span>
                          )}
                        </p>
                        <p className="t-meta text-[11px] leading-snug">{spec.blurb}</p>
                        <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10.5px] text-[color:var(--ink-faint)]">
                          <span className="inline-flex items-center gap-1">
                            <Coins className="h-3 w-3" /> {COST_LABEL[spec.cost]}
                          </span>
                          <span className="inline-flex items-center gap-1">
                            <Clock className="h-3 w-3" /> {LATENCY_LABEL[spec.latency]}
                          </span>
                          {!spec.canBlock && (
                            <span className="inline-flex items-center gap-1">
                              <ShieldAlert className="h-3 w-3" /> Advisory — it cannot stop the flow
                            </span>
                          )}
                        </p>
                      </div>
                      <Toggle label={spec.label} checked={on} onChange={() => toggle(spec.id)} disabled={isLocked} />
                    </div>

                    {on && gaps.length > 0 && (
                      <p className="mx-3 mb-2.5 flex items-start gap-1.5 rounded-lg bg-amber-500/10 px-2.5 py-2 text-[11px] text-amber-900 ring-1 ring-amber-600/20">
                        <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
                        <span>
                          This will not run until {gaps.join(" and ")} {gaps.length === 1 ? "is" : "are"} connected.{" "}
                          <Link href="/console/settings" className="font-semibold underline">Settings &amp; Vault</Link>
                        </span>
                      </p>
                    )}

                    {on && bound && (
                      <div className="grid gap-3 border-t border-[color:var(--ink)]/[0.07] px-3 py-3 sm:grid-cols-3">
                        <label className="flex items-start justify-between gap-2 sm:col-span-1">
                          <span className="min-w-0">
                            <span className="t-label block">Hard gate</span>
                            <span className="t-meta block text-[11px] leading-snug">
                              {spec.canBlock
                                ? "Fail = the flow stops here."
                                : "Not available — there is nothing for this to fail."}
                            </span>
                          </span>
                          <Toggle
                            label="Hard gate"
                            checked={bound.blocking}
                            disabled={!spec.canBlock}
                            onChange={(v) => patch(spec.id, { blocking: v })}
                          />
                        </label>

                        <NumberField
                          label="Re-run after"
                          value={bound.maxAgeDays}
                          min={0}
                          max={365}
                          suffix="days"
                          onChange={(v) => patch(spec.id, { maxAgeDays: v })}
                          help={bound.maxAgeDays === 0 ? "Always re-run, never trust a stored result." : "An older result is refreshed."}
                        />

                        <NumberField
                          label="Minimum score"
                          value={bound.threshold ?? 0}
                          min={0}
                          onChange={(v) => patch(spec.id, { threshold: v > 0 ? v : null })}
                          help={bound.threshold ? "Below this the check fails." : "No bar — the result is recorded, not judged."}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** A one-line summary of what is attached — for a review step or a stage card. */
export function ChecksSummary({ value }: { value: CheckBinding[] }) {
  if (value.length === 0) {
    return <p className="t-meta text-[12px]">No automated checks — everything here is judged by a person.</p>;
  }
  return (
    <ul className="space-y-1">
      {value.map((b) => {
        const spec = CHECK_BY_ID[b.id];
        if (!spec) return null;
        return (
          <li key={b.id} className="flex items-center gap-2 text-[12px] text-[color:var(--ink-body)]">
            <Check className="h-3.5 w-3.5 shrink-0" style={{ color: "var(--brand)" }} />
            <span className="font-semibold text-[color:var(--ink)]">{spec.label}</span>
            <span className="t-meta text-[11px]">
              {b.blocking ? "must pass" : "advisory"}
              {b.threshold ? ` · min ${b.threshold}` : ""}
              {b.maxAgeDays === 0 ? " · always re-run" : ` · re-run after ${b.maxAgeDays}d`}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
