// ─────────────────────────────────────────────────────────────────────────────
// THE MASTER FILE, ON SCREEN.
//
// Two halves, and the second is the one that makes it useful:
//
//   WHAT WE HOLD    every scrutiny ever obtained about this person, newest
//                   first, each saying what it found and what it was worth.
//   WHAT IS MISSING what could be known and is not, priced — so an officer
//                   spends their next effort where it moves the file most.
//
// The WEIGHT across the top is the file answering the underwriter's real
// question: is this decision resting on evidence, or on optimism? It is also the
// number that matters on the Interchange, where a member's contribution is
// judged by the weight of what they publish rather than by how many rows.
// ─────────────────────────────────────────────────────────────────────────────
import Link from "next/link";
import { CheckCircle2, CircleDashed, Download, FileText, TriangleAlert } from "lucide-react";
import type { MasterFile, Evidence, EvidenceKind } from "@/lib/lms/master-file";

const KIND_LABEL: Record<EvidenceKind, string> = {
  identity: "Identity",
  registry: "Registry",
  bureau: "Bureau",
  interchange: "Interchange",
  affordability: "Affordability",
  repayment: "Repayment",
  document: "Documents",
  consent: "Consent",
};

const TONE: Record<Evidence["tone"], { ink: string; soft: string }> = {
  good: { ink: "#047857", soft: "rgba(5,150,105,0.10)" },
  warn: { ink: "#b45309", soft: "rgba(217,119,6,0.12)" },
  bad: { ink: "#be123c", soft: "rgba(225,29,72,0.10)" },
  neutral: { ink: "var(--ink-muted)", soft: "rgba(0,0,0,0.04)" },
};

const day = (d: string) => new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

/**
 * The weight, as a bar you can read across the room.
 *
 * Segmented by class rather than drawn as one block, so the bar says WHY the
 * file is at 62 and not merely that it is — the gap in the middle is the bureau
 * report nobody has pulled.
 */
