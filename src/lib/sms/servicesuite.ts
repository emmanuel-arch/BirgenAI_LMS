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
// ROW, and something else drains the queue:
//
//     insert into Notifications.dbo.SMS
//       (smsMessage, smsto, EntityId, CreateDate, isSent, ScheduleDate, SmsProviderId)
//     values (@sms, @Phone, @entityId, GETDATE(), 0, GETDATE(), 5)
//
// That is `sp_restBorrowerPin`, verbatim. The SENDER ID IS A PROPERTY OF THE
// ENTITY — the drainer looks up the entity's Africa's Talking credentials and
// sends under the sender id registered to them. So the way to make a message
// arrive as "MICROMART" is not to configure a sender anywhere in this codebase.
// It is to write the row with the right EntityId and let their own pipeline do
// what it already does for every other message they send.
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
import { execNonQuery, writePathState } from "@/lib/enterprise/mssql";

/** ServiceSuite's own provider id for Africa's Talking. Read from sp_restBorrowerPin. */
const SMS_PROVIDER_ID = 5;

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

    const write = await writePathState(org.registry);
    if (write.armed !== true) return null;

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
    await execNonQuery(
      target.org,
      `INSERT INTO Notifications.dbo.SMS
         (smsMessage, smsto, EntityId, CreateDate, isSent, ScheduleDate, SmsProviderId)
       VALUES (@msg, @to, @entity, GETDATE(), 0, GETDATE(), @provider)`,
      [
        // An explicit length, not VarChar(MAX): the relay's type codec carries
        // `length` as a plain number, and MAX is a sentinel that has to survive
        // an encode/decode round trip to mean the same thing on the far side.
        // An SMS is a few hundred characters; 2000 is generous and unambiguous.
        { name: "msg", type: mssql.VarChar(2000), value: message },
        // ServiceSuite stores MSISDNs bare — 254XXXXXXXXX, no plus. normalizeMsisdn
        // upstream already produces that shape; this strips a leading + defensively
        // because one wrong character here means the message goes nowhere and
        // nothing reports it.
        { name: "to", type: mssql.VarChar(15), value: phone.replace(/^\+/, "") },
        { name: "entity", type: mssql.Int, value: target.entityId },
        { name: "provider", type: mssql.Int, value: SMS_PROVIDER_ID },
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
