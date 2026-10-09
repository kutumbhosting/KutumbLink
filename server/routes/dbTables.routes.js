import { Router } from "express";
import express from "express";
import { pool } from "../db/pool.js";
import { requireSuperAdmin } from "../lib/auth.js";
import { logAudit } from "../lib/audit.js";

const router = Router();
router.use(requireSuperAdmin);

// Deliberately excludes three tables from this generic editor, each for a
// specific safety reason rather than an oversight:
//  - kutumb_admin_users: has its own dedicated UI (Admin Users tab), and a
//    generic editor would let someone paste a plaintext password into
//    password_hash, silently creating a broken/insecure login.
//  - kutumb_platform_settings: has its own dedicated UI (Settings tab);
//    secret values are AES-encrypted here, so a generic editor would only
//    ever show useless ciphertext, and editing it directly could corrupt
//    a Stripe key in a way that's hard to diagnose.
//  - kutumb_media_files: stores large binary blobs (bytea, up to ~10MB per
//    row for videos) — genuinely impractical to render/edit as a table
//    cell, and one fat-fingered edit would corrupt an image/video with no
//    easy way to notice. Already has proper upload/delete flows elsewhere.
const EXCLUDED_TABLES = ["kutumb_admin_users", "kutumb_platform_settings", "kutumb_media_files"];

// Every one of our tables uses a simple `id SERIAL PRIMARY KEY` except
// this one, which is intentionally keyed by name.
const PRIMARY_KEY_OVERRIDES = {
  kutumb_platform_settings: "key",
  kutumb_schema_migrations: "name",
};

// CSV is for ordinary records only. Authentication, secrets, payment status,
// provider attempts, reconciliation, audit and settlement records must use
// their existing workflows so imports cannot fabricate money or access.
const CSV_IMPORT_BLOCKED = new Set([
  "kutumb_admin_users", "kutumb_platform_settings", "kutumb_media_files",
  "kutumb_audit_log", "kutumb_schema_migrations", "kutumb_registration_payments",
  "kutumb_donation_payments", "kutumb_settlement_ledger", "kutumb_charity_transfers",
  "kutumb_bank_transactions", "kutumb_bank_reconciliations", "kutumb_bank_statement_lines",
  "kutumb_registration_notifications", "kutumb_supporter_login_links", "kutumb_supporter_merge_log",
  "kutumb_ticket_refunds", "kutumb_drive_imports", "kutumb_orders", "kutumb_order_items",
  "kutumb_attendees", "kutumb_registration_attendees", "kutumb_event_registrations",
]);
const CSV_BLOCKED_COLUMNS = {
  kutumb_donations: new Set(["payment_status", "payment_method", "bank_transferred", "transaction_number"]),
  kutumb_supporters: new Set(["merged_into_id"]),
};

function parseCsv(source) {
  const text = String(source || "").replace(/^\uFEFF/, "");
  const rows = [];
  let row = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { cell += '"'; i += 1; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") { row.push(cell); cell = ""; }
    else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i += 1;
      row.push(cell); cell = "";
      if (row.some((value) => value.trim() !== "")) rows.push(row);
      row = [];
    } else cell += char;
  }
  if (quoted) throw new Error("CSV has a quoted cell that was not closed");
  if (cell !== "" || row.length) { row.push(cell); if (row.some((value) => value.trim() !== "")) rows.push(row); }
  if (!rows.length) throw new Error("CSV is empty");
  const headers = rows[0].map((header) => header.trim());
  if (headers.some((header) => !header) || new Set(headers).size !== headers.length) throw new Error("CSV headers must be present and unique");
  if (rows.slice(1).some((data) => data.length !== headers.length)) throw new Error("Every CSV row must have the same number of cells as the header");
  return { headers, records: rows.slice(1).map((data) => Object.fromEntries(headers.map((header, index) => [header, data[index]]))) };
}

function importValue(column, raw) {
  if (raw === "") return { empty: true };
  if (["smallint", "integer", "bigint"].includes(column.data_type)) {
    const value = Number(raw);
    if (!Number.isSafeInteger(value)) throw new Error(`${column.column_name} must be a whole number`);
    return { value };
  }
  if (["numeric", "real", "double precision"].includes(column.data_type)) {
    const value = Number(raw);
    if (!Number.isFinite(value)) throw new Error(`${column.column_name} must be a number`);
    return { value };
  }
  if (column.data_type === "boolean") {
    const value = raw.toLowerCase();
    if (!["true", "false", "1", "0", "yes", "no"].includes(value)) throw new Error(`${column.column_name} must be true or false`);
    return { value: ["true", "1", "yes"].includes(value) };
  }
  if (column.data_type === "ARRAY") {
    try {
      const value = JSON.parse(raw);
      if (!Array.isArray(value)) throw new Error("not an array");
      return { value };
    } catch { throw new Error(`${column.column_name} must contain a valid JSON array`); }
  }
  if (column.data_type === "json" || column.data_type === "jsonb") {
    try { return { value: JSON.parse(raw) }; }
    catch { throw new Error(`${column.column_name} must contain valid JSON`); }
  }
  return { value: raw };
}

