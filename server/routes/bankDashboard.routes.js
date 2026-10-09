// server/routes/bankDashboard.routes.js — mounted at /api/bank-dashboard
// Super-admin only (same level as Members): bank statement data is sensitive.
//
//   GET  /events                       events to pick from (registrations + upcoming)
//   GET  /summary?from&to&event        monthly credits/debits, totals, live balance,
//                                      and (with event) registration money for it
//   GET  /transactions?month|from&to&event&type&q   drill-down lines
//   PUT  /transactions/:id             { event: "name|||year" | null, category, notes }
//   GET  /export.csv?…                 same filters as /transactions
//   GET  /report.pdf?from&to&event&month&type&q&details=0|1   printable report
//
// event filter value is "name|||year"; "__untagged" = lines with no event.

import { Router } from "express";
import { pool } from "../db/pool.js";
import { requireSuperAdmin } from "../lib/auth.js";
import { getBalance, getStatus as getOpenfeedStatus } from "../lib/openfeedClient.js";
import { buildBankReportPdf } from "../lib/bankReportPdf.js";

const router = Router();
router.use(requireSuperAdmin);

// A line's event: manual tag first, else the event its credit was reconciled to.
const LINES = `
  SELECT l.*, to_char(l.txn_date, 'YYYY-MM-DD') AS txn_day,
         COALESCE(l.event_name, t.allocated_event_name) AS eff_event_name,
         COALESCE(l.event_year, t.allocated_event_year) AS eff_event_year,
         (l.event_name IS NULL AND t.allocated_event_name IS NOT NULL) AS auto_tagged,
         r.registration_number, r.name AS registrant_name, t.match_confidence
    FROM kutumb_bank_statement_lines l
    LEFT JOIN kutumb_bank_transactions t ON t.id = l.id
    LEFT JOIN kutumb_event_registrations r ON r.id = t.allocated_registration_id`;

function filters(q) {
  const where = [];
  const vals = [];
  const add = (sql, v) => {
    vals.push(v);
    where.push(sql.replace("?", `$${vals.length}`));
  };
  if (q.month && /^\d{4}-\d{2}$/.test(q.month)) add("to_char(x.txn_date, 'YYYY-MM') = ?", q.month);
  if (q.from && /^\d{4}-\d{2}-\d{2}$/.test(q.from)) add("x.txn_date >= ?::date", q.from);
  if (q.to && /^\d{4}-\d{2}-\d{2}$/.test(q.to)) add("x.txn_date <= ?::date", q.to);
  if (q.event === "__untagged") where.push("x.eff_event_name IS NULL");
  else if (q.event) {
    const [name, year] = String(q.event).split("|||");
    add("lower(x.eff_event_name) = lower(?)", name);
    if (year) add("x.eff_event_year = ?", year);
  }
  if (q.type === "credit") where.push("x.amount > 0");
  if (q.type === "debit") where.push("x.amount < 0");
  if (q.q) add("(x.description || ' ' || COALESCE(x.reference,'') || ' ' || COALESCE(x.merchant_name,'') || ' ' || COALESCE(x.registration_number,'')) ILIKE ?", `%${q.q}%`);
  return { where: where.length ? `WHERE ${where.join(" AND ")}` : "", vals };
}

