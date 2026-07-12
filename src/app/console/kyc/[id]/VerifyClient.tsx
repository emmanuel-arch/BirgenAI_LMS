"use client";

// The counter wizard, and the moment it pays off.
//
// A verification that ends in a green tick is the only moment in this product where
// a member of staff has unambiguously made a customer's life better — five minutes
// ago that person could not be given money, and now they can. It is worth a beat of
// theatre. The card celebrates by NAME, in the lender's own colours, and then gets
// out of the way on its own: five seconds, and the officer is back where they came
// from, with the queue one shorter.
//
// A verification that ends any other way gets no theatre and no timer. It stays on
// screen until a human decides what to do, because "face match needs review" is not
// something to be shown for five seconds and then swept away.
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  ArrowLeft, ShieldCheck, Check, UserCheck, AlertTriangle, Phone, IdCard, ArrowRight, Loader2,
} from "lucide-react";
import { VerifyFlow, type FlowOutcome, type KycPost } from "@/components/kyc/VerifyFlow";

type Borrower = {
  id: string;
  name: string;
  firstName: string;
  phone: string;
  nationalId: string | null;
  kycStatus: string;
};

const RETURN_AFTER_MS = 5_000;

export function VerifyClient({ borrower, returnTo, returnLabel }: {
  borrower: Borrower;
  returnTo: string;
  returnLabel: string;
}) {
  const router = useRouter();
  const [outcome, setOutcome] = useState<FlowOutcome | null>(null);
  const [attached, setAttached] = useState(true);

  const post: KycPost = useCallback(async (step, payload) => {
    const { sessionId, ...rest } = payload as { sessionId?: string };
    const res = await fetch("/api/console/kyc/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ borrowerId: borrower.id, step, sessionId, payload: rest }),
    });
    const data = await res.json();
    // The API tells us whether the borrower row actually moved. A tick over a
    // customer who is still blocked is the exact lie the old flow told.
    if (typeof data.attached === "boolean") setAttached(data.attached);
    return data;
  }, [borrower.id]);

  const verified = outcome?.status === "VERIFIED" && attached;

  return (
    <main className="mx-auto max-w-md px-4 py-8 sm:px-6">
      <Link href={returnTo} className="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-800">
        <ArrowLeft className="h-4 w-4" /> Back to {returnLabel}
      </Link>

      <div className="glass mt-3 p-5">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl" style={{ backgroundColor: "var(--brand-soft)" }}>
            <ShieldCheck className="h-5 w-5" style={{ color: "var(--brand)" }} />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-lg font-bold text-zinc-900">{borrower.name}</h1>
            <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-zinc-500">
              <span className="inline-flex items-center gap-1"><Phone className="h-3 w-3" /> {borrower.phone}</span>
              {borrower.nationalId && <span className="inline-flex items-center gap-1"><IdCard className="h-3 w-3" /> {borrower.nationalId}</span>}
            </p>
          </div>
        </div>
        <p className="mt-3 border-t border-zinc-900/10 pt-3 text-xs leading-relaxed text-zinc-500">
          The customer should be with you. You are vouching that the face in front of the camera is
          the person on this record — your name goes on that.
        </p>
      </div>

      {!outcome && (
        <div className="mt-5">
          <VerifyFlow post={post} onDone={setOutcome} />
        </div>
      )}

      {outcome && !verified && (
        <NotThroughCard outcome={outcome} borrower={borrower} attached={attached} returnTo={returnTo} />
      )}

      {verified && (
        <Verified
          firstName={borrower.firstName}
          name={borrower.name}
          returnTo={returnTo}
          returnLabel={returnLabel}
          onGo={() => { router.push(returnTo); router.refresh(); }}
        />
      )}
    </main>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// The celebration. Brand-coloured, animated, self-dismissing.
// ─────────────────────────────────────────────────────────────────────────────
function Verified({ firstName, name, returnTo, returnLabel, onGo }: {
  firstName: string;
  name: string;
  returnTo: string;
  returnLabel: string;
  onGo: () => void;
}) {
  const [left, setLeft] = useState(Math.round(RETURN_AFTER_MS / 1000));
  // onGo closes over the router; hold it in a ref so the timer is set up once and
  // isn't torn down and restarted on every re-render (which would never fire).
  const go = useRef(onGo);
  useEffect(() => { go.current = onGo; }, [onGo]);

  useEffect(() => {
    const tick = setInterval(() => setLeft((n) => Math.max(0, n - 1)), 1000);
    const done = setTimeout(() => go.current(), RETURN_AFTER_MS);
    return () => { clearInterval(tick); clearTimeout(done); };
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="fixed inset-0 z-40 flex items-center justify-center bg-zinc-900/25 p-4 backdrop-blur-sm"
      role="status"
      aria-live="polite"
    >
      <motion.div
        initial={{ opacity: 0, y: 16, scale: 0.94 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: "spring", stiffness: 260, damping: 22 }}
        className="glass w-full max-w-sm overflow-hidden rounded-3xl bg-white/80 p-7 text-center shadow-2xl"
      >
        {/* The tick, haloed in the lender's own colour. */}
        <div className="relative mx-auto h-24 w-24">
          {[0, 0.35, 0.7].map((delay) => (
            <motion.span
              key={delay}
              aria-hidden
              className="motion-safe:block hidden absolute inset-0 rounded-full"
              style={{ backgroundColor: "var(--brand)" }}
              initial={{ scale: 0.55, opacity: 0.35 }}
              animate={{ scale: 1.7, opacity: 0 }}
              transition={{ duration: 1.9, repeat: Infinity, delay, ease: "easeOut" }}
            />
          ))}
          <motion.div
            className="absolute inset-0 flex items-center justify-center rounded-full text-white shadow-lg"
            style={{ backgroundColor: "var(--brand)" }}
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: "spring", stiffness: 320, damping: 16, delay: 0.08 }}
          >
            <motion.span
              initial={{ scale: 0, rotate: -25 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ type: "spring", stiffness: 400, damping: 14, delay: 0.32 }}
            >
              <Check className="h-11 w-11" strokeWidth={3} />
            </motion.span>
          </motion.div>
        </div>

        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.45 }}>
          <p className="mt-6 text-[11px] font-bold uppercase tracking-[0.14em]" style={{ color: "var(--brand)" }}>
            Identity verified
          </p>
          <h2 className="mt-1.5 text-2xl font-bold leading-tight text-zinc-900">
            {firstName} is verified
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-zinc-600">
            <span className="font-semibold text-zinc-800">{name}</span> has passed every check.
            They can now be disbursed to.
          </p>
        </motion.div>

        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.8 }} className="mt-6">
          <button
            onClick={onGo}
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl px-5 py-3 text-sm font-semibold text-white"
            style={{ backgroundColor: "var(--brand)" }}
          >
            Back to {returnLabel} <ArrowRight className="h-4 w-4" />
          </button>
          <p className="mt-2.5 text-[11px] text-zinc-400">
            Taking you there in {left}s…
          </p>
        </motion.div>

        {/* The bar drains as the timer does — the wait is visible, not just felt. */}
        <div className="mt-3 h-1 overflow-hidden rounded-full bg-zinc-900/8">
          <motion.div
            className="h-full rounded-full"
            style={{ backgroundColor: "var(--brand)" }}
            initial={{ width: "100%" }}
            animate={{ width: "0%" }}
            transition={{ duration: RETURN_AFTER_MS / 1000, ease: "linear" }}
          />
        </div>
        <Link href={returnTo} className="sr-only">Back to {returnLabel}</Link>
      </motion.div>
    </motion.div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Everything that is not a clean pass. No timer, no confetti.
