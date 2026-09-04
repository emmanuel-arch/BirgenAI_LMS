// ─────────────────────────────────────────────────────────────────────────────
// THE CASE FILE — the master file as a document a human can carry.
//
// ── WHY THIS EXISTS ALONGSIDE THE JSON ──────────────────────────────────────
// /api/console/borrowers/[id]/master-file already produces the EVIDENCE
// REGISTER: a machine-readable record of what was checked, by whom, when, and
// what it found. It deliberately holds no photographs and no bureau payloads,
// because it is built to be published to the Interchange and read by other
// members' systems.
//
// This is the other artifact, and the audience is a person: the underwriter
// taking a file into a committee, the officer preparing for a recovery visit,
// the auditor asking for "everything you had on this customer on the day you
// lent". It carries the face, the identity page, and every photograph an officer
// took in the field, because those are the things a human reading a file looks
// at first and a JSON document cannot hold.
//
// It is INTERNAL. It is not published anywhere, it is not offered to the
// customer, and it is reached only from Customer 360 by somebody who already
// holds borrowers.view — the same gate the images behind it already sit behind.
//
// ── WHY IT LOOKS THE WAY IT DOES ────────────────────────────────────────────
// Ruled fields, monospace labels, a case number, a classification bar. Not
// decoration: this document gets printed, annotated by hand in a meeting, and
// filed. Every field is on a rule so a pen has somewhere to go, the subject block
// is fixed at the top of page one so a file picked off a desk identifies itself
// in one glance, and the contact sheet at the back is laid out so a whole page of
// photographs survives a photocopier.
// ─────────────────────────────────────────────────────────────────────────────
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { resolveScope, borrowerScopeWhere } from "@/lib/rbac/scope";
import { resolveOrg } from "@/lib/tenancy";
import { readLiveCustomer360 } from "@/lib/lms/customer360";
import { readMasterFile, EVIDENCE_CLASSES, type MasterFile, type EvidenceKind } from "@/lib/lms/master-file";
import { getBorrowerAttachmentsLive, type LiveAttachment } from "@/lib/lms/servicesuite-attachments";
import { portraitsFor, PORTRAIT_TTL_SEC } from "@/lib/kyc/avatars";
import { signedUrl } from "@/lib/storage/provider";
import { DocumentSheet, DocumentFooter, type Lender } from "@/components/print/Document";
import { bandForScore, bandForBehavioural, normaliseBandName, BAND_BY_KEY } from "@/lib/risk/bands";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const kes = (n: number) => `KES ${Math.round(n).toLocaleString()}`;
const day = (v: string | Date | null | undefined) =>
  v ? new Date(v).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—";

const KIND_LABEL: Record<EvidenceKind, string> = {
  identity: "IDENTITY",
  registry: "REGISTRY",
  bureau: "BUREAU",
  interchange: "INTERCHANGE",
  affordability: "AFFORDABILITY",
  repayment: "REPAYMENT",
  document: "DOCUMENTS",
  consent: "CONSENT",
};

/** A labelled fact on a rule — the unit the whole file is built from. */
function Field({ label, value, wide }: { label: string; value: React.ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? "col-span-2" : ""}>
      <p className="font-mono text-[8px] uppercase tracking-[0.14em] text-ash-500">{label}</p>
      <p className="mt-0.5 border-b border-ash-900/15 pb-1 text-[12px] font-semibold leading-tight text-ash-900">
        {value || "—"}
      </p>
    </div>
  );
}

function SectionRule({ n, title, note }: { n: string; title: string; note?: string }) {
  return (
    <div className="mt-6 border-b-2 border-ash-900 pb-1 print-break">
      <h2 className="flex items-baseline gap-2 text-[12px] font-bold uppercase tracking-[0.12em] text-ash-900">
        <span className="font-mono text-[10px] text-ash-500">{n}</span>
        {title}
      </h2>
      {note && <p className="text-[10px] text-ash-500">{note}</p>}
    </div>
  );
}

