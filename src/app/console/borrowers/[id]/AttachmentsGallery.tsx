"use client";

// ─────────────────────────────────────────────────────────────────────────────
// THE CUSTOMER'S PAPERWORK.
//
// Micromart's officers photograph the business, the home, the thing standing as
// security, and both faces of the national ID. Those photographs are the field
// evidence every limit on this book rests on — and this console could not show a
// single one of them, while the lender's own twenty-year-old Borrower 360 has
// shown them for years. That is not a missing feature; it is the console asking
// an officer to underwrite blind.
//
// ── WHAT IS BETTER HERE THAN ON THEIR SCREEN ────────────────────────────────
// Theirs renders a fixed 250px tile with a "View" link that opens Drive in a new
// tab, which loses the customer you were reading. Here the image opens IN PLACE,
// zooms to 5×, and can be dragged around — because the thing an officer actually
// does with a photograph of a shopfront is look closely at the stock on the
// shelves, and with an ID, read a number that is 40 pixels wide on the tile.
//
// ── AND ONE THING THAT IS DELIBERATELY STRICTER ─────────────────────────────
// The IDENTITY documents do not render on page load. A national ID and a face
// are the most sensitive things this system touches, and an officer glancing at
// a loan balance has no business having them on screen behind them. Revealing
// them is one click, and the click is the thing that means something. Field
// evidence — a shopfront, a house — carries no such weight and is shown
// immediately, because hiding it would only teach people to click past the gate
// without reading it.
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Download, Eye, EyeOff, FileText, ImageOff, Lock, MapPin, Maximize2, Minus, Plus, X,
} from "lucide-react";
import type { LiveAttachment } from "@/lib/lms/servicesuite-attachments";

const day = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : null;

export function AttachmentsGallery({ attachments }: { attachments: LiveAttachment[] }) {
  const identity = attachments.filter((a) => a.group === "identity");
  const field = attachments.filter((a) => a.group === "field");
  const [revealed, setRevealed] = useState(false);
  const [open, setOpen] = useState<number | null>(null);

  // The lightbox walks the list an officer can actually see. Revealing identity
  // widens it; it must never contain a hidden document.
  const viewable = revealed ? attachments : field;

  if (attachments.length === 0) {
    return (
      <p className="t-meta">
        Nothing on file for this customer — no portrait, no identity document, and no field photograph. Every decision
        made now rests on what they have said about themselves.
      </p>
    );
  }

  return (
    <div className="space-y-5">
      {identity.length > 0 && (
        <section>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="flex items-center gap-1.5 text-[12px] font-semibold text-[color:var(--ink-body)]">
              <Lock className="h-3.5 w-3.5 text-[color:var(--ink-faint)]" />
              Identity · {identity.length} document{identity.length === 1 ? "" : "s"}
            </h3>
            <button
              onClick={() => setRevealed((v) => !v)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-ash-900/15 bg-paper/70 px-3 py-1.5 text-[11px] font-semibold text-[color:var(--ink-body)] hover:bg-paper"
            >
              {revealed ? <><EyeOff className="h-3.5 w-3.5" /> Hide</> : <><Eye className="h-3.5 w-3.5" /> Show documents</>}
            </button>
          </div>
          {revealed ? (
            <Grid
              items={identity}
              onOpen={(a) => setOpen(viewable.findIndex((x) => x.id === a.id))}
            />
          ) : (
            <p className="mt-2 text-[12px] text-[color:var(--ink-muted)]">
              The portrait and the national ID are held behind a click. Opening them is a deliberate act, and it is the
              act that gets recorded.
            </p>
          )}
        </section>
      )}

      {field.length > 0 && (
        <section>
          <h3 className="text-[12px] font-semibold text-[color:var(--ink-body)]">
            Field evidence · {field.length} photograph{field.length === 1 ? "" : "s"}
          </h3>
          <p className="mt-0.5 text-[11px] text-[color:var(--ink-faint)]">
            Captured by an officer standing in front of it, in the lender&rsquo;s own system.
          </p>
          <Grid items={field} onOpen={(a) => setOpen(viewable.findIndex((x) => x.id === a.id))} />
        </section>
      )}

      {open != null && viewable[open] && (
        // Keyed on the opening index so the lightbox is a FRESH component each
        // time it is opened — which is what makes "starts fitted, not wherever
        // the last photograph was zoomed to" a fact about mounting rather than a
        // reset effect chasing a prop.
        <Lightbox key={open} items={viewable} start={open} onClose={() => setOpen(null)} />
      )}
    </div>
  );
}

function Grid({ items, onOpen }: { items: LiveAttachment[]; onOpen: (a: LiveAttachment) => void }) {
  return (
    <div className="mt-2.5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {items.map((a) => (
        <figure key={a.id} className="min-w-0 overflow-hidden rounded-xl border border-ash-900/10 bg-paper/60">
          <button
            onClick={() => onOpen(a)}
            className="group relative block aspect-[4/3] w-full overflow-hidden bg-ash-900/[0.04]"
            title={`Open ${a.label}`}
          >
            {a.kind === "image" ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={a.thumbUrl}
                alt={a.label}
                loading="lazy"
                className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
              />
            ) : (
              <span className="flex h-full w-full flex-col items-center justify-center gap-1.5 text-[color:var(--ink-faint)]">
                <FileText className="h-7 w-7" />
                <span className="text-[10px]">Document</span>
              </span>
            )}
            <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-ash-900/0 opacity-0 transition-all group-hover:bg-ash-900/25 group-hover:opacity-100">
              <Maximize2 className="h-5 w-5 text-white drop-shadow" />
            </span>
          </button>
          <figcaption className="px-2.5 py-2">
            <p className="truncate text-[12px] font-semibold text-[color:var(--ink)]" title={a.label}>{a.label}</p>
            {a.description && a.description !== a.label && (
              <p className="truncate text-[11px] text-[color:var(--ink-muted)]" title={a.description}>{a.description}</p>
            )}
            <div className="mt-1 flex items-center justify-between gap-2">
              <span className="min-w-0 truncate text-[10px] text-[color:var(--ink-faint)]">
                {day(a.capturedAt) ?? "—"}
                {a.where ? ` · ${a.where}` : ""}
              </span>
              <a
                href={a.downloadUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="shrink-0 rounded p-1 text-[color:var(--ink-faint)] hover:bg-ash-900/[0.06] hover:text-[color:var(--ink-body)]"
                title={`Download ${a.label}`}
              >
                <Download className="h-3.5 w-3.5" />
              </a>
            </div>
          </figcaption>
        </figure>
      ))}
    </div>
  );
}

