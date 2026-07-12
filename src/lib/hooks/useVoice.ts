"use client";

// ─────────────────────────────────────────────────────────────────────────────
// VOICE — talking to Riri, and Riri talking back.
//
// LISTENING is the browser's own Web Speech API. It is free, it needs no key, it runs
// on-device, and it already speaks Kiswahili — which is the honest reason to prefer it
// over a paid cloud recogniser for a Kenyan lender whose officers switch language
// mid-sentence. (It is the same choice the Hub made; this is that hook, trimmed to what
// a console needs.)
//
// SPEAKING has two paths, and the fallback is the point:
//   • With a Google key, /api/console/riri/tts returns a real Neural voice — the one a
//     lender will recognise as "the product talks".
//   • Without one, the BROWSER's own speech synthesis reads the answer instead. Same
//     seam as kycMode/crbMode/storageMode: no credential, no silence — a degraded but
//     honest version, so a demo on a laptop with no keys still speaks.
//
// WHAT IS SPOKEN IS NOT WHAT IS SHOWN. Riri's answers are written in markdown for the
// eye: bold, numbered steps, links. Reading "asterisk asterisk PAR thirty asterisk
// asterisk" aloud is worse than not speaking at all, so `speakable()` strips the
// formatting and turns "1." into "Step one" — the text is authored once and rendered
// twice, for two different senses.
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useRef, useState } from "react";

export type VoiceLang = "en-KE" | "sw-KE";

// The Web Speech API is not in every TS DOM lib, and we need only this much of it.
type SpeechRecLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((e: { resultIndex: number; results: { length: number; [i: number]: { isFinal: boolean; 0: { transcript: string } } } }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};

function recognizer(): SpeechRecLike | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => SpeechRecLike; webkitSpeechRecognition?: new () => SpeechRecLike };
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  return Ctor ? new Ctor() : null;
}

/**
 * Markdown for the eye → a sentence for the ear.
 *
 * Also caps the length: an answer with six numbered steps is a fine thing to READ and an
 * ordeal to sit through. Voice gives the gist and the screen holds the detail.
 */
export function speakable(markdown: string, maxChars = 700): string {
  let t = markdown
    .replace(/\*\*(.+?)\*\*/g, "$1")       // bold
    .replace(/`(.+?)`/g, "$1")             // code
    .replace(/\[(.+?)\]\(.+?\)/g, "$1")    // links → their text
    .replace(/^#+\s*/gm, "")               // headings
    .replace(/^\s*[-•]\s+/gm, "")          // bullets
    .replace(/^\s*(\d+)\.\s+/gm, (_, n) => `Step ${n}. `) // numbered steps read as steps
    .replace(/[👋✓✗→]/gu, "")
    .replace(/\n{2,}/g, ". ")
    .replace(/\n/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();

  if (t.length > maxChars) {
    const cut = t.slice(0, maxChars);
    t = cut.slice(0, Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("? "))) || cut;
    t += " There's more on the screen.";
  }
  return t;
}

export function useVoice(opts: { onTranscript: (text: string) => void; lang?: VoiceLang }) {
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [supported, setSupported] = useState(false);
  const [lang, setLang] = useState<VoiceLang>(opts.lang ?? "en-KE");

  const rec = useRef<SpeechRecLike | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);

  // The callback is held in a ref so a re-render does not tear down a live recognition
  // session — but it is assigned in an effect, not during render, because a ref written
  // during render is a mutation React is entitled to discard.
  const onTranscript = useRef(opts.onTranscript);
  useEffect(() => { onTranscript.current = opts.onTranscript; }, [opts.onTranscript]);

  useEffect(() => {
    // Capability detection has to happen after mount: `window` does not exist on the
    // server, and rendering "voice supported" differently on the two would be a
    // hydration mismatch.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSupported(Boolean(recognizer()) || "speechSynthesis" in window);
  }, []);

  const stopListening = useCallback(() => {
    try { rec.current?.stop(); } catch { /* already stopped */ }
    rec.current = null;
    setListening(false);
  }, []);

  const listen = useCallback(() => {
    if (listening) { stopListening(); return; }

    const r = recognizer();
    if (!r) return;

    r.lang = lang;
    r.continuous = false;   // one utterance: a question, then an answer
    r.interimResults = false;

    let heard = "";
    r.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) heard += e.results[i][0].transcript;
      }
    };
    r.onerror = () => setListening(false);
    r.onend = () => {
      setListening(false);
      rec.current = null;
      const said = heard.trim();
      if (said) onTranscript.current(said);
    };

    rec.current = r;
    setListening(true);
    try { r.start(); } catch { setListening(false); }
  }, [listening, lang, stopListening]);

  const stopSpeaking = useCallback(() => {
    audio.current?.pause();
    audio.current = null;
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    setSpeaking(false);
  }, []);

  /** Say it out loud. Google's voice when we have a key, the browser's when we don't. */
  const speak = useCallback(async (markdown: string) => {
    stopSpeaking();
    const text = speakable(markdown);
    if (!text) return;
    setSpeaking(true);

    try {
      const res = await fetch("/api/console/riri/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, lang }),
      });
      const data = await res.json();

      if (data.success && data.audio) {
        const a = new Audio(`data:audio/mp3;base64,${data.audio}`);
        audio.current = a;
        a.onended = () => setSpeaking(false);
        a.onerror = () => setSpeaking(false);
        await a.play();
        return;
      }
    } catch {
      // fall through to the browser's own voice
    }

    // No key, or the call failed. The browser can still read it.
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = lang === "sw-KE" ? "sw" : "en-GB";
      u.rate = 1.02;
      u.onend = () => setSpeaking(false);
      u.onerror = () => setSpeaking(false);
      window.speechSynthesis.speak(u);
      return;
    }

    setSpeaking(false);
  }, [lang, stopSpeaking]);

  useEffect(() => () => { stopListening(); stopSpeaking(); }, [stopListening, stopSpeaking]);

  return { listening, speaking, supported, lang, setLang, listen, stopListening, speak, stopSpeaking };
}
