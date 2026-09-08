"use client";

// ─────────────────────────────────────────────────────────────────────────────
// PRODUCTS — the shelf.
//
// This page used to be the shelf AND the wizard AND the template gallery, 525 lines
// of it, with product creation happening in a dialog on top of the list. That is the
// wrong shape for the most consequential object an admin configures: a dialog cannot
// be linked to, cannot be left and returned to, cannot show a quote beside the form,
// and tells the user by its very frame that this will take a moment when it takes an
// afternoon.
//
// So the shelf is now only a shelf. "New product" goes to /console/products/new, the
// pencil to /console/products/[id]/edit, and the card itself to the product's own
// page. What remains here is the job a list actually has: show what is on sale, what
// each one costs, what is riding on it, and which ones are switched off.
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLoad } from "@/lib/hooks/useLoad";
import {
  Loader2, AlertTriangle, CheckCircle2, Package, Plus, Pencil, Search,
  ChevronRight, Layers,
} from "lucide-react";
import { PRODUCT_TEMPLATES, templateBlanks } from "@/lib/products/templates";
import TemplateGallery from "@/components/products/TemplateGallery";
import { Toggle } from "@/components/settings/controls";

type Product = {
  id: string; name: string; description: string | null;
  minPrincipal: string | number; maxPrincipal: string | number;
  interestRate: string | number; interestMethod: string;
  repaymentPeriod: number; repaymentPeriodUnit: string;
  disbursementMode: string; isActive: boolean; version?: number;
  guarantorRequired: boolean; securityRequired: boolean;
};

const kes = (n: string | number) => `KES ${Math.round(Number(n)).toLocaleString()}`;