/**
 * The reading surface.
 *
 * Zoom is the whole reason this exists — an ID number on a 4:3 tile is unreadable
 * and the shelves in a shopfront photograph are the affordability evidence. Wheel
 * or the buttons zoom; dragging pans once zoomed; Escape closes; the arrows walk
 * the set without going back to the grid.
 */
function Lightbox({
  items,
  start,
  onClose,
}: {
  items: LiveAttachment[];
  start: number;
  onClose: () => void;
}) {
  const [index, setIndex] = useState(start);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const [broken, setBroken] = useState(false);
  const item = items[index];

  // Every move through the set goes through here, so a new image ALWAYS starts
  // fitted. Carrying the previous one's zoom across would put an officer inside
  // a corner of a photograph they have not seen yet — and doing the reset in an
  // effect chasing `index` would be a cascading render for a fact we already
  // know at the moment we change it.
  const go = useCallback((i: number) => {
    setIndex(i);
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setBroken(false);
  }, []);

  const step = useCallback((delta: number) => {
    setZoom((z) => {
      const next = Math.min(5, Math.max(1, +(z + delta).toFixed(2)));
      if (next === 1) setPan({ x: 0, y: 0 });
      return next;
    });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") go((index + 1) % items.length);
      else if (e.key === "ArrowLeft") go((index - 1 + items.length) % items.length);
      else if (e.key === "+" || e.key === "=") step(0.5);
      else if (e.key === "-") step(-0.5);
    };
    window.addEventListener("keydown", onKey);
    // The page behind must not scroll while a document is open on top of it.
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [go, index, items.length, onClose, step]);

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-ash-950/90 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={item.label}
      onClick={onClose}
    >
      {/* Chrome */}
      <div className="flex items-start justify-between gap-3 p-3 sm:p-4" onClick={(e) => e.stopPropagation()}>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-white">{item.label}</p>
          <p className="truncate text-[11px] text-white/60">
            {item.description ?? ""}
            {item.description && (item.capturedAt || item.where) ? " · " : ""}
            {day(item.capturedAt) ?? ""}
            {item.where ? ` · ${item.where}` : ""}
            {items.length > 1 ? ` · ${index + 1} of ${items.length}` : ""}
          </p>
          {item.lat != null && item.lng != null && (
            <a
              href={`https://www.google.com/maps?q=${item.lat},${item.lng}`}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-0.5 inline-flex items-center gap-1 text-[11px] font-semibold text-white/70 hover:text-white"
            >
              <MapPin className="h-3 w-3" /> {item.lat.toFixed(5)}, {item.lng.toFixed(5)}
            </a>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button onClick={() => step(-0.5)} disabled={zoom <= 1} className="rounded-lg bg-white/10 p-2 text-white hover:bg-white/20 disabled:opacity-40" title="Zoom out">
            <Minus className="h-4 w-4" />
          </button>
          <span className="w-11 text-center text-[11px] font-semibold tabular-nums text-white/80">{Math.round(zoom * 100)}%</span>
          <button onClick={() => step(0.5)} disabled={zoom >= 5} className="rounded-lg bg-white/10 p-2 text-white hover:bg-white/20 disabled:opacity-40" title="Zoom in">
            <Plus className="h-4 w-4" />
          </button>
          <a href={item.downloadUrl} target="_blank" rel="noopener noreferrer" className="rounded-lg bg-white/10 p-2 text-white hover:bg-white/20" title="Download">
            <Download className="h-4 w-4" />
          </a>
          <button onClick={onClose} className="rounded-lg bg-white/10 p-2 text-white hover:bg-white/20" title="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* The document */}
      <div
        className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden p-3 sm:p-6"
        onClick={(e) => e.stopPropagation()}
        onWheel={(e) => step(e.deltaY < 0 ? 0.25 : -0.25)}
        onPointerDown={(e) => {
          if (zoom <= 1) return;
          drag.current = { x: e.clientX, y: e.clientY, ox: pan.x, oy: pan.y };
          setDragging(true);
          (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          setPan({ x: d.ox + (e.clientX - d.x), y: d.oy + (e.clientY - d.y) });
        }}
        onPointerUp={() => { drag.current = null; setDragging(false); }}
        onPointerCancel={() => { drag.current = null; setDragging(false); }}
        // The cursor is a rendered thing, so it reads STATE — the ref holds the
        // drag origin, which render has no business knowing about.
        style={{ cursor: zoom > 1 ? (dragging ? "grabbing" : "grab") : "default" }}
      >
        {broken || item.kind !== "image" ? (
          <div className="flex flex-col items-center gap-3 text-white/70">
            <ImageOff className="h-8 w-8" />
            <p className="max-w-[36ch] text-center text-[13px]">
              {item.kind === "image"
                ? "This file could not be opened here. It is held in the lender’s own Drive — the download still works."
                : "This attachment is not an image. Download it to read it."}
            </p>
            <a
              href={item.downloadUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg bg-white/15 px-3 py-2 text-[12px] font-semibold text-white hover:bg-white/25"
            >
              <Download className="h-3.5 w-3.5" /> Download {item.label}
            </a>
          </div>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={item.viewUrl}
            alt={item.label}
            onError={() => setBroken(true)}
            draggable={false}
            className="max-h-full max-w-full select-none object-contain transition-transform duration-100"
            style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}
          />
        )}

        {items.length > 1 && (
          <>
            <button
              onClick={() => go((index - 1 + items.length) % items.length)}
              className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-white/10 px-3 py-2 text-lg text-white hover:bg-white/20"
              aria-label="Previous"
            >
              ‹
            </button>
            <button
              onClick={() => go((index + 1) % items.length)}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-white/10 px-3 py-2 text-lg text-white hover:bg-white/20"
              aria-label="Next"
            >
              ›
            </button>
          </>
        )}
      </div>

      <p className="pb-3 text-center text-[11px] text-white/45" onClick={(e) => e.stopPropagation()}>
        Scroll to zoom · drag to move · ← → to walk the set · Esc to close
      </p>
    </div>
  );
}
