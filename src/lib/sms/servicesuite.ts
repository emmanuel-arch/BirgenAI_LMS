// ─────────────────────────────────────────────────────────────────────────────
// SMS THROUGH THE LENDER'S OWN SERVICESUITE OUTBOX.
//
// ── THE PROBLEM THIS SOLVES ─────────────────────────────────────────────────
// A borrower on portal.servicesuitecloud.com asks for a code and gets
// `delivered: false`, because providerFor() finds nothing: Micromart have no
// SMS config in our vault, and the platform Africa's Talking key is unset.
//
// Setting the platform key would make codes arrive — under OUR sender ID. That
// is the wrong fix. A verification code that arrives from a name the customer
// has never dealt with is indistinguishable from a phishing attempt, and it
// trains people to trust exactly the message they should not.
//
// ── HOW MICROMART'S OWN SYSTEM DOES IT ──────────────────────────────────────
// It never talks to Africa's Talking from application code. Every message is a
// ROW in `Notifications.dbo.SMS`, and a drainer empties the queue — verified
// live on 10 Sep 2026, where payment confirmations were going from written to
// `isSent = 1` inside a minute.
//
// Nothing writes that row by hand. Application code and triggers alike call
//
//     EXEC [Notifications].dbo.[sp_InsertsmsAndEmails] @receiver, @body, @entityId
//
// which is what `RepaymentTrigger` on `INCOMINGC2B` calls after allocating a
// repayment. The SENDER ID IS A PROPERTY OF THE ENTITY — the drainer looks up
// the entity's Africa's Talking credentials and sends under the sender id
// registered to them. So the way to make a message arrive as "MICROMART" is not
// to configure a sender anywhere in this codebase. It is to hand their own
// procedure the right EntityId and let their pipeline do what it already does
// for every other message they send.
//
// This module does exactly that and nothing else.
//
// ── TWO THINGS IT DELIBERATELY DOES NOT DO ──────────────────────────────────
// It does not create the SMS row in OUR database — send.ts already did that,
// and this is only the dispatch leg. And it does not mark the message SENT on
// its own authority: a row in a queue is not a delivered message. The state it
// reports is "the lender's outbox accepted it", which is the same guarantee
// ServiceSuite's own console gives its operators.
//
// ── WHAT IT NEEDS FROM THE DEPLOYMENT ───────────────────────────────────────
// A WRITE. Micromart's SQL has no public route, so this goes over the relay,
// and the relay refuses writes unless SQL_RELAY_ALLOW_WRITES=true is set ON THE
// RELAY HOST. Until that is armed, available() answers false and send.ts falls
// through to the next provider rather than pretending. That is not a bug to
// work around: an unarmed relay is a deployment that has not yet been given
// permission to write to a lender's live database.
// ─────────────────────────────────────────────────────────────────────────────
import mssql from "mssql";
import { resolveOrgById } from "@/lib/tenancy";
import { callStoredProc, writePathState } from "@/lib/enterprise/mssql";

/**
 * THE ENTRY POINT THEIR OWN DATABASE USES.
 *
 * This module used to hand-write the INSERT that `sp_restBorrowerPin` performs,
 * including a hardcoded `SmsProviderId = 5`. That was copied from one procedure
 * and is not what the rest of the system does. `RepaymentTrigger` — the trigger
 * on `INCOMINGC2B` that fires on every repayment Micromart takes — sends its
 * confirmation like this:
 *
 *     EXEC [Notifications].dbo.[sp_InsertsmsAndEmails] @Phone, @sms, @EntityId
 *
 * and that procedure does two things the hand-written INSERT did not:
 *
 *   · It resolves the provider PER ENTITY, from
 *     `Serviceconnect.dbo.BsEntity.SmsProviderId`, defaulting to 1. Hardcoding 5
 *     is right for Micromart today and silently wrong for the next entity whose
 *     book is bridged — and wrong in the way that is hardest to see, because the
 *     row is written, looks correct, and is drained by the wrong sender.
 *   · It stamps `CreatedBy = 101`, which is the marker their operators use to
 *     tell system-generated traffic from a console blast.
 *
 * Calling their procedure rather than reproducing its body also means a change
 * they make to it — a new provider, a suppression rule, a units check — applies
 * to our messages the same day it applies to theirs. Reproducing the INSERT
 * opts us out of every future fix.
 */
const OUTBOX_PROC = "Notifications.dbo.sp_InsertsmsAndEmails";

export type ServiceSuiteSmsTarget = {
  /** The registry entry carrying the connection string. */
  org: NonNullable<Awaited<ReturnType<typeof resolveOrgById>>>["registry"];
  /** Which book the message belongs to. Decides the sender id at the far end. */
  entityId: number;
  /** Our own org id — the cache key, so a failed write can invalidate it. */
  orgId: string;
  /** For logs and errors. */
  name: string;
};

