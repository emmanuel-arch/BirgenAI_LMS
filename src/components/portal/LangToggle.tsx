"use client";

// EN | SW — the language switch on every borrower surface. Two letters, not a
// dropdown: there are exactly two languages and the switch must be operable by
// someone who cannot read the language the page is currently in.
import { useLang } from "@/lib/i18n/useLang";
import { LANGS } from "@/lib/i18n/portal";

export function LangToggle({ className = "" }: { className?: string }) {
  const { lang, setLang } = useLang();
  return (
    <div className={`inline-flex items-center rounded-full border border-zinc-900/15 bg-white/80 p-0.5 ${className}`}>
      {LANGS.map((l) => {
        const active = l.code === lang;
        return (
          <button
            key={l.code}
            onClick={() => setLang(l.code)}
            aria-pressed={active}
            aria-label={l.code === "en" ? "English" : "Kiswahili"}
            className={`rounded-full px-2.5 py-1 text-[11px] font-bold transition-colors ${
              active ? "text-white" : "text-zinc-500 hover:text-zinc-800"
            }`}
            style={active ? { backgroundColor: "var(--brand, #18181b)" } : undefined}
          >
            {l.label}
          </button>
        );
      })}
    </div>
  );
}
