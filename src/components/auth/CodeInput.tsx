"use client";

// Segmented one-time-code input — six framed boxes with auto-advance, backspace
// stepping, arrow-key motion and full-code paste. The focus glow reads the brand
// accent via --brand, so a lender's door feels like their product. Used by the
// staff sign-in card and reusable anywhere a daily/approval code is entered.
import { useRef, type ClipboardEvent, type KeyboardEvent } from "react";

export default function CodeInput({
  value,
  onChange,
  onComplete,
  length = 6,
  disabled = false,
  autoFocus = true,
}: {
  value: string;
  onChange: (next: string) => void;
  onComplete?: (code: string) => void;
  length?: number;
  disabled?: boolean;
  autoFocus?: boolean;
}) {
  const refs = useRef<Array<HTMLInputElement | null>>([]);
  const digits = value.replace(/\D/g, "").slice(0, length).split("");

  const focus = (i: number) => refs.current[Math.max(0, Math.min(length - 1, i))]?.focus();

  const setAt = (i: number, d: string) => {
    const arr = value.replace(/\D/g, "").slice(0, length).split("");
    arr[i] = d;
    const next = arr.join("").slice(0, length);
    onChange(next);
    return next;
  };

  const onKey = (i: number, e: KeyboardEvent<HTMLInputElement>) => {
    const key = e.key;
    if (key === "Backspace") {
      e.preventDefault();
      if (digits[i]) {
        const next = setAt(i, "");
        void next;
      } else if (i > 0) {
        setAt(i - 1, "");
        focus(i - 1);
      }
      return;
    }
    if (key === "ArrowLeft") { e.preventDefault(); focus(i - 1); return; }
    if (key === "ArrowRight") { e.preventDefault(); focus(i + 1); return; }
    if (/^\d$/.test(key)) {
      e.preventDefault();
      const next = setAt(i, key);
      if (i < length - 1) focus(i + 1);
      if (next.length === length && !next.includes("")) onComplete?.(next);
    }
  };

  const onPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, length);
    if (!pasted) return;
    onChange(pasted);
    focus(Math.min(pasted.length, length - 1));
    if (pasted.length === length) onComplete?.(pasted);
  };

  return (
    <div className="flex items-center justify-between gap-2 sm:gap-2.5" onPaste={onPaste}>
      {Array.from({ length }).map((_, i) => (
        <input
          key={i}
          ref={(el) => { refs.current[i] = el; }}
          value={digits[i] ?? ""}
          onChange={() => { /* controlled via onKeyDown for full control */ }}
          onKeyDown={(e) => onKey(i, e)}
          inputMode="numeric"
          autoComplete={i === 0 ? "one-time-code" : "off"}
          maxLength={1}
          disabled={disabled}
          autoFocus={autoFocus && i === 0}
          aria-label={`Digit ${i + 1}`}
          className="h-14 w-full min-w-0 rounded-2xl border border-zinc-900/12 bg-white/85 text-center text-2xl font-bold text-zinc-900 outline-none transition-all duration-150 focus:border-[var(--brand)] focus:bg-white focus:shadow-[0_0_0_4px_var(--brand-soft),0_8px_24px_-8px_var(--brand-soft)] disabled:opacity-50"
        />
      ))}
    </div>
  );
}
