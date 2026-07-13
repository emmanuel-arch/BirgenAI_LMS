"use client";

// The borrower's language, resolved once and shared by every component on the
// page. Precedence: an explicit `?lang=` in the link (an SMS deep-link can open
// the portal already in Kiswahili) → the saved choice → the phone's own
// language. The choice persists in localStorage, so the language survives a
// reload and the next visit — a borrower should choose once, not per screen.
//
// Components start on English for the server render and adopt the real language
// after mount — the same mounted-gating the portal already does for branding,
// and for the same reason: the server cannot know either.
import { useCallback, useState } from "react";
import { useEffect } from "react";
import { useLoad } from "@/lib/hooks/useLoad";
import { DICT, isLang, type Lang, type PortalDict } from "./portal";

const KEY = "lms_lang";
const EVT = "lms:lang";

function resolveInitial(): Lang {
  try {
    const q = new URLSearchParams(window.location.search).get("lang");
    if (isLang(q)) {
      localStorage.setItem(KEY, q); // a deep link is a choice — keep it
      return q;
    }
    const stored = localStorage.getItem(KEY);
    if (isLang(stored)) return stored;
    if ((navigator.language || "").toLowerCase().startsWith("sw")) return "sw";
  } catch {
    /* private mode / no storage — English is the safe default */
  }
  return "en";
}

export function useLang(): { lang: Lang; setLang: (l: Lang) => void; t: PortalDict } {
  const [lang, setLangState] = useState<Lang>("en");

  useLoad(() => {
    setLangState(resolveInitial());
  });

  // One event keeps every mounted component in step — the toggle lives in a
  // header while the strings live in cards, and both must flip together.
  useEffect(() => {
    const on = (e: Event) => {
      const l = (e as CustomEvent<Lang>).detail;
      if (isLang(l)) setLangState(l);
    };
    window.addEventListener(EVT, on);
    return () => window.removeEventListener(EVT, on);
  }, []);

  const setLang = useCallback((l: Lang) => {
    try { localStorage.setItem(KEY, l); } catch { /* still works for this page */ }
    window.dispatchEvent(new CustomEvent<Lang>(EVT, { detail: l }));
  }, []);

  return { lang, setLang, t: DICT[lang] };
}