export default async function BorrowerDossier({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.orgId) redirect("/login");
  const orgId = session.user.orgId;
  const { id } = await params;

  const scope = await resolveScope(session);
  const b = await prisma.borrower.findFirst({
    where: { id, orgId, ...borrowerScopeWhere(scope) },
    include: { loans: { select: { id: true, status: true } } },
  });
  if (!b) redirect("/console/borrowers");
  // A person who exercised their right to erasure has no file to compose. The
  // row survives because the financial record must; the person does not.
  if (b.erasedAt) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-16 text-center sm:px-6">
        <h1 className="text-lg font-semibold text-[color:var(--ink)]">This customer was erased</h1>
        <p className="t-meta mx-auto mt-2 max-w-[52ch] text-[13px] text-[color:var(--ink-muted)]">
          There is no file to produce. The financial record is retained; the person is not.
        </p>
      </main>
    );
  }

  const [brand, org, kyc] = await Promise.all([
    prisma.org.findUnique({ where: { id: orgId }, select: { name: true, accent: true, logoUrl: true } }),
    session.user.orgSlug ? resolveOrg(session.user.orgSlug) : null,
    prisma.kycSession.findFirst({ where: { orgId, OR: [{ borrowerId: id }, { phone: b.phone }] }, orderBy: { createdAt: "desc" } }),
  ]);
  const lender: Lender = {
    name: brand?.name ?? org?.name ?? "Lender",
    accent: brand?.accent ?? null,
    logoUrl: brand?.logoUrl ?? null,
  };
  const accent = lender.accent ?? "#111";

  const live = org?.bridgedReady && org.registry && org.entityId
    ? await readLiveCustomer360(org.registry, org.entityId, { serviceSuiteBorrowerId: b.serviceSuiteBorrowerId, phone: b.phone }, orgId).catch(() => null)
    : null;

  const [file, attachments, portrait] = await Promise.all([
    readMasterFile(orgId, id, { behaviour: live?.behaviour ?? null, hasLiveBook: !!live }).catch(() => null),
    live && org?.registry
      ? getBorrowerAttachmentsLive(org.registry, org.entityId, live.profile.borrowerId).catch(() => [] as LiveAttachment[])
      : Promise.resolve([] as LiveAttachment[]),
    portraitsFor([b.id]).then((m) => m[b.id] ?? null),
  ]);

  const portraitUrl =
    portrait
    ?? (kyc?.portraitKey ? await signedUrl(kyc.portraitKey, PORTRAIT_TTL_SEC) : null)
    ?? live?.profile.photoUrl
    ?? attachments.find((a) => a.id === "portrait")?.viewUrl
    ?? null;

  const name = `${b.firstName ?? "Borrower"}${b.otherName ? " " + b.otherName : ""}`.trim();
  const caseNo = `${(org?.entityId || 0) || "LMS"}-${b.id.slice(0, 8).toUpperCase()}`;
  const issuedBy = session.user.name ?? session.user.email ?? "staff";

  // The standing, computed the same way Customer 360 computes it — one rule, so
  // the file and the screen can never band the same person differently.
  const liveBehaviour = live?.behaviour ?? null;
  const liveScore = liveBehaviour?.scored ? liveBehaviour.score : null;
  const band =
    (liveBehaviour?.category ? BAND_BY_KEY.get(normaliseBandName(liveBehaviour.category.key) ?? "HIGH") ?? null : null)
    ?? bandForBehavioural(b.behaviouralScore)
    ?? bandForScore(b.creditScore)
    ?? (b.riskBand ? BAND_BY_KEY.get(normaliseBandName(b.riskBand) ?? "HIGH") ?? null : null);

  const st = live?.statement ?? null;
  const loans = st?.loans ?? [];
  const olb = loans.filter((l) => l.status === "ACTIVE").reduce((s, l) => s + l.balance, 0);
  const arrears = loans.reduce((s, l) => s + (l.arrears || 0), 0);
  const worstDpd = loans.reduce((m, l) => Math.max(m, l.daysInArrears ?? 0), 0);
  const officeTrail = (live?.profile.officeTrail ?? []).map((n) => n.unit).join(" › ");

  const identityShots = attachments.filter((a) => a.group === "identity" && a.id !== "portrait");
  const fieldShots = attachments.filter((a) => a.group === "field");

  return (
    <DocumentSheet backHref={`/console/borrowers/${b.id}?s=master`} backLabel={name} downloadLabel="Download case file">
      {/* ── CLASSIFICATION ─────────────────────────────────────────────────── */}
      <div
        className="flex flex-wrap items-center justify-between gap-2 border-y-2 px-3 py-1.5"
        style={{ borderColor: accent, backgroundColor: `${accent}0f` }}
      >
        <span className="font-mono text-[10px] font-bold uppercase tracking-[0.22em]" style={{ color: accent }}>
          Confidential · subject file
        </span>
        <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-ash-600">
          Case {caseNo} · opened {day(b.createdAt)}
        </span>
      </div>

      {/* ── LETTERHEAD ─────────────────────────────────────────────────────── */}
      <div className="mt-3 flex items-end justify-between gap-4">
        {lender.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={lender.logoUrl} alt={`${lender.name} logo`} className="h-10 max-w-[200px] object-contain object-left" />
        ) : (
          <p className="text-base font-bold">{lender.name}</p>
        )}
        <div className="text-right">
          <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-ash-500">Master file</p>
          <p className="text-[11px] text-ash-500">Composed {day(new Date())} · {issuedBy}</p>
        </div>
      </div>

      {/* ── 01 · THE SUBJECT ───────────────────────────────────────────────── */}
      <SectionRule n="01" title="Subject" />
      <section className="mt-3 grid gap-5 sm:grid-cols-[168px_1fr] print-break">
        {/* THE FACE, TOP LEFT. Every case file in the world opens with it, and for
            a reason: the first question a reader has is "is this the person I am
            about to be told about?". */}
        <div>
          <div className="aspect-[3/4] w-full overflow-hidden rounded-sm border-2 bg-ash-900/[0.05]" style={{ borderColor: accent }}>
            {portraitUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={portraitUrl} alt={name} className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full flex-col items-center justify-center gap-1 p-3 text-center">
                <span className="text-3xl font-bold text-ash-400">{name.slice(0, 1)}</span>
                <span className="font-mono text-[8px] uppercase tracking-widest text-ash-400">no portrait on file</span>
              </div>
            )}
          </div>
          <p className="mt-1 text-center font-mono text-[8px] uppercase tracking-[0.14em] text-ash-500">
            {portraitUrl ? "Portrait of record" : "Portrait not obtained"}
          </p>
        </div>

        <div>
          <h1 className="text-2xl font-bold leading-tight tracking-tight text-ash-900">{name}</h1>
          <p className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-ash-500">
            {b.kycStatus === "VERIFIED" ? "Identity verified" : `KYC ${b.kycStatus}`}
            {live && org ? ` · live on entity ${org.entityId}` : ""}
          </p>

          <div className="mt-3 grid grid-cols-2 gap-x-5 gap-y-2.5">
            <Field label="National ID" value={b.nationalId} />
            <Field label="Mobile" value={b.phone} />
            <Field label="Account number" value={live?.profile.accountNo} />
            <Field label="Date of birth" value={b.dob ? day(b.dob) : null} />
            <Field label="Gender" value={b.gender} />
            <Field label="Email" value={b.email} />
            <Field label="Office" value={officeTrail || live?.profile.branchName} wide />
            <Field label="Relationship officer" value={live?.profile.agentName} />
            <Field label="Customer since" value={day(b.createdAt)} />
            <Field
              label="Address"
              value={b.locationAddress ?? b.homeAddress}
              wide
            />
            {(b.lat != null && b.lng != null) && (
              <Field label="Pinned at" value={`${b.lat.toFixed(5)}, ${b.lng.toFixed(5)}`} wide />
            )}
          </div>
        </div>
      </section>

      {/* ── 02 · THE STANDING ──────────────────────────────────────────────── */}
      <SectionRule n="02" title="Standing" note="What this customer is, and what they owe, at the moment this file was composed." />
      <section className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4 print-break">
        {[
          { l: "Band", v: liveBehaviour?.category?.label ?? band?.label ?? "Not banded", s: liveScore != null ? `score ${liveScore.toFixed(1)} / 100` : "no repayment record" },
          { l: "Loan limit", v: live?.profile.loanLimit != null ? kes(live.profile.loanLimit) : b.loanLimit != null ? kes(Number(b.loanLimit)) : "—", s: b.graduationCount > 0 ? `graduated ×${b.graduationCount}` : undefined },
          { l: "Outstanding", v: kes(olb), s: `${loans.filter((l) => l.status === "ACTIVE").length} running of ${loans.length}` },
          { l: "In arrears", v: arrears > 0 ? kes(arrears) : "—", s: worstDpd > 0 ? `${worstDpd} days past due` : "nothing behind" },
        ].map((t) => (
          <div key={t.l} className="rounded-sm border border-ash-900/15 px-2.5 py-2">
            <p className="font-mono text-[8px] uppercase tracking-[0.14em] text-ash-500">{t.l}</p>
            <p className="text-[13px] font-bold leading-tight text-ash-900">{t.v}</p>
            {t.s && <p className="text-[9px] leading-tight text-ash-500">{t.s}</p>}
          </div>
        ))}
      </section>

      {st && (
        <table className="mt-3 w-full text-[11px] print-break">
          <thead>
            <tr className="border-y border-ash-900/20 text-ash-500">
              <th className="py-1 text-left font-mono text-[8px] uppercase tracking-[0.14em]">Loan</th>
              <th className="py-1 text-left font-mono text-[8px] uppercase tracking-[0.14em]">Taken</th>
              <th className="py-1 text-right font-mono text-[8px] uppercase tracking-[0.14em]">Principal</th>
              <th className="py-1 text-right font-mono text-[8px] uppercase tracking-[0.14em]">Balance</th>
              <th className="py-1 text-right font-mono text-[8px] uppercase tracking-[0.14em]">Arrears</th>
              <th className="py-1 text-right font-mono text-[8px] uppercase tracking-[0.14em]">Status</th>
            </tr>
          </thead>
          <tbody>
            {st.loans.map((l) => (
              <tr key={l.loanId} className="border-b border-ash-900/[0.08]">
                <td className="py-1">{l.product ?? "Loan"} <span className="text-ash-500">#{l.loanId}</span></td>
                <td className="py-1">{day(l.borrowDate)}</td>
                <td className="py-1 text-right tabular-nums">{kes(l.principal)}</td>
                <td className="py-1 text-right font-semibold tabular-nums">{kes(l.balance)}</td>
                <td className="py-1 text-right tabular-nums">{l.arrears > 0 ? `${kes(l.arrears)} · ${l.daysInArrears}d` : "—"}</td>
                <td className="py-1 text-right font-semibold">{(l.daysInArrears ?? 0) > 0 && l.status !== "CLEARED" ? "IN ARREARS" : l.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* ── 03 · THE EVIDENCE ──────────────────────────────────────────────── */}
      {file && (
        <>
          <SectionRule
            n="03"
            title={`Evidence register — ${file.weight} / 100 known`}
            note="Every scrutiny this ecosystem has obtained about this person, newest first, each with what it contributed."
          />
          <WeightRule file={file} accent={accent} />
          {file.evidence.length === 0 ? (
            <p className="mt-3 text-[12px] text-ash-600">
              Nothing has been obtained about this customer — not an identity check, not a statement, not a bureau file.
              Every decision made now is made on their word alone.
            </p>
          ) : (
            <ol className="mt-3 space-y-2.5">
              {file.evidence.map((e) => (
                <li key={e.id} className="rounded-sm border border-ash-900/15 p-2.5 print-break">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                    <p className="text-[12px] font-bold text-ash-900">
                      <span className="mr-2 font-mono text-[8px] uppercase tracking-[0.14em] text-ash-500">{KIND_LABEL[e.kind]}</span>
                      {e.title}
                    </p>
                    <p className="font-mono text-[9px] text-ash-500">{day(e.at)} · +{e.contributed}</p>
                  </div>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-ash-700">{e.headline}</p>
                  {e.facts.length > 0 && (
                    <dl className="mt-1.5 flex flex-wrap gap-x-5 gap-y-1 border-t border-ash-900/[0.08] pt-1.5">
                      {e.facts.map((f, i) => (
                        <div key={i}>
                          <dt className="font-mono text-[8px] uppercase tracking-[0.12em] text-ash-500">{f.label}</dt>
                          <dd className="text-[11px] font-semibold text-ash-900">{f.value}</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                  <p className="mt-1 font-mono text-[8px] uppercase tracking-[0.12em] text-ash-400">Source · {e.source}</p>
                </li>
              ))}
            </ol>
          )}

          {file.gaps.length > 0 && (
            <>
              <SectionRule n="04" title="Not obtained" note="What could be known about this customer and is not, priced by what each would add." />
              <ul className="mt-3 space-y-1.5">
                {file.gaps.map((g) => (
                  <li key={g.kind} className="flex items-start gap-3 border-b border-dashed border-ash-900/20 pb-1.5">
                    <span className="mt-0.5 font-mono text-[9px] font-bold text-ash-400">☐</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[12px] font-semibold text-ash-900">
                        {g.title} <span className="font-mono text-[9px] font-bold text-ash-500">worth +{g.worth}</span>
                      </p>
                      <p className="text-[11px] leading-relaxed text-ash-600">{g.why}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}

      {/* ── 05 · THE EXHIBITS ──────────────────────────────────────────────── */}
      <SectionRule
        n={file?.gaps.length ? "05" : "04"}
        title={`Exhibits — ${attachments.length} item${attachments.length === 1 ? "" : "s"}`}
        note={
          attachments.length > 0
            ? "Photographed by an officer standing in front of it, held in the lender's own system."
            : undefined
        }
      />
      {attachments.length === 0 ? (
        <p className="mt-3 text-[12px] text-ash-600">
          No photographs are held for this customer — no identity page, no premises, nothing standing as security.
        </p>
      ) : (
        <div className="mt-3 space-y-4">
          {identityShots.length > 0 && (
            <ExhibitPlate title="Identity documents" items={identityShots} accent={accent} />
          )}
          {fieldShots.length > 0 && <ExhibitPlate title="Field evidence" items={fieldShots} accent={accent} />}
        </div>
      )}

      <DocumentFooter
        lender={lender}
        by={issuedBy}
        reference={caseNo}
        note="Internal working document. It is composed at the moment of issue from the systems that own each piece of evidence, and is not a published record."
      />
    </DocumentSheet>
  );
}

/** How the file's weight was earned, class by class, on one ruled bar. */
function WeightRule({ file, accent }: { file: MasterFile; accent: string }) {
  const held = new Map<EvidenceKind, number>();
  for (const e of file.evidence) held.set(e.kind, Math.max(held.get(e.kind) ?? 0, e.contributed));
  const classes = Object.keys(EVIDENCE_CLASSES) as EvidenceKind[];
  return (
    <div className="mt-2.5 print-break">
      <div className="flex h-2.5 gap-px overflow-hidden rounded-sm bg-ash-900/[0.08]">
        {classes.map((k) => {
          const v = held.get(k) ?? 0;
          const of = EVIDENCE_CLASSES[k]?.max ?? 0;
          if (of === 0) return null;
          return (
            <div key={k} className="relative" style={{ width: `${of}%`, backgroundColor: "rgba(0,0,0,0.05)" }} title={`${KIND_LABEL[k]} — ${v} of ${of}`}>
              <div className="h-full" style={{ width: `${of ? (v / of) * 100 : 0}%`, backgroundColor: accent }} />
            </div>
          );
        })}
      </div>
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
        {classes.map((k) => {
          const of = EVIDENCE_CLASSES[k]?.max ?? 0;
          if (of === 0) return null;
          return (
            <span key={k} className="font-mono text-[8px] uppercase tracking-[0.1em] text-ash-500">
              {KIND_LABEL[k]} <span className="font-bold text-ash-700">{held.get(k) ?? 0}</span>/{of}
            </span>
          );
        })}
      </div>
    </div>
  );
}

/**
 * A plate of exhibits.
 *
 * Three across, each on its own rule with a caption underneath — the layout a
 * contact sheet has had since photographs were filed in envelopes, and the one
 * that survives being photocopied.
 */
function ExhibitPlate({ title, items, accent }: { title: string; items: LiveAttachment[]; accent: string }) {
  return (
    <section className="print-break">
      <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-ash-500">{title}</p>
      <div className="mt-1.5 grid grid-cols-3 gap-3">
        {items.map((a, i) => (
          <figure key={a.id} className="min-w-0">
            <div className="aspect-[4/3] w-full overflow-hidden rounded-sm border bg-ash-900/[0.04]" style={{ borderColor: accent }}>
              {a.kind === "image" ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={a.viewUrl} alt={a.label} className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center font-mono text-[9px] uppercase tracking-widest text-ash-400">
                  document
                </div>
              )}
            </div>
            <figcaption className="mt-1">
              <p className="font-mono text-[8px] uppercase tracking-[0.12em] text-ash-500">
                Exhibit {String(i + 1).padStart(2, "0")}
              </p>
              <p className="text-[10px] font-semibold leading-tight text-ash-900">{a.label}</p>
              <p className="text-[9px] leading-tight text-ash-500">
                {[a.description !== a.label ? a.description : null, day(a.capturedAt), a.where]
                  .filter(Boolean)
                  .join(" · ") || "—"}
              </p>
              {/* The link is live on screen and inert on paper, which is right:
                  the exhibit itself is printed above it. A plain anchor, not
                  next/link — the file lives in the lender's own Drive. */}
              <a
                href={a.downloadUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="no-print text-[9px] font-semibold hover:underline"
                style={{ color: accent }}
              >
                Download original
              </a>
            </figcaption>
          </figure>
        ))}
      </div>
    </section>
  );
}
