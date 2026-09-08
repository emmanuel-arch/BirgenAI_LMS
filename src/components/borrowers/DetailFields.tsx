"use client";

// ─────────────────────────────────────────────────────────────────────────────
// THE LENDER'S OWN QUESTIONS, RENDERED.
//
// One component that turns a `DetailGroup[]` into a form. Used on the onboarding
// screen, on Customer-360, on a loan application, and — because it takes plain
// props and holds no state — by the customer app through the same contract.
//
// There are fourteen input kinds and it would be easy to write fourteen branches.
// The reason not to is that a lender changing a field from "Text" to "Dropdown"
// must not change how its VALUE is stored, how it is validated, or how it looks
// beside its neighbours. So the shape is one row, one label, one control, and the
// switch is only ever about which control — never about layout, never about state.
// ─────────────────────────────────────────────────────────────────────────────
import { OPTION_TYPES, type DetailGroup, type DetailItem, type DetailValues } from "@/lib/config/details";

const FIELD =
  "w-full rounded-lg border border-ash-900/15 bg-paper/80 px-3 py-2.5 text-sm outline-none placeholder:text-ash-400 focus:border-transparent focus:ring-2 focus:ring-[color:var(--brand)]";

export function DetailFields({
  groups, values, onChange, issues = {},
}: {
  groups: DetailGroup[];
  values: DetailValues;
  onChange: (next: DetailValues) => void;
  /** Keyed by item code — the same paths lib/config/details.ts validation returns. */
  issues?: Record<string, string>;
}) {
  if (groups.length === 0) return null;
  const set = (code: string, v: DetailValues[string]) => onChange({ ...values, [code]: v });

  return (
    <div className="space-y-4">
      {groups.map((g) => (
        <div key={g.code}>
          <div className="flex items-center gap-3 pb-2">
            <span className="t-label shrink-0">{g.title}</span>
            <span className="h-px flex-1 bg-[color:var(--ink)]/[0.08]" />
          </div>
          {g.description && <p className="t-meta mb-2 text-[11px]">{g.description}</p>}

          <div className="grid gap-3 sm:grid-cols-2">
            {g.items.map((item) => (
              <div key={item.code} className={item.type === "textarea" || OPTION_TYPES.includes(item.type) ? "sm:col-span-2" : ""}>
                <Field item={item} value={values[item.code]} onChange={(v) => set(item.code, v)} issue={issues[item.code]} />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function Field({
  item, value, onChange, issue,
}: {
  item: DetailItem;
  value: DetailValues[string] | undefined;
  onChange: (v: DetailValues[string]) => void;
  issue?: string;
}) {
  const label = (
    <span className="t-label">
      {item.title}
      {item.required && <span className="ml-1 text-red-500">*</span>}
    </span>
  );
  const help = item.description ? (
    <span className="mt-1 block text-[11px] text-[color:var(--ink-faint)]">{item.description}</span>
  ) : null;
  const err = issue ? <span className="mt-1 block text-[11px] font-medium text-red-600">{issue}</span> : null;

  // ── Choice ──
  if (item.type === "checkbox") {
    const picked = Array.isArray(value) ? value : [];
    return (
      <div>
        {label}
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {item.options.map((o) => {
            const on = picked.includes(o);
            return (
              <button
                key={o} type="button" aria-pressed={on}
                onClick={() => onChange(on ? picked.filter((x) => x !== o) : [...picked, o])}
                className="rounded-full px-3 py-1.5 text-[12px] font-semibold ring-1 transition-colors"
                style={on
                  ? { backgroundColor: "var(--brand-soft)", color: "var(--ink)", ["--tw-ring-color" as never]: "var(--brand)" }
                  : { color: "var(--ink-muted)", ["--tw-ring-color" as never]: "rgba(15,15,25,0.10)" }}
              >
                {o}
              </button>
            );
          })}
        </div>
        {help}{err}
      </div>
    );
  }

  if (item.type === "radio") {
    return (
      <div>
        {label}
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {item.options.map((o) => {
            const on = value === o;
            return (
              <button
                key={o} type="button" aria-pressed={on} onClick={() => onChange(o)}
                className="rounded-full px-3 py-1.5 text-[12px] font-semibold ring-1 transition-colors"
                style={on
                  ? { backgroundColor: "var(--brand-soft)", color: "var(--ink)", ["--tw-ring-color" as never]: "var(--brand)" }
                  : { color: "var(--ink-muted)", ["--tw-ring-color" as never]: "rgba(15,15,25,0.10)" }}
              >
                {o}
              </button>
            );
          })}
        </div>
        {help}{err}
      </div>
    );
  }

  if (item.type === "dropdown") {
    return (
      <label className="block">
        {label}
        <select className={FIELD} value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value)}>
          <option value="">Select…</option>
          {item.options.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
        {help}{err}
      </label>
    );
  }

  if (item.type === "boolean") {
    return (
      <label className="flex items-start justify-between gap-3 rounded-xl px-3 py-2.5 ring-1 ring-[color:var(--ink)]/[0.07]">
        <span className="min-w-0">
          {label}
          {help}
        </span>
        <input
          type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0" style={{ accentColor: "var(--brand)" }}
        />
      </label>
    );
  }

  if (item.type === "textarea") {
    return (
      <label className="block">
        {label}
        <textarea
          className={FIELD} rows={3} placeholder={item.placeholder}
          value={typeof value === "string" ? value : ""}
          maxLength={item.max ?? undefined}
          onChange={(e) => onChange(e.target.value)}
        />
        {help}{err}
      </label>
    );
  }

  // ── Everything else is one <input>, differing only in `type` and inputMode ──
  const inputType =
    item.type === "date" ? "date"
      : item.type === "time" ? "time"
        : item.type === "month" ? "month"
          : item.type === "email" ? "email"
            : item.type === "tel" ? "tel"
              : item.type === "numeric" || item.type === "currency" || item.type === "year" ? "number"
                : "text";

  return (
    <label className="block">
      {label}
      <input
        className={FIELD}
        type={inputType}
        inputMode={item.type === "numeric" || item.type === "currency" || item.type === "year" ? "decimal" : undefined}
        placeholder={item.type === "currency" ? item.placeholder || "KES" : item.placeholder}
        value={value === null || value === undefined ? "" : String(value)}
        min={item.type === "year" ? 1900 : item.min ?? undefined}
        max={item.type === "year" ? new Date().getFullYear() : item.max ?? undefined}
        maxLength={item.type === "text" ? item.max ?? undefined : undefined}
        onChange={(e) => {
          const raw = e.target.value;
          if (raw === "") { onChange(null); return; }
          onChange(inputType === "number" ? Number(raw) : raw);
        }}
      />
      {help}{err}
    </label>
  );
}
