"use client";

// ─────────────────────────────────────────────────────────────────────────────
// ONBOARDING — the rails this lender actually has, and the one they open on.
//
// This is the section that makes the counter and the customer app the same screen
// for the same lender, and a different screen for the next one. A lender who runs
// IPRS-only gets a page that asks for one ID number and nothing else; a lender on
// the free OCR path gets a camera; a lender with neither gets a form. None of that
// is three screens — it is one screen reading this document.
//
// WHY IT IS NOT A SIMPLE DROPDOWN. Four things are being decided here at once and
// conflating them is what makes competitors' onboarding rigid:
//
//   WHICH RAILS EXIST      what this lender has credentials for
//   WHICH ONE OPENS FIRST  the default at the counter
//   WHAT HAPPENS ON FAIL   fall through, or stop
//   WHAT ELSE RUNS         blacklist, AML, an early bureau pull
//
// The fourth is the one nobody else offers. A CRB check is normally a thing that
// happens at the finance stage because that is where somebody once put the button.
// Here it is a check binding on this document, identical in shape to the ones on a
// workflow stage, so a lender who wants the bureau at the DOOR simply says so.
// ─────────────────────────────────────────────────────────────────────────────
import Link from "next/link";
import { AlertTriangle, ArrowUpRight, Sparkles } from "lucide-react";
import {
  Toggle, SwitchRow, Choice, NumberField, SelectField, Divider, SliderField,
} from "@/components/settings/controls";
import { ChecksPicker } from "@/components/settings/ChecksPicker";
import {
  ONBOARDING_METHODS, type BorrowerConfig, type OnboardingMethod,
} from "@/lib/config/borrower";

type SetFn = <K extends keyof BorrowerConfig>(key: K, value: BorrowerConfig[K]) => void;

