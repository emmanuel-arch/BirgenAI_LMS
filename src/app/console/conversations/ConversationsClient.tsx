"use client";

// ─────────────────────────────────────────────────────────────────────────────
// CUSTOMER MESSAGES — the officer's side of the channel.
//
// It is a QUEUE before it is an inbox, and the ordering is the whole opinion:
// AWAITING_STAFF first, then OLDEST FIRST inside that. Newest-first is right for
// a chat app and wrong here — it buries the person who has been waiting since
// Tuesday under everyone who wrote this morning, which is exactly the failure
// mode of every shared support inbox.
//
// ── TWO PANES, NOT A LIST AND A PAGE ────────────────────────────────────────
// An officer works a queue by moving down it, and a full-page navigation per
// conversation means a round trip back to the list to reach the next one. The
// split view keeps the queue on screen, so answering three in a row is three
// clicks rather than nine. Below `lg` it collapses to one pane at a time,
// because two 300px columns is neither.
//
// ── WHAT THE OFFICER SEES THAT THE CUSTOMER DOES NOT ────────────────────────
// The borrower's phone, ID and KYC state, and a link into their file. Not
// decoration: most of these conversations are about a check that referred them,
// and an officer who has to leave the thread to find out who they are talking to
// answers more slowly and more generically.
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  MessagesSquare, Send, Loader2, AlertCircle, CheckCircle2, GitBranch,
  Clock, UserCheck, Inbox, RefreshCw,
} from "lucide-react";
import { PageHeader } from "@/components/shell/PageHeader";

type ThreadState = "AWAITING_STAFF" | "AWAITING_CUSTOMER" | "RESOLVED";
type Author = "borrower" | "staff" | "system";

type Row = {
  id: string;
  subject: string;
  kind: string;
  state: ThreadState;
  stageTitle: string | null;
  lastAt: string;
  preview: string | null;
  lastAuthor: Author | null;
  unread: number;
  assignedTo: string | null;
  assignedName: string | null;
  applicationId: string | null;
  openedAt: string;
  borrower: { id: string; name: string; phone: string | null };
};

type Msg = {
  id: string;
  author: Author;
  authorName: string;
  body: string;
  event: string | null;
  at: string;
};

type Detail = {
  id: string;
  subject: string;
  kind: string;
  state: ThreadState;
  stageTitle: string | null;
  applicationId: string | null;
  loanId: string | null;
  assignedName: string | null;
  openedAt: string;
  borrower: {
    id: string; name: string; phone: string | null; nationalId: string | null;
    kycStatus?: string; erased: boolean;
  };
  messages: Msg[];
};

const STATE: Record<ThreadState, { label: string; cls: string }> = {
  AWAITING_STAFF: { label: "Needs a reply", cls: "bg-rose-100 text-rose-700" },
  AWAITING_CUSTOMER: { label: "Waiting on them", cls: "bg-sky-100 text-sky-700" },
  RESOLVED: { label: "Closed", cls: "bg-ash-900/5 text-ash-600" },
};

const KIND_LABEL: Record<string, string> = {
  APPLICATION: "Application",
  KYC_REVIEW: "ID check",
  LOAN: "Loan",
  REPAYMENT: "Repayment",
  GENERAL: "General",
};

