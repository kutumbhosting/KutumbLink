// server/lib/bankStatementParser.js
//
// Turns an uploaded bank statement (.xlsx, .xls, or .csv — NAB and most
// Australian banks export one of these three) into a plain list of credit
// transactions: [{ date: Date|null, amount: number, details: string }].
//
// Only money coming IN is returned — any row with a zero or negative
// amount (a debit, a fee reversal, etc.) is dropped here, since a bank
// statement's outgoing transactions are never a member's event payment.
//
// Column names vary bank to bank ("Transaction Details" vs "Description"
// vs "Narrative"), so headers are matched by keyword rather than an exact
// name.

import ExcelJS from "exceljs";

const DATE_KEYWORDS = ["date"];
const AMOUNT_KEYWORDS = ["amount", "credit", "deposit"];
// "Debit Amount" / "Withdrawal" columns must never be read as money in —
// statements with separate Debit and Credit columns used to have the Debit
// column picked (both contain "amount"), so real credits were ignored.
const AMOUNT_EXCLUDE_KEYWORDS = ["balance", "debit", "withdraw"];
const DETAILS_KEYWORDS = ["detail", "description", "narrative", "reference", "particular", "payee", "memo"];

function normalizeHeader(h) {
  return String(h || "").trim().toLowerCase();
}

function scoreHeaderMatch(header, keywords, excludeKeywords = []) {
  const h = normalizeHeader(header);
  if (!h) return -1;
  if (excludeKeywords.some((k) => h.includes(k))) return -1;
  const idx = keywords.findIndex((k) => h === k);
  if (idx !== -1) return 100 - idx; // exact match wins
  const partial = keywords.findIndex((k) => h.includes(k));
  if (partial !== -1) return 50 - partial;
  return -1;
}

function pickColumn(headers, keywords, excludeKeywords = []) {
  let best = -1;
  let bestScore = -1;
  headers.forEach((h, i) => {
    const s = scoreHeaderMatch(h, keywords, excludeKeywords);
    if (s > bestScore) {
      bestScore = s;
      best = i;
    }
  });
  return bestScore >= 0 ? best : -1;
}

function parseAmount(raw) {
  if (raw === null || raw === undefined || raw === "") return null;
  if (typeof raw === "number") return raw;
  let s = String(raw).trim();
  if (!s) return null;
  const negative = /^\(.*\)$/.test(s) || /-\s*$/.test(s);
  s = s.replace(/[()$,\s]/g, "").replace(/-$/, "");
  if (s.startsWith("+")) s = s.slice(1);
  const n = parseFloat(s);
  if (Number.isNaN(n)) return null;
  return negative && n > 0 ? -n : n;
}

function parseDate(raw) {
  if (raw === null || raw === undefined || raw === "") return null;
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) return raw;
  if (typeof raw === "number") {
    // Excel serial date (days since 1899-12-30)
    const ms = Math.round((raw - 25569) * 86400 * 1000);
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const s = String(raw).trim();
  if (!s) return null;

  // dd/mm/yyyy or dd-mm-yyyy (the common Australian bank export format)
  const dmy = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (dmy) {
    let [, d, m, y] = dmy;
    if (y.length === 2) y = `20${y}`;
    const dt = new Date(Number(y), Number(m) - 1, Number(d));
    if (!Number.isNaN(dt.getTime())) return dt;
  }

  const generic = new Date(s);
  return Number.isNaN(generic.getTime()) ? null : generic;
}