export default function ProductsPage() {
  const router = useRouter();
  const [products, setProducts] = useState<Product[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [picking, setPicking] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/console/products");
      const data = await res.json();
      if (!data.success) { setError(data.message || "Could not load products."); return; }
      setProducts(data.products);
      setError(null);
    } catch { setError("Could not load products."); }
  }, []);
  useLoad(load);

  const toggle = async (p: Product) => {
    setNotice(null);
    await fetch("/api/console/products", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: p.id, isActive: !p.isActive }),
    });
    setNotice(
      p.isActive
        ? `${p.name} is off the shelf. Loans already booked on it are unaffected.`
        : `${p.name} is back on the shelf.`,
    );
    await load();
  };

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle || !products) return products ?? [];
    return products.filter(
      (p) => p.name.toLowerCase().includes(needle) || (p.description ?? "").toLowerCase().includes(needle),
    );
  }, [products, q]);

  const live = products?.filter((p) => p.isActive).length ?? 0;

  return (
    <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="t-display flex items-center gap-2 text-[1.6rem]">
            <Package className="h-6 w-6" style={{ color: "var(--brand)" }} /> Products
          </h1>
          <p className="t-meta mt-1 max-w-2xl">
            Everything you sell, and the terms it sells on. Each product is versioned —
            changing a rate never rewrites what an existing borrower agreed to.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {products && (
            <span className="rounded-lg bg-[color:var(--ink)]/[0.05] px-2.5 py-1.5 text-[11px] font-semibold text-[color:var(--ink-muted)]">
              {live} on the shelf
            </span>
          )}
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[color:var(--ink-faint)]" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Find a product…"
              className="w-40 rounded-lg border border-[color:var(--ink)]/10 bg-paper/70 py-1.5 pl-8 pr-2.5 text-[12px] outline-none placeholder:text-[color:var(--ink-faint)] focus:border-transparent focus:ring-2 focus:ring-[color:var(--brand)] sm:w-52"
            />
          </div>
          <button
            type="button"
            onClick={() => setPicking(true)}
            className="inline-flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-[11px] font-bold text-white"
            style={{ backgroundColor: "var(--brand)" }}
          >
            <Plus className="h-3.5 w-3.5" /> New product
          </button>
        </div>
      </div>

      {notice && (
        <div className="mt-4 flex items-start gap-2 rounded-xl bg-emerald-500/10 px-3 py-2.5 text-sm text-emerald-800 ring-1 ring-emerald-600/20">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> {notice}
        </div>
      )}
      {error && (
        <div className="mt-4 flex items-start gap-2 rounded-xl bg-red-500/10 px-3 py-2.5 text-sm text-red-800 ring-1 ring-red-600/20">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
        </div>
      )}

      {!products && !error && (
        <div className="mt-10 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-[color:var(--ink-faint)]" /></div>
      )}

      {products?.length === 0 && (
        <div className="glass mt-8 px-4 py-10 text-center">
          <Layers className="mx-auto h-6 w-6 text-[color:var(--ink-faint)]" />
          <p className="mt-2 text-[14px] font-semibold text-[color:var(--ink)]">Nothing on the shelf yet</p>
          <p className="t-meta mx-auto mt-1 max-w-md text-[12.5px]">
            Start from one of the templates — a working product you then edit — or build
            one from nothing. Either way it takes eleven steps and you can leave halfway.
          </p>
          <button
            type="button"
            onClick={() => setPicking(true)}
            className="mt-4 inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-[12px] font-bold text-white"
            style={{ backgroundColor: "var(--brand)" }}
          >
            <Plus className="h-3.5 w-3.5" /> Create your first product
          </button>
        </div>
      )}

      <div className="mt-5 space-y-2.5">
        {shown.map((p) => (
          <div
            key={p.id}
            className="glass flex items-center justify-between gap-3 p-4"
            style={p.isActive ? undefined : { opacity: 0.6 }}
          >
            <Link href={`/console/products/${p.id}`} className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-1.5 text-[14px] font-semibold text-[color:var(--ink)]">
                {p.name}
                {p.guarantorRequired && (
                  <span className="rounded bg-amber-500/12 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-amber-700">Guarantor</span>
                )}
                {p.securityRequired && (
                  <span className="rounded bg-sky-500/12 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-sky-700">Secured</span>
                )}
              </p>
              <p className="t-meta mt-0.5 text-[11.5px]">
                {kes(p.minPrincipal)}–{kes(p.maxPrincipal)} · {Number(p.interestRate)}% {p.interestMethod} ·{" "}
                {p.repaymentPeriod} × {p.repaymentPeriodUnit} · {p.disbursementMode.replace(/_/g, " ").toLowerCase()}
              </p>
            </Link>

            <div className="flex shrink-0 items-center gap-2">
              <Link
                href={`/console/products/${p.id}`}
                className="rounded-md bg-[color:var(--ink)]/[0.05] px-2 py-1 text-[10px] font-bold text-[color:var(--ink-muted)] hover:text-[color:var(--ink)]"
              >
                {p.version && p.version > 0 ? `v${p.version}` : "UNVERSIONED"}
              </Link>
              <Link
                href={`/console/products/${p.id}/edit`}
                aria-label={`Edit ${p.name}`}
                className="rounded-md p-1.5 text-[color:var(--ink-faint)] ring-1 ring-[color:var(--ink)]/10 hover:text-[color:var(--ink)]"
              >
                <Pencil className="h-3.5 w-3.5" />
              </Link>
              <Toggle label={`${p.name} on the shelf`} checked={p.isActive} onChange={() => toggle(p)} />
              <ChevronRight className="h-4 w-4 text-[color:var(--ink-faint)]" />
            </div>
          </div>
        ))}
      </div>

      {picking && (
        <TemplateGallery
          templates={PRODUCT_TEMPLATES}
          blanksOf={templateBlanks}
          onClose={() => setPicking(false)}
          onPick={(def) => {
            setPicking(false);
            // A template is a starting definition, handed to the builder through
            // sessionStorage rather than a query string — a whole product document
            // does not belong in a URL, and the builder is the only reader.
            if (def) {
              try { sessionStorage.setItem("product-template", JSON.stringify(def)); }
              catch { /* private mode: the builder simply opens blank */ }
            } else {
              try { sessionStorage.removeItem("product-template"); } catch { /* ignore */ }
            }
            router.push("/console/products/new");
          }}
        />
      )}
    </main>
  );
}
