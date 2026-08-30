"use client";

// ─────────────────────────────────────────────────────────────────────────────
// "New product" starts here — five working shapes, or a blank page.
//
// The reference system drops a new lender straight into a six-step wizard with
// sixty untyped fields and no indication of which combinations are normal. That is
// the single biggest reason their onboarding needs a consultant in the room.
//
// A template is only a ProductDefinition, so picking one is a copy — the wizard,
// the validator and the publisher treat it exactly like a hand-built product. The
// card also states what the template deliberately leaves for the lender (approval
// workflows are per-org rows; nothing shipped can name one), so the blank is a
// stated step rather than a validation error discovered at the end.
// ─────────────────────────────────────────────────────────────────────────────
import { motion, useReducedMotion } from "framer-motion";
import { Store, Wallet, Truck, Car, Users, FilePlus2, ArrowRight } from "lucide-react";
import type { ProductTemplate } from "@/lib/products/templates";
import type { ProductDefinition } from "@/lib/products/definition";
import { Modal } from "@/components/ui/Modal";

const ICONS = { store: Store, wallet: Wallet, truck: Truck, car: Car, users: Users } as const;

const fmt = (n: number) => `KES ${n.toLocaleString()}`;

export default function TemplateGallery({
  templates, blanksOf, onPick, onClose,
}: {
  templates: ProductTemplate[];
  blanksOf: (d: ProductDefinition) => string[];
  /** null = start from scratch. */
  onPick: (definition: ProductDefinition | null) => void;
  onClose: () => void;
}) {
  const reduce = useReducedMotion();

  return (
    <Modal
      onClose={onClose}
      title="New product"
      width="xl"
      sub="Start from a shape a Kenyan lender would recognise, then change anything. Every template is a real product definition — nothing is locked, and the same rules apply to it as to one you build yourself."
    >
      <div className="px-1 pb-1">
        <div className="grid gap-3 sm:grid-cols-2">
          {templates.map((t, i) => {
            const Icon = ICONS[t.icon];
            const blanks = blanksOf(t.definition);
            const lim = t.definition.limit;
            const range = lim.basis === "bands" && lim.bands.length
              ? `${fmt(Math.min(...lim.bands))} – ${fmt(Math.max(...lim.bands))}`
              : `${fmt(lim.min)} – ${fmt(lim.max)}`;

            return (
              <motion.button
                key={t.id}
                type="button"
                onClick={() => onPick(t.definition)}
                initial={reduce ? false : { opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.04 * i, duration: 0.3 }}
                className="group rounded-2xl border border-ash-900/10 bg-paper/70 p-4 text-left transition-all hover:-translate-y-0.5 hover:border-ash-900/20 hover:bg-paper"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="flex h-9 w-9 items-center justify-center rounded-xl" style={{ backgroundColor: "var(--brand-soft)" }}>
                    <Icon className="h-[17px] w-[17px]" style={{ color: "var(--brand)" }} />
                  </span>
                  <ArrowRight className="h-4 w-4 text-ash-300 transition-all group-hover:translate-x-0.5 group-hover:text-ash-500" />
                </div>

                <p className="mt-2.5 text-sm font-bold text-ash-900">{t.name}</p>
                <p className="mt-0.5 text-[12px] leading-snug text-ash-600">{t.tagline}</p>

                <div className="mt-2.5 flex flex-wrap gap-1">
                  {t.highlights.map((h) => (
                    <span key={h} className="rounded-md bg-ash-900/[0.04] px-1.5 py-0.5 text-[10px] font-medium text-ash-500">
                      {h}
                    </span>
                  ))}
                </div>

                <dl className="mt-3 space-y-0.5 border-t border-ash-900/[0.07] pt-2.5 text-[11px] text-ash-500">
                  <div className="flex justify-between gap-2">
                    <dt>Amount</dt>
                    <dd className="font-semibold tabular-nums text-ash-700">{range}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt>Term</dt>
                    <dd className="font-semibold text-ash-700">
                      {t.definition.schedule.installments} × {t.definition.schedule.cycle}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt>Interest</dt>
                    <dd className="font-semibold text-ash-700">
                      {t.definition.pricing.rate}% {t.definition.pricing.method} / {t.definition.pricing.ratePeriod}
                    </dd>
                  </div>
                </dl>

                {blanks.length > 0 && (
                  <p className="mt-2 text-[10px] text-amber-700">
                    You choose: {blanks.map((b) => (b.includes("repeat") ? "repeat-loan workflow" : "new-loan workflow")).join(" · ")}
                  </p>
                )}
              </motion.button>
            );
          })}

          <button
            type="button"
            onClick={() => onPick(null)}
            className="group flex flex-col items-center justify-center rounded-2xl border border-dashed border-ash-900/15 p-4 text-center transition-colors hover:border-ash-900/30 hover:bg-paper/60"
          >
            <FilePlus2 className="h-6 w-6 text-ash-300 transition-colors group-hover:text-ash-500" />
            <p className="mt-2 text-sm font-semibold text-ash-700">Start from scratch</p>
            <p className="mt-0.5 text-[12px] text-ash-500">An empty product, all six steps.</p>
          </button>
        </div>
      </div>
    </Modal>
  );
}
