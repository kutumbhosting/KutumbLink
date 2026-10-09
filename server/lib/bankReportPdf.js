// server/lib/bankReportPdf.js
//
// Printable bank report (A4) for Admin → Bank → "Download PDF": the chosen
// period and/or event — summary, event money, monthly chart + table, money by
// category, and (optionally) every transaction. Built with pdfkit, which the
// app already uses for membership cards and tickets.

import PDFDocument from "pdfkit";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Reuse the public brand mark instead of carrying a duplicate under server/assets.
const LOGO = path.join(__dirname, "../../public/kutumb-logo.png");

const C = {
  brand: "#7c3f00",
  text: "#1f2937",
  muted: "#6b7280",
  line: "#e5e7eb",
  band: "#f9fafb",
  in: "#15803d",
  out: "#b91c1c",
  warn: "#c2410c",
};
const M = 40; // page margin

const money = (n) =>
  n === null || n === undefined || Number.isNaN(Number(n))
    ? "—"
    : Number(n).toLocaleString("en-AU", { style: "currency", currency: "AUD" });
const monthLabel = (m) => {
  const [y, mm] = m.split("-").map(Number);
  return new Date(Date.UTC(y, mm - 1, 1)).toLocaleDateString("en-AU", { month: "short", year: "numeric", timeZone: "UTC" });
};
const dmy = (iso) => (iso ? iso.split("-").reverse().join("/") : "");
const eventTitle = (name, year) => (name ? `${name}${year && !String(name).includes(year) ? ` ${year}` : ""}` : "");

