"use client";

// ─────────────────────────────────────────────────────────────────────────────
// SETTINGS.
//
// Two halves, and the split is on purpose.
//
// THE DEVICE half is what this OS itself does: which side of the screen it lives
// on, whether it speaks, whether it may move the console for you, and whether it
// keeps your conversations. Every one of those defaults OFF or minimal, because an
// assistant that starts talking, or navigates on its own, before anyone asked it
// to is a hostile assistant.
//
// THE ACCOUNT half is RiriAccount, unchanged — who it is briefed that you are,
// what you have used this month, and every note it holds about you, readable and
// deletable. It is reused rather than reimplemented: that panel already answers
// the first question any buyer's data-protection officer asks, and a second
// implementation of "here is what we remember about you" is a second thing that
// can be wrong about it.
//
// AUTOPILOT gets the longest label on this screen because it deserves the most
// informed consent. It is navigation-only, it is opt-in, and the sentence says
// exactly where its authority stops.
// ─────────────────────────────────────────────────────────────────────────────
import { useState } from "react";
import {
  Navigation, Volume2, VolumeX, Languages, PanelLeft, PanelRight,
  History, Trash2, Loader2, Check, Info,
} from "lucide-react";
import { Screen, SectionLabel } from "../kit";
import { RiriAccount } from "@/components/riri/RiriAccount";
import { ASSISTANT_NAME } from "@/lib/riri/brand";

