import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";

async function api(path: string, options: RequestInit = {}) {
  const res = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers as any) },
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.message || "Request failed");
  return data;
}

interface ColumnDef {
  column_name: string;
  data_type: string;
  is_nullable: string;
  column_default: string | null;
}

// Renders one form control appropriate to a column's Postgres type, and
// converts its value back to something the API can bind correctly:
//  - boolean        -> checkbox, real true/false
//  - ARRAY          -> comma-separated text, split into a real array
//  - integer/numeric -> number input, coerced to a JS number
//  - json/jsonb      -> textarea of raw JSON text (Postgres casts it)
//  - everything else -> plain text input
function FieldEditor({
  column,
  value,
  onChange,
}: {
  column: ColumnDef;
  value: any;
  onChange: (v: any) => void;
}) {
  if (column.data_type === "boolean") {
    return (
      <input
        type="checkbox"
        checked={value === true || value === "true"}
        onChange={(e) => onChange(e.target.checked)}
      />
    );
  }
  if (column.data_type === "ARRAY") {
    const text = Array.isArray(value) ? value.join(", ") : value || "";
    return (
      <Input
        value={text}
        placeholder="comma, separated, values"
        onChange={(e) => onChange(e.target.value.split(",").map((s) => s.trim()).filter(Boolean))}
      />
    );
  }
  if (column.data_type === "json" || column.data_type === "jsonb") {
    return (
      <textarea
        className="w-full border rounded p-1.5 text-xs font-mono bg-background"
        rows={2}
        value={typeof value === "string" ? value : JSON.stringify(value ?? {})}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }
  if (["integer", "bigint", "numeric", "smallint", "real", "double precision"].includes(column.data_type)) {
    return (
      <Input
        type="number"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))}
      />
    );
  }
  return <Input value={value ?? ""} onChange={(e) => onChange(e.target.value)} />;
}

function displayValue(v: any): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (Array.isArray(v)) return v.join(", ");
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