router.get("/events", async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT event_name, event_year FROM kutumb_event_registrations
      UNION SELECT event_name, event_year FROM kutumb_bank_statement_lines WHERE event_name IS NOT NULL
      UNION SELECT allocated_event_name, allocated_event_year FROM kutumb_bank_transactions WHERE allocated_event_name IS NOT NULL
      ORDER BY 2 DESC, 1`);
    const { rows: up } = await pool.query("SELECT title, date_text FROM kutumb_upcoming_events");
    const seen = new Set(rows.map((r) => `${r.event_name.toLowerCase()}|||${r.event_year}`));
    const extra = up
      .map((e) => ({ event_name: e.title, event_year: String(e.date_text || "").match(/\d{4}/)?.[0] || "" }))
      .filter((e) => e.event_year && !seen.has(`${e.event_name.toLowerCase()}|||${e.event_year}`));
    res.json([...extra, ...rows].map((r) => ({ key: `${r.event_name}|||${r.event_year}`, name: r.event_name, year: r.event_year })));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

export async function buildSummary(query) {
  const { where, vals } = filters({ ...query, month: null, type: null, q: null });
  const { rows: months } = await pool.query(
    `SELECT to_char(x.txn_date, 'YYYY-MM') AS month,
            COALESCE(SUM(x.amount) FILTER (WHERE x.amount > 0), 0)::float AS credits,
            COALESCE(-SUM(x.amount) FILTER (WHERE x.amount < 0), 0)::float AS debits,
            COUNT(*) FILTER (WHERE x.amount > 0)::int AS credit_count,
            COUNT(*) FILTER (WHERE x.amount < 0)::int AS debit_count
       FROM (${LINES}) x ${where}
      GROUP BY 1 ORDER BY 1`,
    vals
  );
  const totals = months.reduce(
    (t, m) => ({
      credits: t.credits + m.credits,
      debits: t.debits + m.debits,
      creditCount: t.creditCount + m.credit_count,
      debitCount: t.debitCount + m.debit_count,
    }),
    { credits: 0, debits: 0, creditCount: 0, debitCount: 0 }
  );

  let eventSummary = null;
  if (query.event && query.event !== "__untagged") {
    const [name, year] = String(query.event).split("|||");
    const { rows } = await pool.query(
      `SELECT COUNT(*) FILTER (WHERE registration_status <> 'cancelled')::int AS registrations,
              COALESCE(SUM(fee) FILTER (WHERE registration_status <> 'cancelled'), 0)::float AS fees_due,
              COALESCE(SUM(LEAST(COALESCE(payment_amount, CASE WHEN payment_status = 'Paid' THEN fee END, 0), fee))
                FILTER (WHERE registration_status <> 'cancelled'), 0)::float AS received,
              COUNT(*) FILTER (WHERE registration_status = 'pending_payment' AND fee > 0 AND payment_status <> 'Paid')::int AS pending,
              COUNT(*) FILTER (WHERE registration_status = 'cancelled')::int AS cancelled
         FROM kutumb_event_registrations WHERE lower(event_name) = lower($1) AND event_year = $2`,
      [name, year]
    );
    const r = rows[0];
    eventSummary = { name, year, ...r, outstanding: Math.max(r.fees_due - r.received, 0), net: totals.credits - totals.debits };
  }

  // Money by category (manual tags; auto-matched credits count as registration fees).
  const { rows: categories } = await pool.query(
    `SELECT COALESCE(x.category, CASE WHEN x.registration_number IS NOT NULL THEN 'Registration fees' ELSE 'Uncategorised' END) AS category,
            COALESCE(SUM(x.amount) FILTER (WHERE x.amount > 0), 0)::float AS credits,
            COALESCE(-SUM(x.amount) FILTER (WHERE x.amount < 0), 0)::float AS debits
       FROM (${LINES}) x ${where}
      GROUP BY 1 ORDER BY 3 DESC, 2 DESC`,
    vals
  );

  const status = await getOpenfeedStatus().catch(() => null);
  const balance = status?.connected ? await getBalance() : null;

  // Opening/closing balance for the period, worked back from today's live
  // balance using the stored transactions (whole account — not event-filtered).
  //   closing(to)   = current balance − everything after `to`
  //   opening(from) = closing − net movement between from and to
  let periodBalances = null;
  if (balance?.currentBalance != null) {
    const to = /^\d{4}-\d{2}-\d{2}$/.test(query.to || "") ? query.to : null;
    const from = /^\d{4}-\d{2}-\d{2}$/.test(query.from || "") ? query.from : null;
    const { rows: b } = await pool.query(
      `SELECT COALESCE(SUM(amount) FILTER (WHERE $1::date IS NOT NULL AND txn_date > $1::date), 0)::float AS after_to,
              COALESCE(SUM(amount) FILTER (WHERE ($2::date IS NULL OR txn_date >= $2::date) AND ($1::date IS NULL OR txn_date <= $1::date)), 0)::float AS in_period,
              to_char(MIN(txn_date), 'YYYY-MM-DD') AS first_day
         FROM kutumb_bank_statement_lines`,
      [to, from]
    );
    const closing = balance.currentBalance - b[0].after_to;
    const opening = closing - b[0].in_period;
    const startsBeforeData = !from || (b[0].first_day && from < b[0].first_day);
    periodBalances = {
      opening,
      closing,
      openingDate: startsBeforeData ? b[0].first_day : from,
      closingDate: to && to < new Date().toISOString().slice(0, 10) ? to : null,
      firstDataDay: b[0].first_day,
      startsBeforeData,
    };
  }

  return {
    periodBalances,
    months,
    totals: { ...totals, net: totals.credits - totals.debits },
    eventSummary,
    categories,
    balance,
    account: status?.accountLabel || null,
    lastSync: status?.lastSync || null,
    connected: !!status?.connected,
  };
}

router.get("/summary", async (req, res) => {
  try {
    res.json(await buildSummary(req.query));
  } catch (err) {
    console.error("BANK SUMMARY ERROR:", err);
    res.status(500).json({ message: err.message });
  }
});

async function lines(q, limit = 2000) {
  const { where, vals } = filters(q);
  const { rows } = await pool.query(
    `SELECT * FROM (${LINES}) x ${where} ORDER BY x.txn_date DESC NULLS LAST, x.posted_at DESC NULLS LAST LIMIT ${limit}`,
    vals
  );
  return rows;
}

router.get("/transactions", async (req, res) => {
  try {
    const rows = await lines(req.query);
    res.json(
      rows.map((r) => ({
        id: r.id,
        date: r.txn_day,
        amount: Number(r.amount),
        description: r.description,
        reference: r.reference,
        merchantName: r.merchant_name,
        type: r.transaction_type,
        event: r.eff_event_name ? { name: r.eff_event_name, year: r.eff_event_year, key: `${r.eff_event_name}|||${r.eff_event_year}` } : null,
        autoTagged: r.auto_tagged,
        registrationNumber: r.registration_number,
        registrantName: r.registrant_name,
        matchConfidence: r.match_confidence,
        category: r.category,
        notes: r.notes,
      }))
    );
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.put("/transactions/:id", async (req, res) => {
  try {
    const { event, category, notes } = req.body || {};
    let name = null;
    let year = null;
    if (event) [name, year] = String(event).split("|||");
    const { rows } = await pool.query(
      `UPDATE kutumb_bank_statement_lines
          SET event_name = $1, event_year = $2, category = $3, notes = $4, tagged_by = $5, tagged_at = now()
        WHERE id = $6 RETURNING id`,
      [name || null, year || null, category || null, notes || null, req.admin?.email || req.admin?.name || null, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ message: "Transaction not found" });
    res.json({ message: "Saved" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.get("/export.csv", async (req, res) => {
  try {
    const rows = await lines(req.query, 100000);
    const esc = (v) => {
      const s = v === null || v === undefined ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const head = ["Date", "Credit", "Debit", "Description", "Reference", "Event", "Registration", "Registrant", "Category", "Notes"];
    const body = rows.map((r) =>
      [
        r.txn_day || "",
        Number(r.amount) > 0 ? Number(r.amount).toFixed(2) : "",
        Number(r.amount) < 0 ? (-Number(r.amount)).toFixed(2) : "",
        r.description,
        r.reference,
        r.eff_event_name ? `${r.eff_event_name} ${r.eff_event_year || ""}`.trim() : "",
        r.registration_number,
        r.registrant_name,
        r.category,
        r.notes,
      ].map(esc).join(",")
    );
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="kutumb-bank-transactions.csv"`);
    res.send([head.join(","), ...body].join("\n"));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.get("/report.pdf", async (req, res) => {
  try {
    const q = { ...req.query };
    // A single month = that month's date range.
    if (q.month && /^\d{4}-\d{2}$/.test(q.month)) {
      const [y, m] = q.month.split("-").map(Number);
      q.from = `${q.month}-01`;
      q.to = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
    }
    delete q.month;
    const summary = await buildSummary(q);
    const txns = q.details === "0" ? [] : await lines(q, 20000);
    const pdf = await buildBankReportPdf({
      summary,
      lines: txns,
      filters: { from: q.from || null, to: q.to || null, event: q.event || null, type: q.type || null, q: q.q || null },
      generatedBy: req.admin?.name || req.admin?.email || null,
    });
    const slug = (q.event && q.event !== "__untagged" ? q.event.split("|||").join("-") : q.event === "__untagged" ? "not-linked" : "all")
      .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const period = q.from || q.to ? `${q.from || "start"}_to_${q.to || "today"}` : "all-dates";
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="kutumb-bank-report-${slug}-${period}.pdf"`);
    res.send(pdf);
  } catch (err) {
    console.error("BANK REPORT PDF ERROR:", err);
    res.status(500).json({ message: err.message });
  }
});

export default router;