function Toggle({
  icon, title, detail, on, onChange, tone,
}: {
  icon: React.ReactNode;
  title: string;
  detail: string;
  on: boolean;
  onChange: () => void;
  tone?: "brand";
}) {
  return (
    <button
      onClick={onChange}
      role="switch"
      aria-checked={on}
      className="flex w-full items-start gap-2.5 rounded-2xl border border-zinc-900/[0.07] bg-white/75 px-3 py-2.5 text-left transition-colors hover:border-[color:var(--brand)]"
    >
      <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${on && tone === "brand" ? "text-white" : "bg-zinc-900/[0.05] text-zinc-500"}`}
        style={on && tone === "brand" ? { backgroundColor: "var(--brand)" } : undefined}>
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[12.5px] font-semibold leading-tight text-zinc-800">{title}</span>
        <span className="mt-0.5 block text-[10.5px] leading-snug text-zinc-500">{detail}</span>
      </span>
      <span className={`mt-1 flex h-[18px] w-[30px] shrink-0 items-center rounded-full px-[2px] transition-colors ${on ? "" : "bg-zinc-300"}`}
        style={on ? { backgroundColor: "var(--brand)" } : undefined}>
        <span className={`h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${on ? "translate-x-[12px]" : ""}`} />
      </span>
    </button>
  );
}

export function SettingsScreen({
  voiceOn, onVoice, autoGo, onAutoGo, lang, onLang, speaking,
  corner, onCorner, historyAvailable, threadCount, onClearHistory,
}: {
  voiceOn: boolean; onVoice: () => void;
  autoGo: boolean; onAutoGo: () => void;
  lang: string; onLang: () => void;
  speaking: boolean;
  corner: "br" | "bl"; onCorner: () => void;
  historyAvailable: boolean;
  threadCount: number;
  onClearHistory: () => Promise<void>;
}) {
  const [clearing, setClearing] = useState(false);
  const [cleared, setCleared] = useState(false);
  const [confirm, setConfirm] = useState(false);

  const clear = async () => {
    if (!confirm) {
      setConfirm(true);
      window.setTimeout(() => setConfirm(false), 4000);
      return;
    }
    setClearing(true);
    try { await onClearHistory(); setCleared(true); window.setTimeout(() => setCleared(false), 2200); }
    finally { setClearing(false); setConfirm(false); }
  };

  return (
    <Screen>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pb-4 pt-1">
        <div className="space-y-1.5">
          <SectionLabel>This device</SectionLabel>

          <Toggle
            icon={<Navigation className="h-4 w-4" />}
            title="Autopilot"
            detail="When an answer ends somewhere, I open that screen instead of offering a button. I only ever NAVIGATE — I never approve, disburse or change a permission when I get there."
            on={autoGo}
            onChange={onAutoGo}
            tone="brand"
          />

          <Toggle
            icon={voiceOn ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
            title="Read answers out loud"
            detail={speaking ? "Speaking now — tap to stop and switch off." : "Useful on a counter or in the field. Off by default."}
            on={voiceOn}
            onChange={onVoice}
            tone="brand"
          />

          <button
            onClick={onLang}
            className="flex w-full items-center gap-2.5 rounded-2xl border border-zinc-900/[0.07] bg-white/75 px-3 py-2.5 text-left transition-colors hover:border-[color:var(--brand)]"
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-zinc-900/[0.05] text-zinc-500">
              <Languages className="h-4 w-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[12.5px] font-semibold leading-tight text-zinc-800">Language</span>
              <span className="mt-0.5 block text-[10.5px] leading-snug text-zinc-500">
                Ask in either — typed questions follow the words you use.
              </span>
            </span>
            <span className="shrink-0 rounded-full bg-zinc-900/5 px-2 py-0.5 text-[10px] font-bold text-zinc-600">
              {lang === "sw-KE" ? "Kiswahili" : "English"}
            </span>
          </button>

          <button
            onClick={onCorner}
            className="flex w-full items-center gap-2.5 rounded-2xl border border-zinc-900/[0.07] bg-white/75 px-3 py-2.5 text-left transition-colors hover:border-[color:var(--brand)]"
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-zinc-900/[0.05] text-zinc-500">
              {corner === "br" ? <PanelRight className="h-4 w-4" /> : <PanelLeft className="h-4 w-4" />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[12.5px] font-semibold leading-tight text-zinc-800">Which side</span>
              <span className="mt-0.5 block text-[10.5px] leading-snug text-zinc-500">
                Drag the launcher anywhere; it snaps to the nearest side.
              </span>
            </span>
            <span className="shrink-0 rounded-full bg-zinc-900/5 px-2 py-0.5 text-[10px] font-bold text-zinc-600">
              {corner === "br" ? "Right" : "Left"}
            </span>
          </button>
        </div>

        {/* ── CONVERSATIONS ─────────────────────────────────────────────────── */}
        <div className="space-y-1.5">
          <SectionLabel>Conversations</SectionLabel>
          {historyAvailable ? (
            <>
              <div className="flex items-center gap-2.5 rounded-2xl border border-zinc-900/[0.07] bg-white/75 px-3 py-2.5">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-zinc-900/[0.05] text-zinc-500">
                  <History className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[12.5px] font-semibold leading-tight text-zinc-800">
                    {threadCount} saved conversation{threadCount === 1 ? "" : "s"}
                  </span>
                  <span className="mt-0.5 block text-[10.5px] leading-snug text-zinc-500">
                    Kept so you can pick one up later. Only you can read yours.
                  </span>
                </span>
              </div>
              <button
                onClick={clear}
                disabled={clearing || threadCount === 0}
                className={`flex w-full items-center gap-2.5 rounded-2xl border px-3 py-2.5 text-left transition-colors disabled:opacity-40 ${
                  confirm ? "border-rose-300 bg-rose-50" : "border-zinc-900/[0.07] bg-white/75 hover:border-rose-300"
                }`}
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-rose-50 text-rose-500">
                  {clearing ? <Loader2 className="h-4 w-4 animate-spin" /> : cleared ? <Check className="h-4 w-4 text-emerald-600" /> : <Trash2 className="h-4 w-4" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[12.5px] font-semibold leading-tight text-rose-700">
                    {cleared ? "All conversations deleted" : confirm ? "Tap again to delete everything" : "Delete every conversation"}
                  </span>
                  <span className="mt-0.5 block text-[10.5px] leading-snug text-zinc-500">
                    Gone, not hidden. The audit record that the questions were asked stays — the transcripts are yours.
                  </span>
                </span>
              </button>
            </>
          ) : (
            <div className="flex items-start gap-2.5 rounded-2xl border border-zinc-900/[0.07] bg-white/60 px-3 py-2.5">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-zinc-400" />
              <p className="text-[10.5px] leading-snug text-zinc-500">
                Conversation history isn&apos;t switched on for this deployment yet. Everything still works — questions
                just aren&apos;t kept between sessions.
              </p>
            </div>
          )}
        </div>

        {/* ── THE ACCOUNT ───────────────────────────────────────────────────── */}
        <div>
          <SectionLabel>{ASSISTANT_NAME} &amp; you</SectionLabel>
          <div className="-mx-3.5 mt-1.5">
            <RiriAccount
              inline
              voiceOn={voiceOn}
              onVoice={onVoice}
              autoGo={autoGo}
              onAutoGo={onAutoGo}
              lang={lang}
              onLang={onLang}
              speaking={speaking}
            />
          </div>
        </div>
      </div>
    </Screen>
  );
}
