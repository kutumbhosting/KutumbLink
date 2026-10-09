import { FormEvent, useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type CharityBalance = { organisation_id: number; legal_name: string; public_name?: string; gross_receipts: string; refunds: string; fees: string; transferred: string; outstanding: string };
type Entry = { id: number; entry_type: string; amount: string; provider_reference?: string; note?: string; created_at: string; transferred_at?: string; bank_reference?: string; recorded_by?: string };

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers || {}) } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.message || "Could not load settlement details");
  return payload as T;
}
const money = (value: unknown) => `$${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} AUD`;

export default function SettlementPanel() {
  const [balances, setBalances] = useState<CharityBalance[]>([]);
  const [selected, setSelected] = useState("");
  const [detail, setDetail] = useState<{ organisation: { legal_name: string; public_name?: string }; outstanding: string; entries: Entry[] } | null>(null);
  const [form, setForm] = useState({ amount: "", transferredAt: new Date().toISOString().slice(0, 10), bankReference: "", recipientNote: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    const rows = await request<CharityBalance[]>("/api/organisations/platform/settlements");
    setBalances(rows);
    if (!selected && rows.length) setSelected(String(rows[0].organisation_id));
  }, [selected]);
  const loadDetail = useCallback(async (id: string) => {
    if (!id) { setDetail(null); return; }
    const value = await request<typeof detail>(`/api/organisations/platform/settlements/${id}`);
    setDetail(value);
  }, []);
  useEffect(() => { load().catch((e) => setError(e.message)); }, [load]);
  useEffect(() => { loadDetail(selected).catch((e) => setError(e.message)); }, [selected, loadDetail]);

  async function recordTransfer(event: FormEvent) {
    event.preventDefault();
    if (!selected) return;
    setBusy(true); setError(""); setMessage("");
    try {
      await request(`/api/organisations/platform/settlements/${selected}/transfers`, { method: "POST", body: JSON.stringify(form) });
      setMessage("Transfer recorded. The charity balance and audit history have been updated.");
      setForm((current) => ({ ...current, amount: "", bankReference: "", recipientNote: "" }));
      await load(); await loadDetail(selected);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not record transfer"); }
    finally { setBusy(false); }
  }

  return <div className="space-y-5">
    <Card><CardHeader><CardTitle>Charity settlements</CardTitle><p className="text-sm text-muted-foreground">Ticket and online donation payments go into Kutumb’s central payment account. Record bank transfers here after they are sent.</p></CardHeader><CardContent>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{balances.map((row) => <button key={row.organisation_id} type="button" onClick={() => setSelected(String(row.organisation_id))} className={`rounded-lg border p-4 text-left ${selected === String(row.organisation_id) ? "border-primary bg-primary/5" : ""}`}><span className="block font-medium">{row.public_name || row.legal_name}</span><span className="mt-2 block text-xs text-muted-foreground">Available for transfer</span><strong className="mt-1 block">{money(row.outstanding)}</strong><span className="mt-2 block text-xs text-muted-foreground">Receipts {money(row.gross_receipts)} · transferred {money(row.transferred)}</span></button>)}</div>
      {balances.length === 0 && <p className="text-sm text-muted-foreground">No charities are available yet.</p>}
    </CardContent></Card>
    {detail && <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(320px,0.8fr)]">
      <Card><CardHeader><CardTitle>{detail.organisation.public_name || detail.organisation.legal_name}: history</CardTitle><p className="text-sm text-muted-foreground">Current available balance: <strong>{money(detail.outstanding)}</strong></p></CardHeader><CardContent><div className="max-h-[34rem] divide-y overflow-auto">{detail.entries.map((entry) => <div key={entry.id} className="flex flex-wrap justify-between gap-2 py-3 text-sm"><div><strong>{entry.entry_type.replace(/_/g, " ")}</strong><p className="text-xs text-muted-foreground">{entry.note || entry.provider_reference || entry.bank_reference || "Recorded transaction"}</p>{entry.bank_reference && <p className="text-xs text-muted-foreground">Bank reference: {entry.bank_reference}</p>}{entry.recorded_by && <p className="text-xs text-muted-foreground">Recorded by {entry.recorded_by}</p>}</div><div className="text-right"><strong className={Number(entry.amount) < 0 ? "text-muted-foreground" : ""}>{money(entry.amount)}</strong><p className="text-xs text-muted-foreground">{entry.transferred_at ? new Date(`${entry.transferred_at}T00:00:00`).toLocaleDateString() : new Date(entry.created_at).toLocaleDateString()}</p></div></div>)}{detail.entries.length === 0 && <p className="py-4 text-sm text-muted-foreground">No payments or transfers have been recorded yet.</p>}</div></CardContent></Card>
      <Card><CardHeader><CardTitle>Record a bank transfer</CardTitle><p className="text-sm text-muted-foreground">Use this after you transfer the available funds to the charity. The entry is permanent and audited.</p></CardHeader><CardContent><form className="space-y-3" onSubmit={recordTransfer}><Input required type="number" min="0.01" max={Math.max(0,Number(detail.outstanding))} step="0.01" placeholder="Amount (AUD)" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /><Input required type="date" aria-label="Transfer date" value={form.transferredAt} onChange={(e) => setForm({ ...form, transferredAt: e.target.value })} /><Input required maxLength={160} placeholder="Bank transfer reference" value={form.bankReference} onChange={(e) => setForm({ ...form, bankReference: e.target.value })} /><Input maxLength={500} placeholder="Note (optional)" value={form.recipientNote} onChange={(e) => setForm({ ...form, recipientNote: e.target.value })} /><Button disabled={busy || Number(form.amount) <= 0 || Number(form.amount) > Number(detail.outstanding)}>{busy ? "Recording…" : "Record transfer"}</Button>{error && <p role="alert" className="text-sm text-destructive">{error}</p>}{message && <p role="status" className="text-sm text-green-700">{message}</p>}</form></CardContent></Card>
    </div>}
  </div>;
}