function assertImportable(tableName) {
  if (CSV_IMPORT_BLOCKED.has(tableName)) {
    const err = new Error("CSV import is disabled for protected, financial, payment, audit, or system tables. Use the table's dedicated workflow.");
    err.statusCode = 400;
    throw err;
  }
}

async function runCsvImport(tableName, csv, commit) {
  await assertAllowedTable(tableName);
  assertImportable(tableName);
  const { headers, records } = parseCsv(csv);
  if (records.length < 1 || records.length > 500) throw Object.assign(new Error("CSV must contain between 1 and 500 data rows"), { statusCode: 400 });
  const columns = await getColumns(tableName);
  const byName = new Map(columns.map((column) => [column.column_name, column]));
  const unknown = headers.filter((header) => !byName.has(header));
  if (unknown.length) throw Object.assign(new Error(`Unknown column(s): ${unknown.join(", ")}`), { statusCode: 400 });
  const blockedColumns = headers.filter((header) => CSV_BLOCKED_COLUMNS[tableName]?.has(header));
  if (blockedColumns.length) throw Object.assign(new Error(`Remove protected column(s) from the CSV: ${blockedColumns.join(", ")}`), { statusCode: 400 });
  const primaryKey = getPrimaryKeyColumn(tableName);
  if (headers.includes(primaryKey)) throw Object.assign(new Error(`Leave ${primaryKey} out of the CSV; the platform creates it automatically`), { statusCode: 400 });
  const required = columns.filter((column) => column.is_nullable === "NO" && !column.column_default && column.column_name !== primaryKey).map((column) => column.column_name);
  for (const [index, record] of records.entries()) for (const name of required) {
    if (!headers.includes(name) || record[name] === "") throw Object.assign(new Error(`Row ${index + 2}: ${name} is required`), { statusCode: 400 });
  }

  const client = await pool.connect();
  const rowErrors = [];
  let imported = 0;
  try {
    await client.query("BEGIN");
    for (const [index, record] of records.entries()) {
      await client.query(`SAVEPOINT csv_row`);
      try {
        const entries = [];
        for (const header of headers) {
          const column = byName.get(header);
          const converted = importValue(column, record[header]);
          if (converted.empty) continue;
          entries.push([header, converted.value]);
        }
        // A validation preview must not consume SERIAL values; PostgreSQL
        // sequences do not roll back with the transaction.
        if (!commit && byName.has(primaryKey) && !headers.includes(primaryKey) && primaryKey === "id") {
          entries.push([primaryKey, -(index + 1)]);
        }
        if (!entries.length) throw new Error("No values provided");
        const names = entries.map(([name]) => `"${name}"`).join(",");
        const args = entries.map((_, i) => `$${i + 1}`).join(",");
        await client.query(`INSERT INTO "${tableName}" (${names}) VALUES (${args})`, entries.map(([, value]) => value));
        await client.query(`RELEASE SAVEPOINT csv_row`);
        imported += 1;
      } catch (error) {
        await client.query(`ROLLBACK TO SAVEPOINT csv_row`);
        await client.query(`RELEASE SAVEPOINT csv_row`);
        rowErrors.push({ row: index + 2, message: error.message });
      }
    }
    if (rowErrors.length) await client.query("ROLLBACK");
    else if (commit) await client.query("COMMIT");
    else await client.query("ROLLBACK");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally { client.release(); }
  return { ok: rowErrors.length === 0, imported: rowErrors.length ? 0 : imported, attempted: records.length, errors: rowErrors, previewOnly: !commit };
}

async function getAllowedTables() {
  const { rows } = await pool.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name LIKE 'kutumb_%'
     ORDER BY table_name`
  );
  return rows.map((r) => r.table_name).filter((t) => !EXCLUDED_TABLES.includes(t));
}

async function assertAllowedTable(tableName) {
  const allowed = await getAllowedTables();
  if (!allowed.includes(tableName)) {
    const err = new Error("Unknown or restricted table");
    err.statusCode = 400;
    throw err;
  }
  return allowed;
}

async function getColumns(tableName) {
  const { rows } = await pool.query(
    `SELECT column_name, data_type, is_nullable, column_default
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1
     ORDER BY ordinal_position`,
    [tableName]
  );
  return rows;
}

function getPrimaryKeyColumn(tableName) {
  return PRIMARY_KEY_OVERRIDES[tableName] || "id";
}

router.get("/tables", async (req, res) => {
  res.json(await getAllowedTables());
});

router.get("/tables/:table", async (req, res) => {
  try {
    await assertAllowedTable(req.params.table);
    const columns = await getColumns(req.params.table);
    const pk = getPrimaryKeyColumn(req.params.table);

    // Capped at 500 rows — this is an admin data-browser, not a reporting
    // tool; anything needing more than that needs a real query, not this UI.
    const { rows } = await pool.query(
      `SELECT * FROM "${req.params.table}" ORDER BY "${pk}" DESC LIMIT 500`
    );

    res.json({ columns, rows, primaryKey: pk, truncated: rows.length === 500 });
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
});

router.post("/tables/:table/import/preview", express.text({ type: ["text/csv", "text/plain"], limit: "1mb" }), async (req, res) => {
  try {
    const result = await runCsvImport(req.params.table, req.body, false);
    res.json(result);
  } catch (err) { res.status(err.statusCode || 400).json({ message: err.message }); }
});

router.post("/tables/:table/import", express.text({ type: ["text/csv", "text/plain"], limit: "1mb" }), async (req, res) => {
  try {
    const result = await runCsvImport(req.params.table, req.body, true);
    if (!result.ok) return res.status(400).json(result);
    await logAudit(req.admin, "db_table.bulk_import", req.params.table, { importedRows: result.imported });
    res.status(201).json(result);
  } catch (err) { res.status(err.statusCode || 400).json({ message: err.message }); }
});

router.post("/tables/:table", async (req, res) => {
  try {
    await assertAllowedTable(req.params.table);
    const columns = await getColumns(req.params.table);
    const columnNames = columns.map((c) => c.column_name);

    const entries = Object.entries(req.body).filter(
      ([key, value]) => columnNames.includes(key) && value !== "" && value !== undefined
    );
    if (entries.length === 0) return res.status(400).json({ message: "No valid column values provided" });

    const cols = entries.map(([key]) => `"${key}"`).join(", ");
    const placeholders = entries.map((_, i) => `$${i + 1}`).join(", ");
    const values = entries.map(([, value]) => value);

    const { rows } = await pool.query(
      `INSERT INTO "${req.params.table}" (${cols}) VALUES (${placeholders}) RETURNING *`,
      values
    );
    await logAudit(req.admin, "db_table.insert", req.params.table, { row: rows[0] });
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(err.statusCode || 400).json({ message: err.message });
  }
});

router.put("/tables/:table/:pkValue", async (req, res) => {
  try {
    await assertAllowedTable(req.params.table);
    const columns = await getColumns(req.params.table);
    const columnNames = columns.map((c) => c.column_name);
    const pk = getPrimaryKeyColumn(req.params.table);

    const entries = Object.entries(req.body).filter(
      ([key, value]) => columnNames.includes(key) && key !== pk && value !== undefined
    );
    if (entries.length === 0) return res.status(400).json({ message: "No valid column values provided" });

    const setClause = entries.map(([key], i) => `"${key}" = $${i + 1}`).join(", ");
    const values = entries.map(([, value]) => value);
    values.push(req.params.pkValue);

    const { rows } = await pool.query(
      `UPDATE "${req.params.table}" SET ${setClause} WHERE "${pk}" = $${values.length} RETURNING *`,
      values
    );
    if (rows.length === 0) return res.status(404).json({ message: "Row not found" });

    await logAudit(req.admin, "db_table.update", req.params.table, { pk: req.params.pkValue });
    res.json(rows[0]);
  } catch (err) {
    res.status(err.statusCode || 400).json({ message: err.message });
  }
});

router.delete("/tables/:table/:pkValue", async (req, res) => {
  try {
    await assertAllowedTable(req.params.table);
    const pk = getPrimaryKeyColumn(req.params.table);

    const { rows } = await pool.query(
      `DELETE FROM "${req.params.table}" WHERE "${pk}" = $1 RETURNING *`,
      [req.params.pkValue]
    );
    if (rows.length === 0) return res.status(404).json({ message: "Row not found" });

    await logAudit(req.admin, "db_table.delete", req.params.table, { pk: req.params.pkValue });
    res.json({ message: "Row deleted" });
  } catch (err) {
    res.status(err.statusCode || 400).json({ message: err.message });
  }
});

export default router;