export default function DatabaseTables() {
  const { toast } = useToast();
  const [tables, setTables] = useState<string[]>([]);
  const [selectedTable, setSelectedTable] = useState("");
  const [columns, setColumns] = useState<ColumnDef[]>([]);
  const [rows, setRows] = useState<any[]>([]);
  const [primaryKey, setPrimaryKey] = useState("id");
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(false);

  const [editingPk, setEditingPk] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<Record<string, any>>({});

  const [showAddForm, setShowAddForm] = useState(false);
  const [newRow, setNewRow] = useState<Record<string, any>>({});
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [csvPreview, setCsvPreview] = useState<any | null>(null);
  const [csvBusy, setCsvBusy] = useState(false);
  const [csvError, setCsvError] = useState("");
  const csvBlocked = new Set([
    "kutumb_admin_users", "kutumb_platform_settings", "kutumb_media_files", "kutumb_audit_log", "kutumb_schema_migrations",
    "kutumb_registration_payments", "kutumb_donation_payments", "kutumb_settlement_ledger", "kutumb_charity_transfers",
    "kutumb_bank_transactions", "kutumb_bank_reconciliations", "kutumb_bank_statement_lines", "kutumb_registration_notifications",
    "kutumb_supporter_login_links", "kutumb_supporter_merge_log", "kutumb_ticket_refunds", "kutumb_drive_imports",
    "kutumb_orders", "kutumb_order_items", "kutumb_attendees", "kutumb_registration_attendees", "kutumb_event_registrations",
  ]);

  useEffect(() => {
    api("/api/db-tables/tables").then(setTables).catch((err) =>
      toast({ title: "Couldn't load table list", description: err.message, variant: "destructive" })
    );
  }, []);

  const loadTable = async (table: string) => {
    if (!table) return;
    setLoading(true);
    setShowAddForm(false);
    setEditingPk(null);
    try {
      const result = await api(`/api/db-tables/tables/${table}`);
      setColumns(result.columns);
      setRows(result.rows);
      setPrimaryKey(result.primaryKey);
      setTruncated(result.truncated);
    } catch (err: any) {
      toast({ title: "Couldn't load table", description: err.message, variant: "destructive" });
      setColumns([]);
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (selectedTable) loadTable(selectedTable); }, [selectedTable]);

  const startEdit = (row: any) => {
    setEditingPk(String(row[primaryKey]));
    setEditValues({ ...row });
  };

  const saveEdit = async () => {
    try {
      await api(`/api/db-tables/tables/${selectedTable}/${editingPk}`, {
        method: "PUT",
        body: JSON.stringify(editValues),
      });
      toast({ title: "Row updated" });
      setEditingPk(null);
      loadTable(selectedTable);
    } catch (err: any) {
      toast({ title: "Update failed", description: err.message, variant: "destructive" });
    }
  };

  const deleteRow = async (row: any) => {
    if (!confirm(`Delete this row from ${selectedTable}? This can't be undone.`)) return;
    try {
      await api(`/api/db-tables/tables/${selectedTable}/${row[primaryKey]}`, { method: "DELETE" });
      toast({ title: "Row deleted" });
      loadTable(selectedTable);
    } catch (err: any) {
      toast({ title: "Delete failed", description: err.message, variant: "destructive" });
    }
  };

  const createRow = async () => {
    try {
      await api(`/api/db-tables/tables/${selectedTable}`, {
        method: "POST",
        body: JSON.stringify(newRow),
      });
      toast({ title: "Row created" });
      setNewRow({});
      setShowAddForm(false);
      loadTable(selectedTable);
    } catch (err: any) {
      toast({ title: "Create failed", description: err.message, variant: "destructive" });
    }
  };

  const previewCsv = async () => {
    if (!csvFile || !selectedTable) return;
    setCsvBusy(true); setCsvError(""); setCsvPreview(null);
    try {
      const res = await fetch(`/api/db-tables/tables/${selectedTable}/import/preview`, {
        method: "POST", headers: { "Content-Type": "text/csv" }, body: await csvFile.text(),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || "Could not validate CSV");
      setCsvPreview(data);
    } catch (err: any) { setCsvError(err.message || "Could not validate CSV"); }
    finally { setCsvBusy(false); }
  };

  const importCsv = async () => {
    if (!csvFile || !selectedTable || !csvPreview?.ok) return;
    if (!confirm(`Import ${csvPreview.attempted} rows into ${selectedTable}? This cannot be undone.`)) return;
    setCsvBusy(true); setCsvError("");
    try {
      const res = await fetch(`/api/db-tables/tables/${selectedTable}/import`, {
        method: "POST", headers: { "Content-Type": "text/csv" }, body: await csvFile.text(),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.errors?.map((e: any) => `Row ${e.row}: ${e.message}`).join("; ") || data.message || "Import failed");
      toast({ title: `${data.imported} rows imported`, description: "The complete CSV was added and the action was recorded in the audit log." });
      setCsvFile(null); setCsvPreview(null);
      const input = document.getElementById("csv-table-upload") as HTMLInputElement | null;
      if (input) input.value = "";
      await loadTable(selectedTable);
    } catch (err: any) { setCsvError(err.message || "Import failed"); }
    finally { setCsvBusy(false); }
  };

  const creatableColumns = columns.filter((c) => c.column_name !== primaryKey);

  return (
    <div className="space-y-6">
      <div className="max-w-md">
        <Label>Table</Label>
        <select
          className="w-full mt-1 p-2 border rounded text-foreground bg-background"
          value={selectedTable}
          onChange={(e) => setSelectedTable(e.target.value)}
        >
          <option value="">-- Choose a table --</option>
          {tables.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <p className="text-xs text-muted-foreground mt-1">
          Admin Users, Settings, and Media Files are managed on their own tabs instead of here, for safety.
        </p>
      </div>

      {loading && <p className="text-sm text-muted-foreground">Loading...</p>}

      {selectedTable && !loading && (
        <>
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              {rows.length} row{rows.length === 1 ? "" : "s"}{truncated ? " (showing first 500)" : ""}
            </p>
            <Button size="sm" onClick={() => setShowAddForm(!showAddForm)}>
              {showAddForm ? "Cancel" : "+ Add row"}
            </Button>
          </div>

          <div className="space-y-3 rounded-lg border p-4">
            <div><h3 className="font-semibold text-sm">Bulk upload CSV</h3><p className="mt-1 text-xs text-muted-foreground">Choose a CSV with a header row matching the column names below. Uploads are checked first and imported as one batch.</p></div>
            {csvBlocked.has(selectedTable) ? <p className="text-sm text-amber-700">Bulk upload is disabled for this protected table. Use its dedicated payment, reconciliation, security or media workflow.</p> : <>
              <div className="flex flex-wrap items-center gap-2"><input id="csv-table-upload" type="file" accept=".csv,text/csv" className="max-w-full text-sm" onChange={(e) => { setCsvFile(e.target.files?.[0] || null); setCsvPreview(null); setCsvError(""); }} /><Button size="sm" variant="outline" asChild><a href={`/sample-csv/${selectedTable}.csv`} download>Download sample CSV</a></Button><Button size="sm" variant="outline" disabled={!csvFile || csvBusy} onClick={() => void previewCsv()}>{csvBusy ? "Checking…" : "Check file"}</Button><Button size="sm" disabled={!csvPreview?.ok || csvBusy} onClick={() => void importCsv()}>{csvBusy ? "Working…" : `Import${csvPreview?.ok ? ` ${csvPreview.attempted} rows` : " CSV"}`}</Button></div>
              {csvPreview && <p role="status" className={`text-sm ${csvPreview.ok ? "text-green-700" : "text-destructive"}`}>{csvPreview.ok ? `Ready to import ${csvPreview.attempted} rows. No data has been changed yet.` : `Found ${csvPreview.errors?.length || 0} issue(s). No rows were imported.`}{csvPreview.errors?.slice(0, 5).map((e: any) => <span key={`${e.row}-${e.message}`} className="block">Row {e.row}: {e.message}</span>)}</p>}
              {csvError && <p role="alert" className="text-sm text-destructive">{csvError}</p>}
            </>}
          </div>

          {showAddForm && (
            <div className="border rounded-lg p-4 space-y-3 bg-muted/30">
              <h4 className="font-semibold text-sm">New row in {selectedTable}</h4>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {creatableColumns.map((col) => (
                  <div key={col.column_name}>
                    <Label className="text-xs">{col.column_name}{col.is_nullable === "NO" && !col.column_default && " *"}</Label>
                    <FieldEditor
                      column={col}
                      value={newRow[col.column_name]}
                      onChange={(v) => setNewRow({ ...newRow, [col.column_name]: v })}
                    />
                  </div>
                ))}
              </div>
              <Button onClick={createRow}>Create row</Button>
            </div>
          )}

          <div className="overflow-x-auto border rounded-lg">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left border-b bg-muted/50">
                  {columns.map((col) => (
                    <th key={col.column_name} className="px-2 py-2 whitespace-nowrap font-semibold">{col.column_name}</th>
                  ))}
                  <th className="px-2 py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const isEditing = editingPk === String(row[primaryKey]);
                  return (
                    <tr key={row[primaryKey]} className="border-b hover:bg-muted/20">
                      {columns.map((col) => (
                        <td key={col.column_name} className="px-2 py-1.5 max-w-[220px]">
                          {isEditing && col.column_name !== primaryKey ? (
                            <FieldEditor
                              column={col}
                              value={editValues[col.column_name]}
                              onChange={(v) => setEditValues({ ...editValues, [col.column_name]: v })}
                            />
                          ) : (
                            <span className="block truncate" title={displayValue(row[col.column_name])}>
                              {displayValue(row[col.column_name])}
                            </span>
                          )}
                        </td>
                      ))}
                      <td className="px-2 py-1.5 whitespace-nowrap">
                        {isEditing ? (
                          <div className="flex gap-1">
                            <Button size="sm" onClick={saveEdit}>Save</Button>
                            <Button size="sm" variant="outline" onClick={() => setEditingPk(null)}>Cancel</Button>
                          </div>
                        ) : (
                          <div className="flex gap-1">
                            <Button size="sm" variant="outline" onClick={() => startEdit(row)}>Edit</Button>
                            <Button size="sm" variant="destructive" onClick={() => deleteRow(row)}>Delete</Button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {rows.length === 0 && (
                  <tr><td colSpan={columns.length + 1} className="px-2 py-4 text-center text-muted-foreground">No rows yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
