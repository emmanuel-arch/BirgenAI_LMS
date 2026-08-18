"use client";

import Link from "next/link";
import { ShieldAlert, ShieldCheck, TriangleAlert } from "lucide-react";
import { Card, CardHead, PageHead, Stat, Tag, N, ago, Empty } from "@/components/suite/kit";

type Row = {
  id: string; createdAt: string; kind: string; headline: string;
  actorName: string; subjectName: string | null; liveLoanId: number; entityId: number;
  shadowSql: string; state: string; error: string | null;
};

export default function ShadowQueue({
  posture, counts, rows,
}: {
  posture: { armed: boolean; label: string; detail: string };
  counts: { shadow: number; failed: number; mirrored: number };
  rows: Row[];
}) {
  return (
    <div className="mx-auto max-w-[1200px] px-4 py-6 sm:px-6">
      <PageHead
        eyebrow="Plumbing"
        title="Write queue"
        sub="Everything ConnectDesk would write into Micromart's production CollectBox, composed in full and held for review."
      />

      <div
        className={`mb-4 flex items-start gap-3 rounded-xl border px-4 py-3.5 ${
          posture.armed ? "border-red-500/30 bg-red-500/[0.05]" : "border-amber-500/30 bg-amber-500/[0.06]"
        }`}
      >
        {posture.armed ? (
          <ShieldAlert className="mt-px h-5 w-5 shrink-0 text-red-600" />
        ) : (
          <ShieldCheck className="mt-px h-5 w-5 shrink-0 text-amber-600" />
        )}
        <div className="min-w-0">
          <p className={`text-[13px] font-bold ${posture.armed ? "text-red-900" : "text-amber-900"}`}>{posture.label}</p>
          <p className={`mt-1 text-[11.5px] leading-relaxed ${posture.armed ? "text-red-800/85" : "text-amber-800/85"}`}>
            {posture.detail}
          </p>
          <p className="mt-1.5 text-[11px] leading-relaxed text-zinc-600">
            The mirror is controlled by one environment variable,{" "}
            <code className="rounded bg-zinc-900/[0.07] px-1 text-[10.5px]">COLLECTBOX_POSTING_ENABLED</code>. Nothing in
            the interface can arm it — that is deliberate: a button that can start writing to somebody else&rsquo;s
            production database is a button that gets pressed by accident.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Stat label="Held for review" value={N(counts.shadow)} foot="composed, not executed" />
        <Stat label="Written to CollectBox" value={N(counts.mirrored)} foot="mirrored successfully" />
        <Stat label="Failed" value={N(counts.failed)} foot={counts.failed > 0 ? "needs a look" : "none"} tone="up-bad" />
      </div>

      <Card className="mt-3" pad={false}>
        <div className="p-4 pb-2">
          <CardHead
            title="The statements"
            sub="Values are inlined so a person can read them. The execution path always binds parameters and never interpolates — this rendering is for review only."
          />
        </div>
        {rows.length === 0 ? (
          <div className="p-4">
            <Empty
              title="Nothing waiting"
              detail="Work a case in the queue — log a disposition, take a promise, schedule a callback — and the statement it composes appears here."
            />
          </div>
        ) : (
          <ol className="divide-y divide-zinc-900/[0.05]">
            {rows.map((r) => (
              <li key={r.id} className="px-4 py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-1.5 text-[12.5px] font-semibold text-zinc-800">
                      {r.headline}
                      <Tag tone={r.state === "FAILED" ? "bad" : "warn"}>{r.state === "FAILED" ? "Failed" : "Held"}</Tag>
                      {r.entityId === 3005 && <Tag tone="good">Fintech 3005</Tag>}
                    </p>
                    <p className="mt-0.5 text-[11px] text-zinc-500">
                      {r.subjectName ? (
                        <Link href={`/desk/case/${r.liveLoanId}`} className="hover:text-[color:var(--accent)] hover:underline">
                          {r.subjectName}
                        </Link>
                      ) : (
                        `loan #${r.liveLoanId}`
                      )}
                      <span className="text-zinc-400"> · {r.actorName} · {ago(r.createdAt)}</span>
                    </p>
                  </div>
                  <span className="shrink-0 rounded bg-zinc-900/[0.05] px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wide text-zinc-500">
                    {r.kind}
                  </span>
                </div>

                {r.error && (
                  <p className="mt-1.5 flex items-start gap-1.5 rounded-lg bg-red-500/[0.06] px-2 py-1.5 text-[11px] text-red-800">
                    <TriangleAlert className="mt-px h-3 w-3 shrink-0" />
                    {r.error}
                  </p>
                )}

                <pre className="mt-2 overflow-x-auto rounded-lg bg-zinc-900 p-2.5 text-[10px] leading-relaxed text-emerald-300">
                  {r.shadowSql}
                </pre>
              </li>
            ))}
          </ol>
        )}
      </Card>
    </div>
  );
}
