// server/lib/reconciliationReportBuilder.js
//
// Builds the downloadable Excel reconciliation report for one "Upload Bank
// Statement" run — same shape as the manually-built Utsav 2026 workbook:
// a Summary sheet, a Registrations sheet with payment status/amount/date
// and a match-confidence column, and an Unmatched Bank Credits sheet.

import ExcelJS from "exceljs";

const NAVY = "FF1F3864";
const LIGHT_BLUE = "FFD9E2F3";
const GREEN = "FFC6EFCE";
const RED = "FFFFC7CE";
const AMBER = "FFFFEB9C";
const GREY_TEXT = "FF555555";

function headerRow(ws, rowNumber, values) {
  const row = ws.getRow(rowNumber);
  row.values = values;
  row.eachCell((cell) => {
    cell.font = { name: "Arial", size: 10, bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.border = thinBorder();
  });
  return row;
}

function thinBorder() {
  const side = { style: "thin", color: { argb: "FFBFBFBF" } };
  return { top: side, bottom: side, left: side, right: side };
}

function money(n) {
  return "$#,##0;($#,##0);-";
}

export function buildReconciliationWorkbook({ eventName, eventYear, uploadedFilename, rows, unmatchedCredits, dateRange }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Kutumb";
  wb.created = new Date();

  // The stored event_name often already ends with the year (e.g. "Utsav
  // Multicultural Festival 2026"), so only append eventYear when it isn't
  // already there — otherwise every title/filename reads "...2026 2026".
  const eventLabel =
    eventYear && !String(eventName).trim().endsWith(String(eventYear)) ? `${eventName} ${eventYear}` : eventName;

  // ---------------- Summary ----------------
  const summary = wb.addWorksheet("Summary", { views: [{ showGridLines: false }] });
  summary.getColumn(1).width = 44;
  summary.getColumn(2).width = 18;

  summary.getCell("A1").value = `${eventLabel} — Payment Reconciliation Summary`;
  summary.getCell("A1").font = { name: "Arial", size: 14, bold: true, color: { argb: NAVY } };
  summary.getCell("A2").value = uploadedFilename
    ? `Reconciled against bank statement: ${uploadedFilename}${dateRange ? ` (${dateRange})` : ""}`
    : "Payment reconciliation summary.";
  summary.getCell("A2").font = { name: "Arial", size: 9, italic: true, color: { argb: GREY_TEXT } };

  const totalRegs = rows.length;
  const totalFees = rows.reduce((s, r) => s + (Number(r.fee) || 0), 0);
  const paidRows = rows.filter((r) => r.paymentStatus === "Paid");
  const unpaidRows = rows.filter((r) => r.paymentStatus !== "Paid");
  const amountMatched = rows.reduce((s, r) => s + (Number(r.paymentAmount) || 0), 0);
  const outstanding = rows.reduce((s, r) => {
    const bal = (Number(r.fee) || 0) - (Number(r.paymentAmount) || 0);
    return s + (bal > 0 ? bal : 0);
  }, 0);
  const overpaid = rows.reduce((s, r) => {
    const bal = (Number(r.fee) || 0) - (Number(r.paymentAmount) || 0);
    return s + (bal < 0 ? -bal : 0);
  }, 0);
  const confCounts = { High: 0, Medium: 0, Low: 0 };
  rows.forEach((r) => {
    if (r.paymentMatchConfidence && confCounts[r.paymentMatchConfidence] !== undefined) {
      confCounts[r.paymentMatchConfidence]++;
    }
  });
  const claimedNotFound = rows.filter((r) => r.bankTransferred && r.paymentStatus !== "Paid").length;
  const unmatchedValue = unmatchedCredits.reduce((s, u) => s + u.transaction.amount, 0);

  const blocks = [
    ["REGISTRATIONS", null],
    ["Total registrations", totalRegs, "0"],
    ["Total fees due", totalFees, "$#,##0"],
    ["PAYMENTS MATCHED TO THE BANK STATEMENT", null],
    ["Registrations paid", paidRows.length, "0"],
    ["Registrations unpaid", unpaidRows.length, "0"],
    ["Amount received & matched", amountMatched, "$#,##0"],
    ["Still outstanding (unpaid + short)", outstanding, "$#,##0"],
    ["Overpaid / extra received", overpaid, "$#,##0"],
    ["MATCH QUALITY (review the low ones)", null],
    ["High confidence matches", confCounts.High, "0"],
    ["Medium confidence matches", confCounts.Medium, "0"],
    ["Low confidence matches", confCounts.Low, "0"],
    ["Claimed paid on form but not found in bank", claimedNotFound, "0"],
    ["UNRECONCILED BANK CREDITS", null],
    ["Credits not tied to a registration", unmatchedCredits.length, "0"],
    ["Value of those credits", unmatchedValue, "$#,##0"],
  ];

  let r = 4;
  for (const [label, value, fmt] of blocks) {
    const rowRef = summary.getRow(r);
    if (value === null) {
      rowRef.getCell(1).value = label;
      rowRef.getCell(1).font = { name: "Arial", size: 10, bold: true, color: { argb: "FFFFFFFF" } };
      rowRef.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
      rowRef.getCell(2).fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
    } else {
      rowRef.getCell(1).value = label;
      rowRef.getCell(1).font = { name: "Arial", size: 10 };
      rowRef.getCell(1).border = thinBorder();
      rowRef.getCell(2).value = value;
      rowRef.getCell(2).font = { name: "Arial", size: 10, bold: true };
      rowRef.getCell(2).numFmt = fmt;
      rowRef.getCell(2).alignment = { horizontal: "right" };
      rowRef.getCell(2).border = thinBorder();
    }
    r++;
  }

  // ---------------- Registrations ----------------
  const ws = wb.addWorksheet("Registrations", { views: [{ state: "frozen", ySplit: 4, xSplit: 2 }] });
  const cols = [
    "Reg. No", "Name", "Email", "Phone", "Adults", "Children", "Total Attendees",
    "Member", "Membership No", "Fee Due (A$)", "Payment Status", "Amount Paid (A$)",
    "Date Paid", "Balance (A$)", "Match Confidence", "Matched On (logic)",
    "Bank Reference (matched)", "Declared in Form", "Registered On", "Comments",
  ];
  ws.getCell("A1").value = `${eventLabel} — Registrations & Payment Status`;
  ws.getCell("A1").font = { name: "Arial", size: 14, bold: true, color: { argb: NAVY } };
  ws.getCell("A2").value =
    "Amount Paid / Date Paid / Bank Reference come from the uploaded bank statement, not from the registration form.";
  ws.getCell("A2").font = { name: "Arial", size: 9, italic: true, color: { argb: GREY_TEXT } };
  headerRow(ws, 4, cols);
  ws.autoFilter = { from: "A4", to: `${String.fromCharCode(64 + cols.length)}4` };

  const widths = [9, 22, 28, 14, 8, 8, 9, 8, 12, 11, 11, 12, 12, 11, 11, 30, 34, 12, 16, 26];
  widths.forEach((w, i) => (ws.getColumn(i + 1).width = w));

  rows.forEach((rrow, i) => {
    const rowNum = 5 + i;
    const fee = Number(rrow.fee) || 0;
    const paid = Number(rrow.paymentAmount) || 0;
    const balance = fee - paid;
    const total = 1 + Number(rrow.adults || 0) + Number(rrow.children || 0);

    const row = ws.getRow(rowNum);
    row.values = [
      rrow.registrationNumber || "—",
      rrow.name,
      rrow.email,
      rrow.phone || "",
      Number(rrow.adults) || 0,
      Number(rrow.children) || 0,
      total,
      rrow.isMember ? "Yes" : "No",
      rrow.membershipNumber || "",
      fee,
      rrow.paymentStatus || "N/A",
      paid,
      rrow.paymentDate ? new Date(rrow.paymentDate) : null,
      balance,
      rrow.paymentMatchConfidence || "",
      rrow.paymentMatchNote || "",
      rrow.bankReference || "",
      rrow.bankTransferred ? "Yes" : "No",
      rrow.createdAt ? new Date(rrow.createdAt) : null,
      rrow.comments || "",
    ];

    row.eachCell((cell, colNumber) => {
      cell.font = { name: "Arial", size: 10 };
      cell.border = thinBorder();
      cell.alignment = { vertical: "top", wrapText: [2, 3, 16, 17, 20].includes(colNumber) };
    });
    row.getCell(10).numFmt = money();
    row.getCell(12).numFmt = money();
    row.getCell(14).numFmt = money();
    row.getCell(13).numFmt = "dd-mmm-yyyy";
    row.getCell(19).numFmt = "dd-mmm-yyyy hh:mm";
    [5, 6, 7, 8, 11].forEach((c) => (row.getCell(c).alignment = { horizontal: "center", vertical: "top" }));

    const statusCell = row.getCell(11);
    if (rrow.paymentStatus === "Paid") statusCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: GREEN } };
    else if (rrow.paymentStatus === "Pending") statusCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: RED } };

    const confCell = row.getCell(15);
    if (rrow.paymentMatchConfidence === "Low") confCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: AMBER } };

    const balCell = row.getCell(14);
    if (balance > 0) balCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: RED } };
    else if (balance < 0) balCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: AMBER } };
  });

  // ---------------- Unmatched Bank Credits ----------------
  const w2 = wb.addWorksheet("Unmatched Bank Credits", { views: [{ state: "frozen", ySplit: 4 }] });
  w2.getCell("A1").value = "Bank credits that could NOT be tied to a registration";
  w2.getCell("A1").font = { name: "Arial", size: 12, bold: true, color: { argb: NAVY } };
  w2.getCell("A2").value = "Review these manually — donations, stall/other income, or a payment whose reference gives no usable clue.";
  w2.getCell("A2").font = { name: "Arial", size: 9, italic: true, color: { argb: GREY_TEXT } };
  headerRow(w2, 4, ["Date", "Amount (A$)", "Transaction Details", "Classification"]);
  [14, 13, 55, 24].forEach((wd, i) => (w2.getColumn(i + 1).width = wd));

  unmatchedCredits.forEach((u, i) => {
    const rowNum = 5 + i;
    const row = w2.getRow(rowNum);
    row.values = [u.transaction.date || "", u.transaction.amount, u.transaction.raw, u.classification];
    row.eachCell((cell, colNumber) => {
      cell.font = { name: "Arial", size: 10 };
      cell.border = thinBorder();
      cell.alignment = { vertical: "top", wrapText: colNumber === 3 };
    });
    if (u.transaction.date) row.getCell(1).numFmt = "dd-mmm-yyyy";
    row.getCell(2).numFmt = "$#,##0";
  });
  const totalRowNum = 5 + unmatchedCredits.length;
  w2.getCell(`A${totalRowNum}`).value = "Total";
  w2.getCell(`A${totalRowNum}`).font = { name: "Arial", size: 10, bold: true };
  w2.getCell(`B${totalRowNum}`).value = unmatchedCredits.reduce((s, u) => s + u.transaction.amount, 0);
  w2.getCell(`B${totalRowNum}`).font = { name: "Arial", size: 10, bold: true };
  w2.getCell(`B${totalRowNum}`).numFmt = "$#,##0";
  w2.getCell(`B${totalRowNum}`).fill = { type: "pattern", pattern: "solid", fgColor: { argb: LIGHT_BLUE } };
  if (unmatchedCredits.length) {
    w2.autoFilter = { from: "A4", to: `D${totalRowNum - 1}` };
  }

  // ---------------- Matching Logic ----------------
  // Intentionally omitted from the report — this sheet is meant for
  // treasurers to hand out/read, not to explain the matching internals.

  return wb;
}
