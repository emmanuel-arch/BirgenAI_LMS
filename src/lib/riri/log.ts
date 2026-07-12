// ─────────────────────────────────────────────────────────────────────────────
// RiriQueryLog — what was asked, what ran, what came back.
//
// Three readers, and the log has to serve all three:
//   the LENDER  — "on what basis did Riri tell my board 36% of the book was at risk?"
//                 The SQL is right there, exactly as it ran.
//   US          — every REFUSED row is a question the catalogue could not express.
//                 That is the roadmap for which metric to add next, written by the
//                 people actually using the thing rather than guessed at by us.
//   a REGULATOR — an adverse decision that leans on a number should be traceable to
//                 the query that produced it.
//
// Best-effort by construction: a failure to WRITE the log must never take down the
// ANSWER. A lender losing an audit row is a problem we can fix tomorrow; a lender
// unable to read their own book because logging broke is an outage today.
// ─────────────────────────────────────────────────────────────────────────────
import { prisma } from "@/lib/prisma";

export type QueryLogEntry = {
  orgId: string;
  staffId?: string | null;
  model: string;
  question: string;
  route: string;
  metricId?: string | null;
  sql?: string | null;
  rows?: number | null;
  ms?: number | null;
  ok: boolean;
  error?: string | null;
};

export async function logRiriQuery(entry: QueryLogEntry): Promise<void> {
  try {
    await prisma.ririQueryLog.create({
      data: {
        orgId: entry.orgId,
        staffId: entry.staffId ?? null,
        model: entry.model,
        // The question is stored as asked. It is a lender's own staff asking about a
        // lender's own book, and a paraphrase would make the log useless for the one
        // job it has — telling us which questions Riri could not answer.
        question: entry.question.slice(0, 500),
        route: entry.route,
        metricId: entry.metricId ?? null,
        sql: entry.sql?.slice(0, 4000) ?? null,
        rows: entry.rows ?? null,
        ms: entry.ms ?? null,
        ok: entry.ok,
        error: entry.error?.slice(0, 500) ?? null,
      },
    });
  } catch (err) {
    console.error("[riri] could not write the query log:", err);
  }
}