export async function buildBankReportPdf({ summary, lines, filters, generatedBy }) {
  const doc = new PDFDocument({ size: "A4", margin: M, bufferPages: true, info: { Title: "Kutumb bank report", Author: "Kutumb Australia Inc" } });
  const chunks = [];
  doc.on("data", (c) => chunks.push(c));
  const done = new Promise((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));

  const W = doc.page.width - 2 * M;
  const bottom = () => doc.page.height - M - 20;
  const ensure = (h) => {
    if (doc.y + h > bottom()) doc.addPage();
  };
  // Keep a heading together with at least a table header and a couple of rows.
  const heading = (t) => {
    ensure(80);
    doc.moveDown(0.6).font("Helvetica-Bold").fontSize(13).fillColor(C.brand).text(t, M, doc.y);
    doc.moveTo(M, doc.y + 2).lineTo(M + W, doc.y + 2).strokeColor(C.line).lineWidth(1).stroke();
    doc.moveDown(0.5).fillColor(C.text);
  };

  /* ── Title block ── */
  const top = doc.y;
  if (fs.existsSync(LOGO)) {
    try {
      doc.image(LOGO, M + W - 150, top, { fit: [150, 50], align: "right" });
    } catch {
      /* ignore bad image */
    }
  }
  doc.font("Helvetica-Bold").fontSize(18).fillColor(C.brand).text("Kutumb Australia Inc", M, top + 2, { width: W - 160 });
  doc.font("Helvetica").fontSize(12).fillColor(C.text).text("Bank Report", M, doc.y + 1);
  doc.fontSize(9).fillColor(C.muted).text("NAB · BSB 082-356 · Account 778280517", M, doc.y + 2);
  doc.y = Math.max(doc.y, top + 56) + 4;

  const ev = filters.event === "__untagged" ? "Transactions not linked to an event" : filters.event ? eventTitle(...filters.event.split("|||")) : "All transactions";
  const period =
    filters.from || filters.to ? `${filters.from ? dmy(filters.from) : "Start"} – ${filters.to ? dmy(filters.to) : "today"}` : "All dates";
  const extra = [
    filters.type === "credit" ? "money in only" : filters.type === "debit" ? "money out only" : null,
    filters.q ? `search "${filters.q}"` : null,
  ].filter(Boolean);
  const generated = new Date().toLocaleString("en-AU", { timeZone: "Australia/Sydney", dateStyle: "medium", timeStyle: "short" });

  doc.rect(M, doc.y, W, 58).fill(C.band);
  const by = doc.y + 8;
  const kv = (k, v, x, y, w) => {
    doc.font("Helvetica").fontSize(8).fillColor(C.muted).text(k, x, y, { width: w });
    doc.font("Helvetica-Bold").fontSize(10).fillColor(C.text).text(v, x, y + 10, { width: w });
  };
  kv("Report for", ev, M + 10, by, W / 2 - 20);
  kv("Period", period + (extra.length ? ` (${extra.join(", ")})` : ""), M + W / 2, by, W / 2 - 10);
  doc.font("Helvetica").fontSize(8).fillColor(C.muted)
    .text(`Generated ${generated} (Sydney)${generatedBy ? ` by ${generatedBy}` : ""}${summary.lastSync?.at ? ` · bank data synced ${new Date(summary.lastSync.at).toLocaleString("en-AU", { timeZone: "Australia/Sydney", dateStyle: "medium", timeStyle: "short" })}` : ""}`, M + 10, by + 32, { width: W - 20 });
  doc.y = by + 58;

  /* ── Summary tiles ── */
  heading("Summary");
  const t = summary.totals;
  const tiles = [
    ["Money in", money(t.credits), `${t.creditCount} transaction(s)`, C.in],
    ["Money out", money(t.debits), `${t.debitCount} transaction(s)`, C.out],
    ["Net", money(t.net), "in minus out", t.net < 0 ? C.out : C.text],
    ["Current balance", money(summary.balance?.currentBalance), summary.balance ? "live from NAB" : "not available", C.text],
  ];
  const tw = (W - 3 * 8) / 4;
  const ty = doc.y;
  tiles.forEach(([label, value, sub, color], i) => {
    const x = M + i * (tw + 8);
    doc.roundedRect(x, ty, tw, 52, 4).strokeColor(C.line).lineWidth(1).stroke();
    doc.font("Helvetica").fontSize(8).fillColor(C.muted).text(label, x + 8, ty + 7, { width: tw - 16 });
    doc.font("Helvetica-Bold").fontSize(13).fillColor(color).text(value, x + 8, ty + 19, { width: tw - 16 });
    doc.font("Helvetica").fontSize(7).fillColor(C.muted).text(sub, x + 8, ty + 38, { width: tw - 16 });
  });
  doc.y = ty + 60;

  // Balance reconciliation (whole account; only when not filtered to an event).
  const pb = summary.periodBalances;
  if (pb && !filters.event && !filters.type && !filters.q) {
    const d = (x) => (x ? x.split("-").reverse().join("/") : "");
    doc.font("Helvetica").fontSize(9).fillColor(C.text).text(
      `Opening balance${pb.openingDate ? ` (${d(pb.openingDate)})` : ""} ${money(pb.opening)}  +  money in ${money(t.credits)}  -  money out ${money(t.debits)}  =  closing balance${pb.closingDate ? ` (${d(pb.closingDate)})` : " (today)"} ${money(pb.closing)}`,
      M, doc.y, { width: W }
    );
    doc.font("Helvetica").fontSize(7.5).fillColor(C.muted).text(
      "Net is the movement within the period only; balances are worked back from the live NAB balance using the transactions provided by openfeed" +
        (pb.startsBeforeData ? " (opening = balance before the earliest transaction held)" : "") + ". Pending transactions are not included.",
      M, doc.y + 2, { width: W }
    );
    doc.moveDown(0.5);
  }

  /* ── Event money ── */
  const es = summary.eventSummary;
  if (es) {
    heading(`Event: ${eventTitle(es.name, es.year)}`);
    const rows = [
      ["Registrations", `${es.registrations}${es.cancelled ? ` (plus ${es.cancelled} cancelled)` : ""}`],
      ["Registration fees due", money(es.fees_due)],
      ["Received (all payment methods)", money(es.received)],
      ["Outstanding", `${money(es.outstanding)}${es.pending ? ` — ${es.pending} registration(s) pending payment` : ""}`],
      ["Bank credits linked to event", money(t.credits)],
      ["Bank debits linked to event", money(t.debits)],
      ["Net in bank for event", money(es.net)],
    ];
    rows.forEach(([k, v], i) => {
      ensure(18);
      const y = doc.y;
      if (i % 2 === 0) doc.rect(M, y - 2, W, 16).fill(C.band);
      doc.font("Helvetica").fontSize(9).fillColor(C.text).text(k, M + 6, y, { width: W * 0.55 });
      const color = k === "Outstanding" && es.outstanding > 0 ? C.warn : k.startsWith("Net") && es.net < 0 ? C.out : C.text;
      doc.font("Helvetica-Bold").fillColor(color).text(v, M + W * 0.55, y, { width: W * 0.45 - 6, align: "right" });
      doc.y = y + 16;
    });
    doc.font("Helvetica").fontSize(7.5).fillColor(C.muted)
      .text("Bank credits/debits are those reconciled to this event's registrations or tagged to it in Admin → Bank. Money received by card/PayPal is included in 'Received' but not in bank credits until it settles.", M, doc.y + 4, { width: W });
  }

  /* ── Monthly chart ── */
  const months = summary.months || [];
  if (months.length) {
    heading("Monthly money in and out");
    const chartH = 150;
    ensure(chartH + 40);
    const cx = M + 50;
    const cy = doc.y + 6;
    const cw = W - 60;
    const max = Math.max(1, ...months.map((m) => Math.max(m.credits, m.debits)));
    const niceMax = (() => {
      const p = Math.pow(10, Math.floor(Math.log10(max)));
      return Math.ceil(max / p) * p;
    })();
    for (let i = 0; i <= 4; i++) {
      const y = cy + chartH - (chartH * i) / 4;
      doc.moveTo(cx, y).lineTo(cx + cw, y).strokeColor(C.line).lineWidth(0.5).stroke();
      doc.font("Helvetica").fontSize(7).fillColor(C.muted)
        .text(`$${Math.round((niceMax * i) / 4).toLocaleString("en-AU")}`, M, y - 4, { width: 46, align: "right" });
    }
    const slot = cw / months.length;
    const bw = Math.max(2, Math.min(18, slot / 2 - 3));
    months.forEach((m, i) => {
      const x = cx + i * slot + slot / 2 - bw - 1;
      const hIn = (m.credits / niceMax) * chartH;
      const hOut = (m.debits / niceMax) * chartH;
      doc.rect(x, cy + chartH - hIn, bw, hIn).fill(C.in);
      doc.rect(x + bw + 2, cy + chartH - hOut, bw, hOut).fill(C.out);
      if (months.length <= 18 || i % Math.ceil(months.length / 18) === 0) {
        doc.font("Helvetica").fontSize(6.5).fillColor(C.muted)
          .text(monthLabel(m.month), cx + i * slot, cy + chartH + 3, { width: slot, align: "center" });
      }
    });
    const ly = cy + chartH + 16;
    doc.rect(cx, ly, 8, 8).fill(C.in);
    doc.font("Helvetica").fontSize(8).fillColor(C.text).text("Money in", cx + 12, ly);
    doc.rect(cx + 70, ly, 8, 8).fill(C.out);
    doc.text("Money out", cx + 82, ly);
    doc.y = ly + 16;
  }

  /* ── Generic table helper ── */
  function table(cols, rows, { total } = {}) {
    const header = () => {
      ensure(40);
      const y = doc.y;
      doc.rect(M, y, W, 16).fill(C.brand);
      let x = M;
      cols.forEach((c) => {
        doc.font("Helvetica-Bold").fontSize(8).fillColor("#ffffff")
          .text(c.label, x + 4, y + 4, { width: c.w - 8, align: c.align || "left" });
        x += c.w;
      });
      doc.y = y + 18;
    };
    header();
    rows.forEach((r, i) => {
      doc.font("Helvetica").fontSize(8);
      const h = Math.max(...cols.map((c, j) => doc.heightOfString(String(r[j] ?? ""), { width: c.w - 8 }))) + 6;
      if (doc.y + h > bottom()) {
        doc.addPage();
        header();
      }
      const y = doc.y;
      if (i % 2 === 1) doc.rect(M, y - 1, W, h).fill(C.band);
      let x = M;
      cols.forEach((c, j) => {
        const v = r[j];
        doc.font(c.bold ? "Helvetica-Bold" : "Helvetica").fontSize(8)
          .fillColor(typeof c.color === "function" ? c.color(r) : c.color || C.text)
          .text(String(v ?? ""), x + 4, y + 2, { width: c.w - 8, align: c.align || "left" });
        x += c.w;
      });
      doc.y = y + h;
    });
    if (total) {
      ensure(18);
      const y = doc.y;
      doc.moveTo(M, y).lineTo(M + W, y).strokeColor(C.text).lineWidth(0.8).stroke();
      let x = M;
      cols.forEach((c, j) => {
        doc.font("Helvetica-Bold").fontSize(8).fillColor(C.text)
          .text(String(total[j] ?? ""), x + 4, y + 4, { width: c.w - 8, align: c.align || "left" });
        x += c.w;
      });
      doc.y = y + 18;
    }
  }

  /* ── Monthly table ── */
  if (months.length) {
    heading("By month");
    table(
      [
        { label: "Month", w: W * 0.28 },
        { label: "Money in", w: W * 0.24, align: "right", color: C.in },
        { label: "Money out", w: W * 0.24, align: "right", color: C.out },
        { label: "Net", w: W * 0.24, align: "right", bold: true },
      ],
      months.map((m) => [
        monthLabel(m.month),
        `${money(m.credits)} (${m.credit_count})`,
        `${money(m.debits)} (${m.debit_count})`,
        money(m.credits - m.debits),
      ]),
      { total: ["Total", `${money(t.credits)} (${t.creditCount})`, `${money(t.debits)} (${t.debitCount})`, money(t.net)] }
    );
  }

  /* ── By category ── */
  const cats = (summary.categories || []).filter((c) => c.credits || c.debits);
  if (cats.length) {
    heading("By category");
    table(
      [
        { label: "Category", w: W * 0.46 },
        { label: "Money in", w: W * 0.27, align: "right", color: C.in },
        { label: "Money out", w: W * 0.27, align: "right", color: C.out },
      ],
      cats.map((c) => [c.category, c.credits ? money(c.credits) : "", c.debits ? money(c.debits) : ""])
    );
  }

  /* ── Transactions ── */
  if (lines.length) {
    doc.addPage();
    heading(`Transactions (${lines.length})`);
    table(
      [
        { label: "Date", w: W * 0.12 },
        { label: "Details", w: W * 0.42 },
        { label: "Event / category", w: W * 0.2 },
        { label: "In", w: W * 0.13, align: "right", color: C.in },
        { label: "Out", w: W * 0.13, align: "right", color: C.out },
      ],
      lines.map((l) => {
        const amt = Number(l.amount);
        const details = [
          l.description || l.merchant_name || "",
          l.reference ? `Ref: ${l.reference}` : "",
          l.registration_number ? `Matched: ${l.registration_number} · ${l.registrant_name || ""}` : "",
          l.notes ? `Note: ${l.notes}` : "",
        ].filter(Boolean).join("\n");
        const evc = [l.eff_event_name ? eventTitle(l.eff_event_name, l.eff_event_year) : "", l.category || ""].filter(Boolean).join("\n");
        return [dmy(l.txn_day), details, evc, amt > 0 ? money(amt) : "", amt < 0 ? money(-amt) : ""];
      }),
      {
        total: [
          "",
          "Total",
          "",
          money(lines.filter((l) => Number(l.amount) > 0).reduce((s, l) => s + Number(l.amount), 0)),
          money(-lines.filter((l) => Number(l.amount) < 0).reduce((s, l) => s + Number(l.amount), 0)),
        ],
      }
    );
  } else if (months.length === 0) {
    heading("Transactions");
    doc.font("Helvetica").fontSize(10).fillColor(C.muted).text("No transactions for this selection.");
  }

  /* ── Footer on every page ── */
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    doc.page.margins.bottom = 0; // allow writing in the footer area without a page break
    const y = doc.page.height - M + 8;
    doc.font("Helvetica").fontSize(7.5).fillColor(C.muted)
      .text("Kutumb Australia Inc · Bank report · Confidential", M, y, { width: W / 2, lineBreak: false })
      .text(`Page ${i - range.start + 1} of ${range.count}`, M + W / 2, y, { width: W / 2, align: "right", lineBreak: false });
  }

  doc.end();
  return done;
}
