// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS — the same report, in whichever shape the reader's next step needs.
//
// A report that can only be looked at is half a report. The manager's next move
// is always one of four things and each one wants a different file:
//
//   EXCEL  they are going to re-cut it themselves. Typed columns, real number
//          formats, a frozen header and a totals row — a sheet you can pivot,
//          not a grid of strings that needs cleaning first.
//   CSV    it is going into another system.
//   PDF    it is going to a board pack, a regulator or a printer, and must look
//          the same everywhere and be impossible to edit by accident.
//   PNG    it is going into a slide. Charts only, and produced in the browser
//          from the SVG that is already on screen — see ExportMenu.
//
// ── THE HEADER BLOCK IS NOT DECORATION ───────────────────────────────────────
// Every export opens with the same six lines: lender, book, report, period, when
// it was run, and how many rows. A spreadsheet with no provenance is a rumour —
// somebody opens it in March and cannot tell which entity it covers or whether
// it predates a correction. The book line is there because Micromart has two and
// the numbers differ by three orders of magnitude.
//
// Where our figure deliberately differs from the ServiceSuite report of the same
// name, that sentence is in the header too. A reader comparing the two should
// find the explanation in the file, not have to ask for it.
// ─────────────────────────────────────────────────────────────────────────────
import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import type { ReportResult } from "./types";
import { reportTitle, isoDate } from "./naming";

const NUM_FMT: Record<string, string> = {
  money: "#,##0.00",
  count: "#,##0",
  percent: "0.0\\%",
  days: "#,##0",
  date: "yyyy-mm-dd",
  text: "@",
};

function headerLines(r: ReportResult, org: string): string[] {
  const books = r.books.map((b) => `${b.label} (entity ${b.id})`).join(" + ");
  const period = r.def.ranged
    ? `${isoDate(r.params.from)} to ${isoDate(r.params.to)}`
    : `position as at ${isoDate(new Date())}`;
  const lines = [
    `Lender: ${org}`,
    `Book: ${books}`,
    `Report: ${r.def.name}`,
    `Period: ${period}`,
    `Generated: ${new Date().toISOString().replace("T", " ").slice(0, 16)}`,
    `Rows: ${r.rows.length}${r.truncated ? " (capped — narrow the filters for the full set)" : ""}`,
  ];
  if (r.def.mirrors) lines.push(`ServiceSuite equivalent: ${r.def.mirrors}`);
  if (r.def.divergence) lines.push(`Note: ${r.def.divergence}`);
  return lines;
}

const cellValue = (v: unknown, format: string): string | number | Date | null => {
  if (v == null) return null;
  if (format === "date") {
    const d = v instanceof Date ? v : new Date(String(v));
    return Number.isNaN(d.getTime()) ? String(v) : d;
  }
  if (format === "text") return String(v);
  const n = Number(v);
  return Number.isFinite(n) ? n : String(v);
};

// ── CSV ──────────────────────────────────────────────────────────────────────

/** RFC-4180 quoting: a customer called O'Brien, Ltd must not become two columns. */
const csvCell = (v: unknown): string => {
  if (v == null) return "";
  const s = v instanceof Date ? isoDate(v) : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCsv(r: ReportResult, org: string): string {
  const cols = r.def.columns;
  const out: string[] = [];
  // Commented provenance, so a spreadsheet opens on the data but the context
  // survives a round trip through another system.
  for (const line of headerLines(r, org)) out.push(`# ${csvCell(line)}`);
  out.push("");
  out.push(cols.map((c) => csvCell(c.label)).join(","));
  for (const row of r.rows) out.push(cols.map((c) => csvCell(row[c.key])).join(","));
  return out.join("\r\n");
}

// ── EXCEL ────────────────────────────────────────────────────────────────────

export async function toExcel(r: ReportResult, org: string): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Micro Eazy — Analytics & Reporting";
  wb.created = new Date();
  const ws = wb.addWorksheet(r.def.name.slice(0, 28) || "Report", {
    views: [{ state: "frozen", ySplit: headerLines(r, org).length + 2 }],
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });

  for (const line of headerLines(r, org)) {
    const row = ws.addRow([line]);
    row.font = { size: 9, color: { argb: "FF5B5B66" } };
  }
  ws.addRow([]);

  const cols = r.def.columns;
  const head = ws.addRow(cols.map((c) => c.label));
  head.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 10 };
  head.alignment = { vertical: "middle" };
  head.height = 20;
  head.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF15141B" } };
    cell.border = { bottom: { style: "thin", color: { argb: "FF15141B" } } };
  });

  for (const row of r.rows) {
    const added = ws.addRow(cols.map((c) => cellValue(row[c.key], c.format)));
    added.eachCell((cell, i) => {
      const c = cols[i - 1];
      if (!c) return;
      cell.numFmt = NUM_FMT[c.format] ?? "@";
      if (c.format !== "text" && c.format !== "date") cell.alignment = { horizontal: "right" };
    });
  }

  // A totals row on additive columns only. Summing a ratio is meaningless, so
  // percent columns are left blank rather than filled with a plausible lie.
  if (r.rows.length && cols.some((c) => c.total)) {
    const totals = cols.map((c, i) => {
      if (i === 0) return "TOTAL";
      if (!c.total) return null;
      return r.rows.reduce((s, row) => s + (Number(row[c.key]) || 0), 0);
    });
    const row = ws.addRow(totals);
    row.font = { bold: true };
    row.eachCell((cell, i) => {
      const c = cols[i - 1];
      cell.border = { top: { style: "double", color: { argb: "FF15141B" } } };
      if (c && c.total) cell.numFmt = NUM_FMT[c.format] ?? "#,##0";
    });
  }

  cols.forEach((c, i) => {
    const width = c.format === "text" ? 26 : c.format === "date" ? 13 : 15;
    ws.getColumn(i + 1).width = Math.max(width, c.label.length + 3);
  });
  ws.autoFilter = {
    from: { row: headerLines(r, org).length + 2, column: 1 },
    to: { row: headerLines(r, org).length + 2, column: cols.length },
  };

  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ── PDF ──────────────────────────────────────────────────────────────────────