function WeightBar({ file }: { file: MasterFile }) {
  const held = new Map<EvidenceKind, number>();
  for (const e of file.evidence) held.set(e.kind, Math.max(held.get(e.kind) ?? 0, e.contributed));
  const segments = [...held.entries()].sort((a, b) => b[1] - a[1]);
  const tone = file.weight >= 70 ? "#059669" : file.weight >= 40 ? "#d97706" : "#e11d48";

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <span className="text-3xl font-bold leading-none tabular-nums" style={{ color: tone }}>{file.weight}</span>
          <span className="text-sm font-semibold text-[color:var(--ink-muted)]">/ 100 known</span>
        </div>
        {file.lastLearnedAt && (
          <span className="text-[12px] text-[color:var(--ink-faint)]">Last learned something {day(file.lastLearnedAt)}</span>
        )}
      </div>
      <div className="mt-2 flex h-3 gap-px overflow-hidden rounded-full bg-ash-900/[0.07]">
        {segments.map(([kind, v]) => (
          <div
            key={kind}
            title={`${KIND_LABEL[kind]} — ${v} points`}
            style={{ width: `${v}%`, backgroundColor: tone, opacity: 0.55 + Math.min(0.45, v / 50) }}
          />
        ))}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
        {segments.map(([kind, v]) => (
          <span key={kind} className="text-[11px] text-[color:var(--ink-faint)]">
            {KIND_LABEL[kind]} <span className="font-semibold tabular-nums text-[color:var(--ink-muted)]">{v}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

export function MasterFilePanel({ file, borrowerId }: { file: MasterFile; borrowerId: string }) {
  return (
    <div className="space-y-4">
      <section className="glass p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="t-section">How well do we know this customer?</h2>
            <p className="mt-0.5 text-[12px] text-[color:var(--ink-muted)]">
              Every scrutiny this ecosystem has obtained, composed from the systems that already hold each one —
              so a new check appears here the moment it is run, without anybody filing it twice.
            </p>
          </div>
          {/* TWO ARTIFACTS, AND THEY ARE NOT THE SAME DOCUMENT.
              · THE CASE FILE is for a person: the face, the identity page, every
                photograph an officer took in the field, laid out to be printed,
                annotated in a committee and filed.
              · THE REGISTER is for a machine: what was checked, by whom, when and
                what it found, with no images and no bureau payloads, because it
                is built to be published to the Interchange.
              Offering only the second one meant the only thing an underwriter
              could carry into a meeting was a JSON file. */}
          <div className="flex shrink-0 flex-wrap gap-2">
            <Link
              href={`/console/borrowers/${borrowerId}/dossier`}
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[12px] font-semibold text-white transition-opacity hover:opacity-90"
              style={{ backgroundColor: "var(--brand)" }}
            >
              <FileText className="h-3.5 w-3.5" /> Open the case file
            </Link>
            <a
              href={`/api/console/borrowers/${borrowerId}/master-file`}
              className="inline-flex items-center gap-1.5 rounded-lg border border-ash-900/12 bg-paper/70 px-3 py-2 text-[12px] font-semibold text-[color:var(--ink-body)] transition-colors hover:bg-ash-900/[0.04]"
            >
              <Download className="h-3.5 w-3.5" /> Evidence register
            </a>
          </div>
        </div>
        <div className="mt-4">
          <WeightBar file={file} />
        </div>
      </section>

      <section className="glass p-5">
        <h2 className="t-section">What we hold</h2>
        {file.evidence.length === 0 ? (
          <p className="mt-3 t-meta">
            Nothing has been obtained about this customer yet — not an identity check, not a statement, not a bureau
            file. Every decision made now is made on their word alone.
          </p>
        ) : (
          <ol className="mt-3.5 space-y-2.5">
            {file.evidence.map((e) => {
              const t = TONE[e.tone];
              return (
                <li key={e.id} className="rounded-xl border border-ash-900/10 bg-paper/60 p-3.5">
                  <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide" style={{ backgroundColor: t.soft, color: t.ink }}>
                          {KIND_LABEL[e.kind]}
                        </span>
                        <span className="text-[13px] font-semibold text-[color:var(--ink)]">{e.title}</span>
                      </div>
                      <p className="mt-1 text-[13px] leading-relaxed text-[color:var(--ink-body)]">{e.headline}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-[11px] text-[color:var(--ink-faint)]">{day(e.at)}</p>
                      <p className="text-[12px] font-bold tabular-nums" style={{ color: t.ink }}>+{e.contributed}</p>
                    </div>
                  </div>
                  {e.facts.length > 0 && (
                    <dl className="mt-2.5 flex flex-wrap gap-x-5 gap-y-1 border-t border-ash-900/[0.07] pt-2.5">
                      {e.facts.map((f, i) => (
                        <div key={i} className="min-w-0">
                          <dt className="text-[10px] uppercase tracking-wide text-[color:var(--ink-faint)]">{f.label}</dt>
                          <dd className="text-[12px] font-semibold text-[color:var(--ink)]">{f.value}</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                  <p className="mt-2 text-[11px] text-[color:var(--ink-faint)]">Source: {e.source}</p>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      {file.gaps.length > 0 && (
        <section className="glass p-5">
          <h2 className="t-section">What is missing</h2>
          <p className="mt-0.5 text-[12px] text-[color:var(--ink-muted)]">
            Priced by what each would add — so the next hour of effort goes where it moves the file most.
          </p>
          <ul className="mt-3.5 space-y-2">
            {file.gaps.map((g) => (
              <li key={g.kind} className="flex items-start gap-3 rounded-xl border border-dashed border-ash-900/15 p-3.5">
                <CircleDashed className="mt-0.5 h-4 w-4 shrink-0 text-[color:var(--ink-faint)]" aria-hidden />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[13px] font-semibold text-[color:var(--ink)]">{g.title}</span>
                    <span className="rounded bg-ash-900/[0.06] px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-[color:var(--ink-muted)]">
                      worth +{g.worth}
                    </span>
                  </div>
                  <p className="mt-1 text-[12px] leading-relaxed text-[color:var(--ink-muted)]">{g.why}</p>
                </div>
                {g.href && (
                  <Link href={g.href} className="shrink-0 text-[12px] font-semibold hover:underline" style={{ color: "var(--brand)" }}>
                    Get it →
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/** The rail badge: how complete the file is, and whether that is good news. */
export function masterFileBadge(file: MasterFile): { badge: string; tone: "good" | "warn" | "bad" } {
  return {
    badge: String(file.weight),
    tone: file.weight >= 70 ? "good" : file.weight >= 40 ? "warn" : "bad",
  };
}

export const MASTER_ICONS = { CheckCircle2, TriangleAlert };
