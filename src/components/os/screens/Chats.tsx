"use client";

// ─────────────────────────────────────────────────────────────────────────────
// CHATS — the conversations you have already had.
//
// The thing this fixes is small to describe and large to live with: every question
// an officer had ever asked died when they closed the panel. "What did you tell me
// last week?" was a question the assistant could only answer from its distilled
// MEMORY — a few sentences it chose to keep — not from the transcript. So the
// advice survived and the reasoning behind it did not.
//
// Pinning exists because one conversation in twenty is a working document — the
// restructure you are halfway through arguing out — and it should not sink under
// nineteen lookups.
//
// Delete means delete (see lib/riri/threads.ts). Somebody removing a conversation
// with an assistant is usually removing something they said about a customer or a
// colleague, and "we archived it where you can't see it" is the wrong answer.
// ─────────────────────────────────────────────────────────────────────────────
import { useState } from "react";
import { motion } from "framer-motion";
import { History, Pin, PinOff, Trash2, Loader2, MessageCircle, Search, UserRound } from "lucide-react";
import { Screen, SectionLabel, EmptyState, ago } from "../kit";
import type { ThreadSummary } from "@/lib/riri/threads";

export function ChatsScreen({
  threads, loading, available, onOpen, onPin, onDelete, onNew,
}: {
  threads: ThreadSummary[];
  loading: boolean;
  available: boolean;
  onOpen: (t: ThreadSummary) => void;
  onPin: (t: ThreadSummary) => void;
  onDelete: (t: ThreadSummary) => void;
  onNew: () => void;
}) {
  const [q, setQ] = useState("");
  const [confirming, setConfirming] = useState<string | null>(null);

  const needle = q.trim().toLowerCase();
  const shown = needle
    ? threads.filter((t) =>
        t.title.toLowerCase().includes(needle) ||
        (t.preview ?? "").toLowerCase().includes(needle) ||
        (t.subjectName ?? "").toLowerCase().includes(needle))
    : threads;

  const pinned = shown.filter((t) => t.pinned);
  const rest = shown.filter((t) => !t.pinned);

  if (loading) {
    return (
      <Screen>
        <div className="flex flex-1 items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-ash-300" />
        </div>
      </Screen>
    );
  }

  // History has not been switched on for this deployment. Said plainly, because an
  // empty list here looks exactly like "we lost your conversations".
  if (!available) {
    return (
      <Screen>
        <EmptyState
          icon={<History className="h-6 w-6" />}
          title="Conversation history isn't on yet"
          detail="Your questions still work exactly as they do now — they just aren't being kept between sessions. An administrator switches this on."
          action={
            <button
              onClick={onNew}
              className="rounded-xl px-3.5 py-2 text-[12px] font-semibold text-white"
              style={{ backgroundColor: "var(--brand)" }}
            >
              Start a conversation
            </button>
          }
        />
      </Screen>
    );
  }

  if (!threads.length) {
    return (
      <Screen>
        <EmptyState
          icon={<MessageCircle className="h-6 w-6" />}
          title="Nothing here yet"
          detail="Ask something and it will be waiting for you here on Monday — with the numbers, the query and the reasoning intact."
          action={
            <button
              onClick={onNew}
              className="rounded-xl px-3.5 py-2 text-[12px] font-semibold text-white"
              style={{ backgroundColor: "var(--brand)" }}
            >
              Ask something
            </button>
          }
        />
      </Screen>
    );
  }

  const Item = ({ t, i }: { t: ThreadSummary; i: number }) => (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(i, 8) * 0.025 }}
      className="group relative"
    >
      <button
        onClick={() => onOpen(t)}
        className="flex w-full items-start gap-2.5 rounded-2xl border border-ash-900/[0.07] bg-paper/75 px-3 py-2.5 text-left transition-all hover:border-[color:var(--brand)] hover:bg-paper active:scale-[0.985]"
      >
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-ash-900/[0.05] text-ash-500">
          {t.subjectName ? <UserRound className="h-4 w-4" /> : <MessageCircle className="h-4 w-4" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1">
            {t.pinned && <Pin className="h-2.5 w-2.5 shrink-0" style={{ color: "var(--brand)" }} />}
            <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold leading-tight text-ash-800">{t.title}</span>
          </span>
          {t.preview && (
            <span className="mt-0.5 block line-clamp-2 text-[10.5px] leading-snug text-ash-500">{t.preview}</span>
          )}
          <span className="mt-1 flex items-center gap-1.5 text-[9.5px] text-ash-400">
            <span>{ago(t.lastAt)}</span>
            <span className="text-ash-300">·</span>
            <span>{t.messages} message{t.messages === 1 ? "" : "s"}</span>
            {t.subjectName && (
              <>
                <span className="text-ash-300">·</span>
                <span className="truncate">about {t.subjectName}</span>
              </>
            )}
          </span>
        </span>
      </button>

      {/* Row actions. Visible on hover on a desktop, and always present for touch —
          a control you can only reveal with a pointer is a control a field officer
          does not have. */}
      <div className="absolute right-2 top-2 flex gap-0.5 opacity-60 transition-opacity group-hover:opacity-100">
        <button
          onClick={(e) => { e.stopPropagation(); onPin(t); }}
          className="flex h-6 w-6 items-center justify-center rounded-lg bg-paper/80 text-ash-400 hover:text-ash-800"
          aria-label={t.pinned ? "Unpin" : "Pin"}
          title={t.pinned ? "Unpin" : "Pin to the top"}
        >
          {t.pinned ? <PinOff className="h-3 w-3" /> : <Pin className="h-3 w-3" />}
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            if (confirming === t.id) { onDelete(t); setConfirming(null); }
            else { setConfirming(t.id); window.setTimeout(() => setConfirming((c) => (c === t.id ? null : c)), 3000); }
          }}
          className={`flex h-6 items-center justify-center rounded-lg px-1.5 text-[9px] font-bold transition-colors ${
            confirming === t.id ? "bg-rose-500 text-white" : "bg-paper/80 text-ash-400 hover:text-rose-600"
          }`}
          aria-label="Delete conversation"
          title="Delete"
        >
          {confirming === t.id ? "Sure?" : <Trash2 className="h-3 w-3" />}
        </button>
      </div>
    </motion.div>
  );

  return (
    <Screen>
      <div className="shrink-0 pb-2 pt-1">
        <div className="flex items-center gap-2 rounded-xl border border-ash-900/[0.12] bg-paper px-2.5 focus-within:border-[color:var(--brand)]">
          <Search className="h-3.5 w-3.5 shrink-0 text-ash-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search your conversations"
            className="flex-1 bg-transparent py-2 text-[12px] outline-none placeholder:text-ash-400"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto pb-3">
        {pinned.length > 0 && (
          <>
            <SectionLabel>Pinned</SectionLabel>
            {pinned.map((t, i) => <Item key={t.id} t={t} i={i} />)}
            {rest.length > 0 && <SectionLabel className="pt-2">Earlier</SectionLabel>}
          </>
        )}
        {rest.map((t, i) => <Item key={t.id} t={t} i={i + pinned.length} />)}
        {shown.length === 0 && (
          <p className="pt-6 text-center text-[11.5px] text-ash-500">Nothing matches &ldquo;{q}&rdquo;.</p>
        )}
      </div>
    </Screen>
  );
}
