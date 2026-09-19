// ─────────────────────────────────────────────────────────────────────────────
// TIME readPosition() ITSELF — the real function the Home screen waits on.
//
//   npx tsx scripts/time-position.ts --phone 254758517032 --repeat 4
//
// scripts/time-home.ts breaks the aggregate into its parts and is the right tool
// for finding WHERE the time goes. This one calls the actual function, so it
// measures what a customer actually waits for — including every ordering change
// made to it. A reconstruction that gets faster while the real path does not is
// the classic way to optimise nothing.
//
// Read-only. It constructs the same proven session the route would have after a
// sign-in, and asks for the same position.
// ─────────────────────────────────────────────────────────────────────────────
import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { runAsPlatform } from "../src/lib/db/context";
import { resolveOrg } from "../src/lib/tenancy";
import { readPosition } from "../src/lib/portal/position";
import type { BorrowerSession } from "../src/lib/portal/session";

const arg = (n: string, d: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : d;
};
const tone = (ms: number) => (ms > 3000 ? "\x1b[31m" : ms > 1500 ? "\x1b[33m" : "\x1b[32m");

async function main() {
  const slug = arg("org", "micromart");
  const phone = arg("phone", "254758517032").replace(/\D/g, "");
  const repeat = Math.max(1, Number(arg("repeat", "4")));

  console.log(`\n\x1b[1mreadPosition — ${slug} · ${phone}\x1b[0m`);
  console.log(`\x1b[2mread-only. Pass 1 is cold (pools, caches); later passes are what a warm lambda does.\x1b[0m\n`);

  const times: number[] = [];
  await runAsPlatform(async () => {
    const org = await resolveOrg(slug);
    if (!org) throw new Error(`No org "${slug}".`);

    const borrower = await prisma.borrower.findFirst({
      where: { orgId: org.id, phone: { endsWith: phone.slice(-9) } },
      select: { nationalId: true, serviceSuiteBorrowerId: true },
      orderBy: { createdAt: "desc" },
    });

    // The shape borrowerFor() hands the route after a code or password sign-in.
    const session = {
      phone,
      orgId: org.id,
      ssBorrowerId: borrower?.serviceSuiteBorrowerId ?? null,
      ssEntityId: org.entityId,
      ssToken: null,
    } as unknown as BorrowerSession;

    for (let n = 1; n <= repeat; n++) {
      const t = Date.now();
      const pos = await readPosition(org, session, borrower?.nationalId ?? null);
      const ms = Date.now() - t;
      times.push(ms);
      console.log(
        `  pass ${n}  ${tone(ms)}${String(ms).padStart(6)} ms\x1b[0m   ` +
          `book=${pos.bookSource}  limit=${Math.round(pos.limit).toLocaleString()}  ` +
          `owed=${Math.round(pos.outstanding).toLocaleString()}  score=${pos.score ?? "—"}  ` +
          `savings=${pos.savings ? Math.round(pos.savings.balance).toLocaleString() : "—"}`,
      );
    }
  });

  const warm = times.slice(1);
  const best = Math.min(...(warm.length ? warm : times));
  console.log(
    `\n  cold ${tone(times[0])}${times[0]} ms\x1b[0m · warm best ${tone(best)}${best} ms` +
      `\x1b[0m · target \x1b[1m3000 ms\x1b[0m ${best <= 3000 ? "\x1b[32mMET\x1b[0m" : "\x1b[31mNOT MET\x1b[0m"}\n`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("\n\x1b[31m" + (e instanceof Error ? e.message : String(e)) + "\x1b[0m\n");
    process.exit(1);
  });