function rowsToTransactions(headerRow, dataRows) {
  const headers = headerRow.map(normalizeHeader);
  const dateCol = pickColumn(headers, DATE_KEYWORDS);
  const amountCol = pickColumn(headers, AMOUNT_KEYWORDS, AMOUNT_EXCLUDE_KEYWORDS);
  const detailsCol = pickColumn(headers, DETAILS_KEYWORDS);

  if (amountCol === -1) {
    throw new Error(
      "Couldn't find an amount column in the uploaded file. Expected a header " +
        'like "Amount", "Credit" or "Deposit".'
    );
  }
  if (detailsCol === -1) {
    throw new Error(
      "Couldn't find a transaction description column in the uploaded file. " +
        'Expected a header like "Transaction Details", "Description" or "Narrative".'
    );
  }

  const transactions = [];
  let skippedNonCredit = 0;
  let skippedBlank = 0;

  for (const row of dataRows) {
    const amount = parseAmount(row[amountCol]);
    const details = String(row[detailsCol] ?? "").trim();
    const date = dateCol !== -1 ? parseDate(row[dateCol]) : null;

    if (amount === null && !details) {
      skippedBlank++;
      continue;
    }
    if (amount === null || amount <= 0) {
      skippedNonCredit++;
      continue;
    }
    transactions.push({ date, amount, details });
  }

  return { transactions, skippedNonCredit, skippedBlank, totalRows: dataRows.length };
}

function findHeaderRowIndex(rows) {
  // Scan the first ~10 rows for the one that looks like a header: it should
  // contain something that matches our amount/details keywords. Bank
  // exports sometimes have a title or account-summary block above the
  // actual table.
  const limit = Math.min(rows.length, 10);
  for (let i = 0; i < limit; i++) {
    const headers = rows[i].map(normalizeHeader);
    const hasAmount = pickColumn(headers, AMOUNT_KEYWORDS, AMOUNT_EXCLUDE_KEYWORDS) !== -1;
    const hasDetails = pickColumn(headers, DETAILS_KEYWORDS) !== -1;
    if (hasAmount && hasDetails) return i;
  }
  return 0; // fall back to the first row
}

function parseCsvText(text) {
  // Small hand-rolled CSV parser that handles quoted fields containing
  // commas or embedded newlines — good enough for bank exports, without
  // pulling in another dependency.
  const rows = [];
  let field = "";
  let row = [];
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => String(cell).trim() !== ""));
}

async function parseXlsxBuffer(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error("The uploaded file has no worksheets.");

  const rows = [];
  sheet.eachRow({ includeEmpty: false }, (row) => {
    const values = row.values.slice(1); // exceljs pads index 0
    rows.push(values.map((v) => (v && typeof v === "object" && "result" in v ? v.result : v)));
  });
  return rows;
}

/**
 * @param {Buffer} buffer
 * @param {string} originalFilename
 * @returns {Promise<{ transactions: Array<{date: Date|null, amount: number, details: string}>, skippedNonCredit: number, skippedBlank: number, totalRows: number }>}
 */
export async function parseBankStatement(buffer, originalFilename = "") {
  const lower = originalFilename.toLowerCase();
  let rows;

  const isZip = buffer.length > 4 && buffer[0] === 0x50 && buffer[1] === 0x4b; // .xlsx is a zip
  const isOldExcel =
    buffer.length > 8 && buffer[0] === 0xd0 && buffer[1] === 0xcf && buffer[2] === 0x11 && buffer[3] === 0xe0;

  if (isOldExcel) {
    const err = new Error(
      "This is an old-format Excel file (.xls), which can't be read directly. " +
        "Open it in Excel and Save As .xlsx or CSV, or export the statement from NAB as CSV."
    );
    err.code = "OLD_EXCEL";
    throw err;
  }

  if (isZip) {
    rows = await parseXlsxBuffer(buffer);
  } else if (lower.endsWith(".csv") || !lower.match(/\.xlsx?$/)) {
    rows = parseCsvText(buffer.toString("utf-8").replace(/^\uFEFF/, ""));
  } else {
    try {
      rows = await parseXlsxBuffer(buffer);
    } catch (err) {
      // Some banks label a CSV export with a .xls extension — fall back to
      // treating it as text if the binary Excel parse fails outright.
      rows = parseCsvText(buffer.toString("utf-8"));
      if (!rows.length) throw err;
    }
  }

  if (!rows.length) throw new Error("The uploaded file appears to be empty.");

  const headerIdx = findHeaderRowIndex(rows);
  const headerRow = rows[headerIdx];
  const dataRows = rows.slice(headerIdx + 1);

  return rowsToTransactions(headerRow, dataRows);
}