export function OnboardingSection({
  cfg, set, connected,
}: {
  cfg: BorrowerConfig;
  set: SetFn;
  /** Vault kinds already configured — a rail with no credentials is offered greyed. */
  connected: string[];
}) {
  const o = cfg.onboarding;
  const patch = (p: Partial<BorrowerConfig["onboarding"]>) => set("onboarding", { ...o, ...p });

  const setMethod = (key: OnboardingMethod, on: boolean) => {
    const methods = { ...o.methods, [key]: on };
    // Switching off the rail the counter opens on has to move the default, or the
    // screen would open on a method that is not there.
    const primary = methods[o.primary]
      ? o.primary
      : (ONBOARDING_METHODS.map((m) => m.key).find((k) => methods[k]) ?? "manual");
    patch({ methods, primary });
  };

  const enabled = ONBOARDING_METHODS.filter((m) => o.methods[m.key]);

  return (
    <div className="space-y-5">
      <div>
        <p className="t-label mb-2">The rails you have</p>
        <p className="t-meta mb-3 text-[12px]">
          Switch on only what you hold credentials for. A rail that is off is not
          offered, not attempted, and not mentioned — the counter looks built for you
          rather than switched down from something bigger.
        </p>

        <div className="space-y-2">
          {ONBOARDING_METHODS.map((m) => {
            const on = o.methods[m.key];
            const needs = m.needsVault;
            const ready = !needs || connected.includes(needs);
            const isPrimary = o.primary === m.key;

            return (
              <div
                key={m.key}
                className="rounded-xl ring-1 transition-colors"
                style={{
                  ["--tw-ring-color" as never]: on ? "var(--brand)" : "rgba(15,15,25,0.08)",
                  backgroundColor: on ? "var(--brand-soft)" : undefined,
                }}
              >
                <div className="flex items-start justify-between gap-3 px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-1.5 text-[13px] font-semibold text-[color:var(--ink)]">
                      {m.label}
                      {m.key === "ocr" && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/12 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-700">
                          <Sparkles className="h-2.5 w-2.5" /> Free
                        </span>
                      )}
                      {m.key === "manual" && (
                        <span className="rounded-full bg-[color:var(--ink)]/[0.07] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[color:var(--ink-muted)]">
                          Always available
                        </span>
                      )}
                      {isPrimary && on && (
                        <span className="rounded-full px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white" style={{ backgroundColor: "var(--brand)" }}>
                          Opens first
                        </span>
                      )}
                    </p>
                    <p className="t-meta text-[11px] leading-snug">{m.blurb}</p>
                    {on && !ready && (
                      <p className="mt-1.5 flex items-start gap-1.5 rounded-lg bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-900 ring-1 ring-amber-600/20">
                        <AlertTriangle className="mt-px h-3 w-3 shrink-0" />
                        <span>
                          No {needs} credentials yet, so this will fail at the counter.{" "}
                          <Link href="/console/settings" className="inline-flex items-center gap-0.5 font-semibold underline">
                            Connect it <ArrowUpRight className="h-2.5 w-2.5" />
                          </Link>
                        </span>
                      </p>
                    )}
                  </div>
                  <Toggle
                    label={m.label}
                    checked={on}
                    // Manual is the floor. Every other rail depends on a third party that
                    // will one day be down, and a counter with no way to serve the person
                    // standing in front of it is not a state to be able to publish.
                    disabled={m.key === "manual" && enabled.length <= 1}
                    onChange={(v) => setMethod(m.key, v)}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {enabled.length > 1 && (
        <>
          <Divider label="At the counter" />
          <SelectField
            label="Open on"
            value={o.primary}
            onChange={(v) => patch({ primary: v as OnboardingMethod })}
            options={enabled.map((m) => ({ value: m.key, label: m.label }))}
            help="The method a new borrower screen starts with, in the console and in the customer app."
          />
          <SwitchRow
            title="Fall through when it fails"
            desc="A registry outage or a no-match drops to the next rail you have, rather than stopping the counter."
            checked={o.allowFallback}
            onChange={(v) => patch({ allowFallback: v })}
          />
        </>
      )}

      <SwitchRow
        title="Manual entry always reachable"
        desc="A one-click escape to typing it in, even when it is not in the fallback chain. Somebody will eventually walk in with a damaged card."
        checked={o.allowManualOverride}
        onChange={(v) => patch({ allowManualOverride: v })}
      />

      <SwitchRow
        title="Ask for consent first"
        desc="The customer consents before any lookup is made against their name. Not optional where a third party is queried."
        checked={o.requireConsent}
        onChange={(v) => patch({ requireConsent: v })}
      />

      {/* ── Per-rail settings, shown only for the rails that are on ── */}
      {o.methods.ocr && (
        <>
          <Divider label="Document scan" />
          <Choice
            label="What the customer photographs"
            value={o.ocr.capture}
            onChange={(v) => patch({ ocr: { ...o.ocr, capture: v as "front" | "both" } })}
            cols={2}
            options={[
              { value: "front", label: "Front only", hint: "The face of the card. Everything the reader needs is on it." },
              { value: "both", label: "Both sides", hint: "Front and back — slower, and what some compliance regimes ask for." },
            ]}
          />
          <SliderField
            label="Accept a read above"
            value={Math.round(o.ocr.minConfidence * 100)}
            min={30} max={100} step={5}
            format={(v) => `${v}%`}
            onChange={(v) => patch({ ocr: { ...o.ocr, minConfidence: v / 100 } })}
            help="Below this the fields are shown for a human to correct rather than accepted. Higher means fewer mistakes and more corrections."
          />
          <SwitchRow
            title="Fields stay editable"
            desc="An officer may correct what the reader extracted before saving. Off locks the read, which is stricter and slower."
            checked={o.ocr.allowEdit}
            onChange={(v) => patch({ ocr: { ...o.ocr, allowEdit: v } })}
          />
        </>
      )}

      {o.methods.crb && (
        <>
          <Divider label="Bureau at the door" />
          <Choice
            label="How deep to pull"
            value={o.crb.depth}
            onChange={(v) => patch({ crb: { ...o.crb, depth: v as "score" | "standard" | "full" } })}
            cols={3}
            options={[
              { value: "score", label: "Score only", hint: "The cheapest pull. Enough to sort a walk-in." },
              { value: "standard", label: "Standard report", hint: "Score plus the credit file." },
              { value: "full", label: "Full report", hint: "Everything, including income indicators. The most expensive." },
            ]}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <NumberField
              label="Refuse below" min={0} max={1000}
              value={o.crb.minScore}
              onChange={(v) => patch({ crb: { ...o.crb, minScore: v } })}
              help="0 = never refuse on the bureau score alone."
            />
            <label className="flex items-start justify-between gap-2 rounded-xl px-3 py-2.5 ring-1 ring-[color:var(--ink)]/[0.07]">
              <span className="min-w-0">
                <span className="text-[13px] font-semibold text-[color:var(--ink)]">Warn, do not refuse</span>
                <span className="t-meta block text-[11px] leading-snug">
                  Register them anyway and flag the file. A thin bureau record is not the same as a bad one.
                </span>
              </span>
              <Toggle label="Warn only" checked={o.crb.warnOnly} onChange={(v) => patch({ crb: { ...o.crb, warnOnly: v } })} />
            </label>
          </div>
          <p className="t-meta text-[11px]">
            A bureau pull at onboarding is billed on every walk-in, not every applicant.
            For most lenders the cheaper answer is to bind a CRB check to the risk stage
            of a workflow instead — which is the same control, one screen along.
          </p>
        </>
      )}

      <Divider label="The face" />
      <SwitchRow
        title="Take a selfie"
        desc="A photograph of the person, held on their file."
        checked={o.selfie.required}
        onChange={(v) => patch({ selfie: { ...o.selfie, required: v, faceMatch: v ? o.selfie.faceMatch : false, liveness: v ? o.selfie.liveness : false } })}
      />
      {o.selfie.required && (
        <div className="grid gap-3 sm:grid-cols-2">
          <SwitchRow
            title="Match it to the ID"
            desc="The selfie is compared against the photo on the document."
            checked={o.selfie.faceMatch}
            onChange={(v) => patch({ selfie: { ...o.selfie, faceMatch: v } })}
          />
          <SwitchRow
            title="Prove it is live"
            desc="Defeats a photograph of a photograph. Slower, and worth it where fraud rings operate."
            checked={o.selfie.liveness}
            onChange={(v) => patch({ selfie: { ...o.selfie, liveness: v } })}
          />
        </div>
      )}

      <Divider label="Where they are" />
      <SwitchRow
        title="Ask for a location"
        desc="A consented one-time pin taken while the customer is standing there. This is what field dispatch routes on."
        checked={o.geo.ask}
        onChange={(v) => patch({ geo: { ...o.geo, ask: v, required: v ? o.geo.required : false } })}
      />
      {o.geo.ask && (
        <>
          <div>
            <p className="t-label mb-2">Places to pin</p>
            <div className="flex flex-wrap gap-1.5">
              {(["business", "home"] as const).map((p) => {
                const on = o.geo.places.includes(p);
                return (
                  <button
                    key={p} type="button" aria-pressed={on}
                    onClick={() => patch({ geo: { ...o.geo, places: on ? o.geo.places.filter((x) => x !== p) : [...o.geo.places, p] } })}
                    className="rounded-full px-3 py-1.5 text-[12px] font-semibold capitalize ring-1 transition-colors"
                    style={on
                      ? { backgroundColor: "var(--brand-soft)", color: "var(--ink)", ["--tw-ring-color" as never]: "var(--brand)" }
                      : { color: "var(--ink-muted)", ["--tw-ring-color" as never]: "rgba(15,15,25,0.10)" }}
                  >
                    {p}
                  </button>
                );
              })}
            </div>
          </div>
          <SwitchRow
            title="A location is required"
            desc="The record cannot be created without one. Strong for field lending, and an obstacle at a busy counter."
            checked={o.geo.required}
            onChange={(v) => patch({ geo: { ...o.geo, required: v } })}
          />
        </>
      )}

      <Divider label="Who may onboard" />
      <div className="grid gap-3 sm:grid-cols-2">
        <SwitchRow title="Console" desc="Your staff, at the counter."
          checked={o.channels.console} onChange={(v) => patch({ channels: { ...o.channels, console: v } })} />
        <SwitchRow title="Customer app" desc="The borrower registers themselves."
          checked={o.channels.portal} onChange={(v) => patch({ channels: { ...o.channels, portal: v } })} />
        <SwitchRow title="Field officer" desc="Registered on the ground, on a phone."
          checked={o.channels.field} onChange={(v) => patch({ channels: { ...o.channels, field: v } })} />
        <SwitchRow title="USSD" desc="Feature phones, no data. Keep the required fields short."
          checked={o.channels.ussd} onChange={(v) => patch({ channels: { ...o.channels, ussd: v } })} />
      </div>

      <Divider label="Somebody who is already a customer" />
      <Choice
        label="When the ID or phone is already on your book"
        value={o.onDuplicate}
        onChange={(v) => patch({ onDuplicate: v as BorrowerConfig["onboarding"]["onDuplicate"] })}
        cols={3}
        options={[
          { value: "open_existing", label: "Open their file", hint: "Take the officer straight to the customer who already exists." },
          { value: "warn", label: "Warn and continue", hint: "Say so, but let a second record be created deliberately." },
          { value: "block", label: "Refuse", hint: "No second record, ever. The strictest, and the safest for a book." },
        ]}
      />

      <SwitchRow
        title="A person signs off the KYC pack"
        desc="A new customer cannot transact until somebody has reviewed what was captured. Switch it off only if your checks are strong enough to stand alone."
        checked={o.requireReview}
        onChange={(v) => patch({ requireReview: v })}
      />

      <Divider label="What else runs at the door" />
      <ChecksPicker
        surface="onboarding"
        value={o.checks}
        onChange={(v) => patch({ checks: v })}
        connected={connected}
        emptyHint="Nothing runs automatically. Everything captured at onboarding is taken on trust until a person or a workflow looks at it."
      />
    </div>
  );
}