function ago(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.round(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

export function ConversationsClient({ openId }: { openId: string | null }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [waiting, setWaiting] = useState(0);
  const [listErr, setListErr] = useState<string | null>(null);
  const [loadingList, setLoadingList] = useState(true);

  const [selected, setSelected] = useState<string | null>(openId);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailErr, setDetailErr] = useState<string | null>(null);

  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const foot = useRef<HTMLDivElement>(null);

  const loadList = useCallback(async () => {
    setLoadingList(true);
    try {
      const r = await fetch("/api/console/conversations", { cache: "no-store" });
      const j = await r.json();
      if (!j.success) throw new Error(j.message ?? "Could not load the queue.");
      setRows(j.threads as Row[]);
      setWaiting(j.waiting as number);
      setListErr(null);
    } catch (e) {
      setListErr(e instanceof Error ? e.message : "Could not load the queue.");
    } finally {
      setLoadingList(false);
    }
  }, []);

  const loadDetail = useCallback(async (id: string) => {
    setLoadingDetail(true);
    setDetailErr(null);
    try {
      const r = await fetch(`/api/console/conversations?threadId=${encodeURIComponent(id)}`, { cache: "no-store" });
      const j = await r.json();
      if (!j.success) throw new Error(j.message ?? "Could not open that conversation.");
      setDetail(j.thread as Detail);
    } catch (e) {
      setDetailErr(e instanceof Error ? e.message : "Could not open that conversation.");
    } finally {
      setLoadingDetail(false);
    }
  }, []);

  useEffect(() => { void loadList(); }, [loadList]);
  useEffect(() => { if (selected) void loadDetail(selected); }, [selected, loadDetail]);
  useEffect(() => { foot.current?.scrollIntoView({ block: "end" }); }, [detail?.messages.length]);

  const act = async (action: "reply" | "resolve" | "assign") => {
    if (!selected || busy) return;
    if (action === "reply" && !reply.trim()) return;
    setBusy(true);
    try {
      const r = await fetch("/api/console/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ threadId: selected, action, ...(action === "reply" ? { body: reply.trim() } : {}) }),
      });
      const j = await r.json();
      if (!j.success) throw new Error(j.message ?? "That did not go through.");
      if (action === "reply") setReply("");
      await Promise.all([loadDetail(selected), loadList()]);
    } catch (e) {
      setDetailErr(e instanceof Error ? e.message : "That did not go through.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        icon={MessagesSquare}
        title="Customer Messages"
        subtitle={
          waiting > 0
            ? `${waiting} ${waiting === 1 ? "conversation is" : "conversations are"} waiting on a reply from us.`
            : "Nothing is waiting on a reply. Customers can write in from the app about any stage of their loan."
        }
      >
        <button
          onClick={() => void loadList()}
          className="inline-flex items-center gap-1.5 rounded-lg border border-ash-900/10 px-3 py-2 text-[13px] font-medium text-ash-600 hover:bg-ash-900/5"
        >
          <RefreshCw className="h-3.5 w-3.5" /> Refresh
        </button>
      </PageHeader>

      {listErr && (
        <div className="flex items-start gap-2 rounded-lg bg-rose-50 p-3 text-[13px] text-rose-700">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{listErr}</span>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)] lg:items-start">
        {/* ── THE QUEUE ──────────────────────────────────────────────────── */}
        <div className={`space-y-1.5 ${selected ? "hidden lg:block" : ""}`}>
          {loadingList && rows.length === 0 && (
            <div className="flex items-center gap-2 rounded-xl border border-ash-900/10 p-4 text-[13px] text-ash-600">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          )}

          {!loadingList && rows.length === 0 && !listErr && (
            <div className="rounded-xl border border-ash-900/10 p-6 text-center">
              <Inbox className="mx-auto h-6 w-6 text-ash-400" />
              <p className="mt-2 text-[14px] font-semibold text-ash-900">Nothing in the queue</p>
              <p className="mt-1 text-[13px] text-ash-600">
                When a customer writes in from the app, their message lands here.
              </p>
            </div>
          )}

          {rows.map((t) => (
            <button
              key={t.id}
              onClick={() => setSelected(t.id)}
              className={`w-full rounded-xl border p-3 text-left transition-colors ${
                selected === t.id
                  ? "border-navy/30 bg-navy/[0.04]"
                  : "border-ash-900/10 hover:bg-ash-900/[0.02]"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <p className="min-w-0 flex-1 truncate text-[13.5px] font-semibold text-ash-900">{t.borrower.name}</p>
                {t.unread > 0 && (
                  <span className="shrink-0 rounded-full bg-rose-600 px-1.5 py-0.5 text-[10px] font-bold text-white">
                    {t.unread}
                  </span>
                )}
              </div>

              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                <span className={`rounded px-1.5 py-0.5 text-[10.5px] font-semibold ${STATE[t.state].cls}`}>
                  {STATE[t.state].label}
                </span>
                <span className="text-[11px] text-ash-500">
                  {KIND_LABEL[t.kind] ?? t.kind}
                  {t.stageTitle ? ` · ${t.stageTitle}` : ""}
                </span>
              </div>

              {t.preview && (
                <p className="mt-1.5 line-clamp-2 text-[12.5px] leading-relaxed text-ash-600">
                  {t.lastAuthor === "staff" ? "You: " : ""}
                  {t.preview}
                </p>
              )}

              <p className="mt-1.5 flex items-center gap-1 text-[11px] text-ash-500">
                <Clock className="h-3 w-3" /> {ago(t.lastAt)}
                {t.assignedName ? ` · ${t.assignedName}` : ""}
              </p>
            </button>
          ))}
        </div>

        {/* ── THE CONVERSATION ───────────────────────────────────────────── */}
        <div className={`${selected ? "" : "hidden lg:block"}`}>
          {!selected && (
            <div className="rounded-xl border border-ash-900/10 p-10 text-center">
              <MessagesSquare className="mx-auto h-6 w-6 text-ash-400" />
              <p className="mt-2 text-[14px] font-semibold text-ash-900">Pick a conversation</p>
              <p className="mt-1 text-[13px] text-ash-600">The oldest unanswered one is at the top.</p>
            </div>
          )}

          {selected && (
            <div className="rounded-xl border border-ash-900/10">
              {/* Who this is, without leaving the thread. */}
              {detail && (
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-ash-900/10 p-4">
                  <div className="min-w-0">
                    <p className="text-[14px] font-semibold text-ash-900">{detail.subject}</p>
                    <p className="mt-0.5 text-[12.5px] text-ash-600">
                      {detail.borrower.name}
                      {detail.borrower.phone ? ` · ${detail.borrower.phone}` : ""}
                      {detail.borrower.nationalId ? ` · ID ${detail.borrower.nationalId}` : ""}
                    </p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <span className={`rounded px-1.5 py-0.5 text-[10.5px] font-semibold ${STATE[detail.state].cls}`}>
                        {STATE[detail.state].label}
                      </span>
                      {detail.stageTitle && (
                        <span className="rounded bg-ash-900/5 px-1.5 py-0.5 text-[10.5px] font-semibold text-ash-600">
                          {detail.stageTitle}
                        </span>
                      )}
                      {detail.assignedName && (
                        <span className="inline-flex items-center gap-1 text-[11px] text-ash-500">
                          <UserCheck className="h-3 w-3" /> {detail.assignedName}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex shrink-0 flex-wrap gap-1.5">
                    {!detail.borrower.erased && (
                      <Link
                        href={`/console/borrowers/${detail.borrower.id}`}
                        className="rounded-lg border border-ash-900/10 px-2.5 py-1.5 text-[12.5px] font-medium text-ash-600 hover:bg-ash-900/5"
                      >
                        Open file
                      </Link>
                    )}
                    {detail.applicationId && (
                      <Link
                        href={`/console/applications/${detail.applicationId}`}
                        className="rounded-lg border border-ash-900/10 px-2.5 py-1.5 text-[12.5px] font-medium text-ash-600 hover:bg-ash-900/5"
                      >
                        Application
                      </Link>
                    )}
                    {detail.state !== "RESOLVED" && (
                      <button
                        onClick={() => void act("resolve")}
                        disabled={busy}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-ash-900/10 px-2.5 py-1.5 text-[12.5px] font-medium text-ash-600 hover:bg-ash-900/5 disabled:opacity-50"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" /> Resolve
                      </button>
                    )}
                  </div>
                </div>
              )}

              <div className="max-h-[52vh] space-y-3 overflow-y-auto p-4">
                {loadingDetail && !detail && (
                  <div className="flex items-center gap-2 text-[13px] text-ash-600">
                    <Loader2 className="h-4 w-4 animate-spin" /> Opening…
                  </div>
                )}

                {detail?.messages.map((m) =>
                  m.author === "system" ? (
                    // The workflow's own voice, rendered as context rather than
                    // as a participant — the customer sees the identical row.
                    <div key={m.id} className="flex justify-center">
                      <span className="inline-flex max-w-[46ch] items-center gap-1.5 rounded-full bg-ash-900/5 px-3 py-1 text-[11.5px] font-medium text-ash-600">
                        <GitBranch className="h-3 w-3 shrink-0" />
                        {m.body}
                      </span>
                    </div>
                  ) : (
                    <div key={m.id} className={`flex ${m.author === "staff" ? "justify-end" : "justify-start"}`}>
                      <div className="max-w-[80%]">
                        <p className="mb-0.5 px-1 text-[11px] font-semibold text-ash-500">{m.authorName}</p>
                        <div
                          className={`rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed ${
                            m.author === "staff" ? "bg-navy text-white" : "bg-ash-900/5 text-ash-900"
                          }`}
                        >
                          <p className="whitespace-pre-wrap">{m.body}</p>
                        </div>
                        <p
                          className={`mt-0.5 px-1 text-[11px] text-ash-500 ${
                            m.author === "staff" ? "text-right" : ""
                          }`}
                        >
                          {ago(m.at)}
                        </p>
                      </div>
                    </div>
                  ),
                )}
                <div ref={foot} />
              </div>

              <div className="border-t border-ash-900/10 p-4">
                {detailErr && (
                  <p className="mb-2 flex items-start gap-1.5 text-[12.5px] text-rose-700">
                    <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    {detailErr}
                  </p>
                )}
                <textarea
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault();
                      void act("reply");
                    }
                  }}
                  rows={3}
                  maxLength={4000}
                  placeholder="Write a reply. The customer sees this in their app."
                  aria-label="Your reply"
                  className="w-full resize-y rounded-lg border border-ash-900/10 px-3 py-2.5 text-[13px] leading-relaxed outline-none focus:border-navy/40"
                />
                <div className="mt-2 flex items-center justify-between gap-3">
                  <span className="text-[11.5px] text-ash-500">
                    This goes to the customer under your name. Ctrl + Enter to send.
                  </span>
                  <button
                    onClick={() => void act("reply")}
                    disabled={busy || !reply.trim()}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-navy px-3.5 py-2 text-[13px] font-semibold text-white disabled:opacity-50"
                  >
                    {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                    Send
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
