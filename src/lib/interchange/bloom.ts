// ─────────────────────────────────────────────────────────────────────────────
// Bloom filter over subject tokens — node side.
//
// ⚠ WIRE FORMAT. Port of the Registry's `lib/bloom.ts`. The bit layout is a
// format between members, so the hashing, the Kirsch–Mitzenmacher stride and the
// byte order must match exactly. A filter built one way and screened the other
// produces FALSE NEGATIVES — members who hold the borrower quietly never get
// asked — which is the one error class this structure is chosen to make
// impossible. If you change it, change both, and re-run verify:exposure.
//
// We only need `mightContain` here (the Registry builds filters on publication),
// but `build` and `sizeFor` are kept so a node can verify a filter it was handed
// against tokens it holds.
// ─────────────────────────────────────────────────────────────────────────────
import { createHash } from "node:crypto";

export type BloomParams = { m: number; k: number };

export function sizeFor(n: number, p = 0.01): BloomParams {
  const items = Math.max(1, n);
  const mBits = Math.ceil((-items * Math.log(p)) / Math.LN2 ** 2);
  const m = Math.ceil(mBits / 8) * 8;
  const k = Math.max(1, Math.round((m / items) * Math.LN2));
  return { m, k };
}

function positions(token: string, { m, k }: BloomParams): number[] {
  const d = createHash("sha256").update(token, "utf8").digest();
  const h1 = d.readUInt32BE(0);

  // `>>> 0` is load-bearing — see the Registry's lib/bloom.ts for the full
  // account. In short: `| 1` returns a SIGNED Int32, so half of all strides came
  // back negative, (h1 + i·h2) % m went negative, and bits[negative >>> 3] read
  // outside the array as undefined. The filter then reported NOT PRESENT for
  // tokens it contained — 42% of them — which screened real lenders out of the
  // fan-out and returned "no exposure" for borrowers who had some.
  const h2 = (d.readUInt32BE(4) | 1) >>> 0;

  const out: number[] = [];
  for (let i = 0; i < k; i++) {
    out.push(Number((BigInt(h1) + BigInt(i) * BigInt(h2)) % BigInt(m)));
  }
  return out;
}

export function build(tokens: string[], p = 0.01): { bits: Buffer; params: BloomParams; itemCount: number } {
  const params = sizeFor(tokens.length, p);
  const bits = Buffer.alloc(params.m / 8);
  for (const t of tokens) for (const pos of positions(t, params)) bits[pos >>> 3] |= 1 << (pos & 7);
  return { bits, params, itemCount: tokens.length };
}

export function mightContain(bits: Buffer | Uint8Array, params: BloomParams, token: string): boolean {
  for (const pos of positions(token, params)) {
    if ((bits[pos >>> 3] & (1 << (pos & 7))) === 0) return false;
  }
  return true;
}