// ─────────────────────────────────────────────────────────────────────────────
const FLAG_TEXT: Record<string, string> = {
  "low-id-quality": "The ID photo wasn't clear enough to rely on.",
  "liveness-failed": "We couldn't confirm a live person was in front of the camera.",
  "face-mismatch": "The face didn't match the portrait on the ID.",
  "iprs-unmatched": "The national registry has no record of that ID number.",
};

function NotThroughCard({ outcome, borrower, attached, returnTo }: {
  outcome: FlowOutcome;
  borrower: Borrower;
  attached: boolean;
  returnTo: string;
}) {
  const review = outcome.status === "PENDING_REVIEW";
  const brokenAttach = outcome.status === "VERIFIED" && !attached;

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="glass mt-5 p-6 text-center">
      <div className={`mx-auto flex h-16 w-16 items-center justify-center rounded-full ${review ? "bg-amber-100" : "bg-rose-100"}`}>
        {review ? <UserCheck className="h-8 w-8 text-amber-600" /> : <AlertTriangle className="h-8 w-8 text-rose-600" />}
      </div>

      <h2 className="mt-4 text-xl font-bold text-zinc-900">
        {brokenAttach ? "Checks passed — but the record didn't move"
          : review ? "Needs a second pair of eyes"
          : `${borrower.firstName} is not verified`}
      </h2>

      <p className="mt-2 text-sm leading-relaxed text-zinc-600">
        {brokenAttach
          ? "Every check passed, but the verification did not attach to this customer's record — so they are still blocked from disbursement. Don't tell them they're done. Report this."
          : review
          ? "The face match landed in the grey zone. A supervisor confirms it from the customer's profile — the customer does not need to come back."
          : "They stay on the verification queue and cannot be disbursed to. Nothing about them has been changed."}
      </p>

      {outcome.flags.length > 0 && (
        <ul className="mt-4 space-y-1.5 text-left">
          {outcome.flags.map((f) => (
            <li key={f} className="flex items-start gap-2 rounded-lg bg-zinc-900/[0.03] px-3 py-2 text-[13px] text-zinc-700">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-500" />
              {FLAG_TEXT[f] ?? f}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-5 flex flex-col gap-2 sm:flex-row">
        <Link
          href={`/console/kyc/${borrower.id}`}
          className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white"
          style={{ backgroundColor: "var(--brand)" }}
        >
          <Loader2 className="h-4 w-4" /> Try again
        </Link>
        <Link
          href={returnTo}
          className="inline-flex flex-1 items-center justify-center rounded-xl border border-zinc-900/12 bg-white/70 px-4 py-2.5 text-sm font-medium text-zinc-700 hover:bg-white"
        >
          Leave it for now
        </Link>
      </div>
    </motion.div>
  );
}