/**
 * Is this org's own outbox reachable AND writable right now?
 *
 * Memoised for a minute. hasSmsProvider() is called on every OTP request, and
 * without this each one would cost a relay round-trip just to ask a question
 * whose answer changes when somebody restarts a service — not per request.
 */
const armedCache = new Map<string, { at: number; value: ServiceSuiteSmsTarget | null }>();
const ARMED_TTL_MS = 60_000;

export async function serviceSuiteOutbox(orgId: string): Promise<ServiceSuiteSmsTarget | null> {
  const hit = armedCache.get(orgId);
  if (hit && Date.now() - hit.at < ARMED_TTL_MS) return hit.value;

  const value = await resolve(orgId);
  armedCache.set(orgId, { at: Date.now(), value });
  return value;
}

async function resolve(orgId: string): Promise<ServiceSuiteSmsTarget | null> {
  try {
    const org = await resolveOrgById(orgId);
    // NATIVE lenders keep their book in our Postgres and have no ServiceSuite
    // outbox to write to. Nothing to do here for them, and that is not a fault.
    if (!org || org.mode !== "BRIDGED" || !org.registry || !org.bridgedReady) return null;
    // Entity 0 means nobody ever set one. Writing a row stamped 0 would put the
    // message in no book at all, which is worse than not sending it.
    if (!Number.isInteger(org.entityId) || org.entityId <= 0) return null;

    // ── WHAT COUNTS AS "REACHABLE" HERE ─────────────────────────────────────
    // `armed` is the general write posture. It is not the only way this one
    // call can go through: a read-only relay carrying an ALLOWLIST will run a
    // named procedure while still refusing arbitrary SQL, and the outbox
    // procedure is exactly what such a list is for.
    //
    // Requiring `armed === true` meant a correctly-configured narrow door
    // reported as no door at all — hasSmsProvider() answered false, the OTP
    // route told the customer "We couldn't send the code right now", and the
    // procedure that would have sent it was never called.
    const write = await writePathState(org.registry);
    if (write.armed !== true && write.allowedProcs === 0) return null;

    return { org: org.registry, entityId: org.entityId, orgId, name: org.name };
  } catch {
    return null;
  }
}

/**
 * Queue one message in the lender's own outbox.
 *
 * Returns the same shape the Africa's Talking sender returns, so dispatchRow
 * can treat the two identically. `providerRef` is null on purpose: the row id
 * is assigned by an IDENTITY column we do not read back, and inventing a
 * reference that cannot be looked up later is worse than admitting there is none.
 */
export async function sendViaServiceSuite(
  target: ServiceSuiteSmsTarget,
  phone: string,
  message: string,
): Promise<{ ok: boolean; providerRef: string | null; cost: number | null; error: string | null }> {
  if (!target.org) return { ok: false, providerRef: null, cost: null, error: "No ServiceSuite registry entry" };
  try {
    await callStoredProc(
      target.org,
      OUTBOX_PROC,
      [
        // ServiceSuite stores MSISDNs bare — 254XXXXXXXXX, no plus. normalizeMsisdn
        // upstream already produces that shape; this strips a leading + defensively
        // because one wrong character here means the message goes nowhere and
        // nothing reports it.
        //
        // The parameter is varchar(50) on their side and `smsto` is varchar(20).
        // A 12-digit MSISDN fits both with room to spare, but the narrowness is
        // worth remembering: an overflow here aborts the whole transaction with
        // no partial state and no log line.
        { name: "receiver", type: mssql.VarChar(50), value: phone.replace(/^\+/, "") },
        // An explicit length, not VarChar(MAX): the relay's type codec carries
        // `length` as a plain number, and MAX is a sentinel that has to survive
        // an encode/decode round trip to mean the same thing on the far side.
        // An SMS is a few hundred characters; 2000 is generous and unambiguous,
        // and `smsMessage` is varchar(max) at the far end so nothing truncates.
        { name: "bodyMessage", type: mssql.VarChar(2000), value: message },
        // Which book. This is the whole reason the message arrives as MICROMART:
        // the procedure reads the entity's provider, and the drainer reads the
        // entity's registered sender id.
        { name: "companyid", type: mssql.Int, value: target.entityId },
      ],
      { timeoutMs: 20000 },
    );
    return { ok: true, providerRef: null, cost: null, error: null };
  } catch (e) {
    // A refused write is the common case while the relay is read-only, and it
    // must read as such rather than as "the lender's server is down".
    const msg = e instanceof Error ? e.message : String(e);
    armedCache.delete(target.orgId);
    return { ok: false, providerRef: null, cost: null, error: `ServiceSuite outbox: ${msg}` };
  }
}