const fmtCell = (v: unknown, format: string): string => {
  if (v == null) return "—";
  if (format === "date") {
    const d = v instanceof Date ? v : new Date(String(v));
    return Number.isNaN(d.getTime()) ? String(v) : isoDate(d);
  }
  if (format === "text") return String(v);
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  if (format === "percent") return `${n.toFixed(1)}%`;
  if (format === "money") return n.toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return n.toLocaleString("en-KE");
};

/**
 * A landscape table that paginates and repeats its header.
 *
 * Only the PRIMARY columns are drawn. A 22-column arrears report rendered onto
 * A4 gives every column 38 points and the customer's name breaks over four
 * lines — the reader gets a wall. Secondary columns stay in the Excel and CSV,
 * where horizontal space is free.
 */
export async function toPdf(r: ReportResult, org: string): Promise<Buffer> {
  const cols = r.def.columns.filter((c) => !c.secondary);
  // bufferPages, because the footer says "page 2 of 7" and the 7 is not known
  // until the last row is drawn. Without it switchToPage throws.
  const doc = new PDFDocument({ size: "A4", layout: "landscape", bufferPages: true, margins: { top: 36, bottom: 40, left: 32, right: 32 } });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));

  const left = doc.page.margins.left;
  const width = doc.page.width - left - doc.page.margins.right;

  // Column widths in proportion to what each format needs, normalised to the page.
  const weight = (f: string) => (f === "text" ? 2.1 : f === "date" ? 1.1 : f === "money" ? 1.35 : 0.9);
  const totalWeight = cols.reduce((s, c) => s + weight(c.format), 0);
  const widths = cols.map((c) => (weight(c.format) / totalWeight) * width);

  const drawHead = () => {
    doc.rect(left, doc.y, width, 18).fill("#15141b");
    let x = left;
    doc.fillColor("#ffffff").fontSize(7.5).font("Helvetica-Bold");
    const y = doc.y + 5.5;
    cols.forEach((c, i) => {
      doc.text(c.label, x + 4, y, { width: widths[i] - 8, align: c.format === "text" || c.format === "date" ? "left" : "right", lineBreak: false });
      x += widths[i];
    });
    doc.y += 18;
    doc.fillColor("#111827").font("Helvetica");
  };

  doc.fillColor("#111827").fontSize(15).font("Helvetica-Bold")
    .text(reportTitle(org, r.books.map((b) => b.label), r.def.name, r.def.ranged ? { from: r.params.from, to: r.params.to } : null), left, doc.y);
  doc.moveDown(0.3);
  doc.fontSize(7.5).font("Helvetica").fillColor("#5b5b66");
  for (const line of headerLines(r, org).slice(1)) doc.text(line, { width });
  doc.moveDown(0.6);
  doc.fillColor("#111827");

  drawHead();

  let zebra = false;
  for (const row of r.rows) {
    if (doc.y > doc.page.height - doc.page.margins.bottom - 24) {
      doc.addPage();
      drawHead();
      zebra = false;
    }
    const h = 13;
    if (zebra) doc.rect(left, doc.y, width, h).fill("#f6f6f4").fillColor("#111827");
    zebra = !zebra;
    let x = left;
    doc.fontSize(7).font("Helvetica").fillColor("#1f2937");
    const y = doc.y + 3.5;
    cols.forEach((c, i) => {
      doc.text(fmtCell(row[c.key], c.format), x + 4, y, {
        width: widths[i] - 8,
        align: c.format === "text" || c.format === "date" ? "left" : "right",
        lineBreak: false,
        ellipsis: true,
      });
      x += widths[i];
    });
    doc.y += h;
  }

  // Page numbers last, so the count is known. Buffered pages are already on.
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    doc.fontSize(7).fillColor("#8a8a95").text(
      `${org} · ${r.def.name} · page ${i - range.start + 1} of ${range.count} · generated by Micro Eazy Analytics & Reporting`,
      left,
      doc.page.height - 28,
      { width, align: "center", lineBreak: false },
    );
  }

  doc.end();
  return done;
}

export const CONTENT_TYPE = {
  csv: "text/csv; charset=utf-8",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pdf: "application/pdf",
} as const;
