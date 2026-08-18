// ─────────────────────────────────────────────────────────────────────────────
// THE TIMEZONE ASSERTION — because being three hours wrong looks like being right.
//
// SQL Server's `datetime` carries no timezone. ServiceSuite writes Nairobi wall-
// clock time into it; node-mssql is configured (`useUTC: false`, see
// connections.ts) to read it back using the PROCESS timezone. That is correct
// only while the process runs on Africa/Nairobi.
//
// If it does not — Vercel, most containers and most CI runners default to UTC —
// every datetime read from Micromart's server lands three hours out. And it does
// not look broken. It looks like this:
//
//   · "last payment −10,163s ago"        (the symptom that found this)
//   · payments made after 21:00 EAT counted into TOMORROW's takings
//   · a promise due today read as due yesterday, so the promise board
//     silently reports it broken
//   · every days-in-arrears figure off by one for a third of the day
//
// A wrong number that is only wrong sometimes is worse than a missing one, so
// this refuses to be quiet about it.
// ─────────────────────────────────────────────────────────────────────────────

/** Where every ServiceSuite and CollectBox datetime is expressed. */
export const SERVER_TZ = "Africa/Nairobi";

/** The process's current zone, as Node sees it. */
export function processTz(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC";
}

/**
 * Does the process agree with the database about what time it is?
 *
 * Compares OFFSETS rather than zone names: `Africa/Nairobi`, `Etc/GMT-3` and a
 * host simply set to +03:00 are all correct for this purpose, and demanding the
 * exact string would fail deployments that are in fact right.
 */
export function tzMatches(): boolean {
  const now = new Date();
  const local = -now.getTimezoneOffset(); // minutes east of UTC
  const nairobi = 180;
  return local === nairobi;
}

export type TzCheck = { ok: boolean; processTz: string; offsetMinutes: number; message: string };

export function checkTz(): TzCheck {
  const tz = processTz();
  const offsetMinutes = -new Date().getTimezoneOffset();
  const ok = offsetMinutes === 180;
  return {
    ok,
    processTz: tz,
    offsetMinutes,
    message: ok
      ? `Process is at UTC+${offsetMinutes / 60} (${tz}) — matches the ServiceSuite servers.`
      : `Process is at UTC${offsetMinutes >= 0 ? "+" : ""}${offsetMinutes / 60} (${tz}) but ServiceSuite datetimes are ${SERVER_TZ} (UTC+3). `
        + `Every timestamp read from Micromart's server will be ${(180 - offsetMinutes) / 60} hours out. Set TZ=${SERVER_TZ}.`,
  };
}

/**
 * Warn once per process. Called from the CollectBox client the first time it is
 * used, so a misconfigured deployment says so in the logs immediately rather
 * than on whatever screen first shows a date.
 */
let warned = false;
export function warnIfTzWrong(): void {
  if (warned) return;
  warned = true;
  const check = checkTz();
  if (!check.ok) console.warn(`[tz] ${check.message}`);
}
