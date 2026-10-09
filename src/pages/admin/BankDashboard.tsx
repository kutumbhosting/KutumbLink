// Admin → Bank (super admin, same level as Members).
// Monthly credits/debits of the Kutumb NAB account (pulled through openfeed),
// drill-down to each month's transactions, event filter with the event's
// registration money, event tagging of any line, and CSV export.
import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";

type Month = { month: string; credits: number; debits: number; credit_count: number; debit_count: number };
type Line = {
  id: string;
  date: string;
  amount: number;
  description: string | null;
  reference: string | null;
  merchantName: string | null;
  event: { name: string; year: string; key: string } | null;
  autoTagged: boolean;
  registrationNumber: string | null;
  registrantName: string | null;
  category: string | null;
  notes: string | null;
};

const money = (n: number | null | undefined) =>
  n === null || n === undefined ? "—" : n.toLocaleString("en-AU", { style: "currency", currency: "AUD" });
const monthLabel = (m: string) => {
  const [y, mm] = m.split("-").map(Number);
  return new Date(Date.UTC(y, mm - 1, 1)).toLocaleDateString("en-AU", { month: "short", year: "numeric", timeZone: "UTC" });
};
const iso = (d: Date) => d.toISOString().slice(0, 10);
const CATEGORIES = ["Registration fees", "Donation", "Membership", "Sponsorship", "Venue", "Food & catering", "Decorations", "Sound & lighting", "Printing", "Bank fees", "Refund", "Other"];

function ranges() {
  const now = new Date();
  const fyStartYear = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1; // AU financial year: 1 Jul
  return {
    "12m": { label: "Last 12 months", from: iso(new Date(now.getFullYear(), now.getMonth() - 11, 1)), to: iso(now) },
    fy: { label: `FY ${fyStartYear}–${String(fyStartYear + 1).slice(2)}`, from: `${fyStartYear}-07-01`, to: `${fyStartYear + 1}-06-30` },
    lastfy: { label: `FY ${fyStartYear - 1}–${String(fyStartYear).slice(2)}`, from: `${fyStartYear - 1}-07-01`, to: `${fyStartYear}-06-30` },
    all: { label: "All", from: "", to: "" },
  } as Record<string, { label: string; from: string; to: string }>;
}

const BankDashboard = () => {
  const { toast } = useToast();
  const R = useMemo(ranges, []);
  const [rangeKey, setRangeKey] = useState("12m");
  const [from, setFrom] = useState(R["12m"].from);
  const [to, setTo] = useState(R["12m"].to);
  const [event, setEvent] = useState("");
  const [events, setEvents] = useState<{ key: string; name: string; year: string }[]>([]);
  const [summary, setSummary] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);

  // drill-down
  const [month, setMonth] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [type, setType] = useState<"" | "credit" | "debit">("");
  const [q, setQ] = useState("");
  const [lines, setLines] = useState<Line[] | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ event: string; category: string; notes: string }>({ event: "", category: "", notes: "" });

  const params = (extra: Record<string, string | null | undefined> = {}) => {
    const p = new URLSearchParams();
    const all = { from, to, event, ...extra };
    for (const [k, v] of Object.entries(all)) if (v) p.set(k, v);
    return p.toString();
  };

  const loadSummary = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/bank-dashboard/summary?${params()}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Couldn't load");
      setSummary(data);
    } catch (err: any) {
      toast({ title: "Bank dashboard", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const loadLines = async () => {
    if (!month && !showAll) {
      setLines(null);
      return;
    }
    const extra: Record<string, string> = { type, q };
    if (month) {
      extra.month = month;
    }
    const res = await fetch(`/api/bank-dashboard/transactions?${params(extra)}`);
    const data = await res.json().catch(() => []);
    setLines(res.ok ? data : []);
  };

  useEffect(() => {
    fetch("/api/bank-dashboard/events").then((r) => (r.ok ? r.json() : [])).then(setEvents).catch(() => {});
  }, []);
  useEffect(() => {
    loadSummary();
    setMonth(null);
    setShowAll(!!event); // with an event picked, show its transactions straight away
  }, [from, to, event]);
  useEffect(() => {
    loadLines();
  }, [month, showAll, type, from, to, event]);

  const pickRange = (k: string) => {
    setRangeKey(k);
    if (k !== "custom") {
      setFrom(R[k].from);
      setTo(R[k].to);
    }
  };

  const syncNow = async () => {
    setSyncing(true);
    try {
      const res = await fetch("/api/openfeed/sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Sync failed");
      toast({ title: "Bank sync complete", description: data.message });
      loadSummary();
      loadLines();
    } catch (err: any) {
      toast({ title: "Couldn't sync", description: err.message, variant: "destructive" });
    } finally {
      setSyncing(false);
    }
  };

  const startEdit = (l: Line) => {
    setEditing(l.id);
    setDraft({ event: l.autoTagged ? "" : l.event?.key || "", category: l.category || "", notes: l.notes || "" });
  };
  const saveTag = async (id: string) => {
    const res = await fetch(`/api/bank-dashboard/transactions/${encodeURIComponent(id)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event: draft.event || null, category: draft.category || null, notes: draft.notes || null }),
    });
    if (!res.ok) {
      toast({ title: "Couldn't save", variant: "destructive" });
      return;
    }
    setEditing(null);
    loadLines();
    loadSummary();
  };

  // PDF report for the current event/period (and, from the drill-down, the
  // selected month / money in-out / search). Downloads via the browser.
  const [withDetails, setWithDetails] = useState(true);
  const downloadPdf = (drill = false) => {
    const extra: Record<string, string> = { details: withDetails ? "1" : "0" };
    if (drill) {
      if (month) extra.month = month;
      if (type) extra.type = type;
      if (q) extra.q = q;
      extra.details = "1";
    }
    window.open(`/api/bank-dashboard/report.pdf?${params(extra)}`, "_blank");
  };

  const exportCsv = () => {
    const extra: Record<string, string> = { type, q };
    if (month) extra.month = month;
    window.open(`/api/bank-dashboard/export.csv?${params(extra)}`, "_blank");
  };

  const months: Month[] = summary?.months || [];
  const t = summary?.totals;
  const es = summary?.eventSummary;
  const pb = summary?.periodBalances;
  const eventName = events.find((e) => e.key === event);

  return (
    <div className="space-y-6">
      {/* Account header */}
      <Card>
        <CardContent className="pt-6 flex flex-wrap gap-6 items-center justify-between">
          <div>
            <p className="text-sm text-muted-foreground">Kutumb Australia Inc · NAB BSB 082-356 · 778280517</p>
            <p className="text-sm">{summary?.account || (summary && !summary.connected ? "Live NAB feed not connected (Admin → Key Settings & Access → API Keys)" : "")}</p>
            <p className="text-xs text-muted-foreground">
              {summary?.lastSync?.at ? `Last sync ${new Date(summary.lastSync.at).toLocaleString("en-AU")}` : "Not synced yet"} · NAB data refreshes about every 4 hours
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs text-muted-foreground">Current balance</p>
            <p className="text-2xl font-bold">{money(summary?.balance?.currentBalance)}</p>
            {summary?.balance?.availableBalance != null && (
              <p className="text-xs text-muted-foreground">Available {money(summary.balance.availableBalance)}</p>
            )}
          </div>
          <Button onClick={syncNow} disabled={syncing || !summary?.connected}>
            {syncing ? "Syncing…" : "🔄 Sync now"}
          </Button>
        </CardContent>
      </Card>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-end">
        <div>
          <p className="text-xs text-muted-foreground mb-1">Event</p>
          <select className="border rounded-md h-10 px-2 text-sm bg-background min-w-[240px]" value={event} onChange={(e) => {
            setEvent(e.target.value);
            // An event's money can span months either side of it — show all dates.
            if (e.target.value && e.target.value !== "__untagged") pickRange("all");
          }}>
            <option value="">All transactions</option>
            <option value="__untagged">Not linked to an event</option>
            {events.map((e) => (
              <option key={e.key} value={e.key}>
                {e.name} {e.name.includes(e.year) ? "" : e.year}
              </option>
            ))}
          </select>
        </div>
        <div>
          <p className="text-xs text-muted-foreground mb-1">Period</p>
          <select className="border rounded-md h-10 px-2 text-sm bg-background" value={rangeKey} onChange={(e) => pickRange(e.target.value)}>
            {Object.entries(R).map(([k, v]) => (
              <option key={k} value={k}>{v.label}</option>
            ))}
            <option value="custom">Custom…</option>
          </select>
        </div>
        {rangeKey === "custom" && (
          <>
            <div>
              <p className="text-xs text-muted-foreground mb-1">From</p>
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">To</p>
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
          </>
        )}
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => downloadPdf(false)} disabled={!summary}>
            📄 Download PDF report
          </Button>
          <label className="flex items-center gap-1 text-xs text-muted-foreground cursor-pointer">
            <input type="checkbox" checked={withDetails} onChange={(e) => setWithDetails(e.target.checked)} />
            include every transaction
          </label>
        </div>
        {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
      </div>

      {/* Event money (registrations vs bank) */}
      {es && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">{eventName ? `${eventName.name} ${eventName.name.includes(eventName.year) ? "" : eventName.year}` : "Event"}</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <Stat label="Registrations" value={`${es.registrations}${es.cancelled ? ` (+${es.cancelled} cancelled)` : ""}`} />
            <Stat label="Fees due" value={money(es.fees_due)} />
            <Stat label="Received (all payment methods)" value={money(es.received)} />
            <Stat label="Outstanding" value={`${money(es.outstanding)} · ${es.pending} pending`} tone={es.outstanding > 0 ? "warn" : undefined} />
            <Stat label="Bank credits for event" value={money(t?.credits)} tone="in" />
            <Stat label="Bank debits for event" value={money(t?.debits)} tone="out" />
            <Stat label="Net in bank for event" value={money(es.net)} />
          </CardContent>
        </Card>
      )}

      {/* Totals */}
      {t && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card><CardContent className="pt-6"><Stat label={`Money in (${t.creditCount})`} value={money(t.credits)} tone="in" /></CardContent></Card>
          <Card><CardContent className="pt-6"><Stat label={`Money out (${t.debitCount})`} value={money(t.debits)} tone="out" /></CardContent></Card>
          <Card><CardContent className="pt-6"><Stat label="Net" value={money(t.net)} /></CardContent></Card>
          <Card><CardContent className="pt-6"><Stat label="Bank data held from" value={pb?.firstDataDay ? pb.firstDataDay.split("-").reverse().join("/") : "—"} /></CardContent></Card>
        </div>
      )}

      {/* Balance reconciliation for the period (whole account, not per event) */}
      {pb && (!event || event === "") && (
        <Card>
          <CardContent className="pt-6 text-sm">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span>Opening balance{pb.openingDate ? ` (${pb.openingDate.split("-").reverse().join("/")})` : ""}</span>
              <strong>{money(pb.opening)}</strong>
              <span className="text-green-700">+ money in {money(t.credits)}</span>
              <span className="text-red-700">− money out {money(t.debits)}</span>
              <span>=</span>
              <span>Closing balance{pb.closingDate ? ` (${pb.closingDate.split("-").reverse().join("/")})` : " (today)"}</span>
              <strong>{money(pb.closing)}</strong>
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Net is only the movement within the period; the bank balance also includes money held before it.
              Balances are worked back from today's live NAB balance using the stored transactions
              {pb.startsBeforeData ? " — the opening figure is the balance before the earliest transaction openfeed has provided" : ""}.
              Pending (not yet posted) transactions aren't included.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Chart */}
      {months.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-lg">Monthly credits and debits</CardTitle></CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground mb-2">Click a month to see its transactions.</p>
            <div style={{ width: "100%", height: 300 }}>
              <ResponsiveContainer>
                <BarChart
                  data={months.map((m) => ({ ...m, label: monthLabel(m.month) }))}
                  onClick={(e: any) => {
                    const m = e?.activePayload?.[0]?.payload?.month;
                    if (m) {
                      setMonth(m);
                      setShowAll(false);
                    }
                  }}
                >
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" fontSize={12} />
                  <YAxis fontSize={12} tickFormatter={(v) => `$${Number(v).toLocaleString("en-AU")}`} />
                  <Tooltip formatter={(v: number) => money(v)} />
                  <Legend />
                  <Bar dataKey="credits" name="Money in" fill="#16a34a" cursor="pointer" />
                  <Bar dataKey="debits" name="Money out" fill="#dc2626" cursor="pointer" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Monthly table */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 flex-wrap">
          <CardTitle className="text-lg">By month</CardTitle>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => { setMonth(null); setShowAll(true); }}>All transactions</Button>
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {months.length === 0 ? (
            <p className="text-sm text-muted-foreground">No transactions for this selection yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-muted-foreground border-b">
                <tr>
                  <th className="py-2">Month</th>
                  <th className="py-2 text-right">Money in</th>
                  <th className="py-2 text-right">Money out</th>
                  <th className="py-2 text-right">Net</th>
                </tr>
              </thead>
              <tbody>
                {[...months].reverse().map((m) => (
                  <tr
                    key={m.month}
                    className={`border-b cursor-pointer hover:bg-muted/50 ${month === m.month ? "bg-muted" : ""}`}
                    onClick={() => { setMonth(m.month); setShowAll(false); }}
                  >
                    <td className="py-2 font-medium">{monthLabel(m.month)}</td>
                    <td className="py-2 text-right text-green-700">{money(m.credits)} <span className="text-xs text-muted-foreground">({m.credit_count})</span></td>
                    <td className="py-2 text-right text-red-700">{money(m.debits)} <span className="text-xs text-muted-foreground">({m.debit_count})</span></td>
                    <td className="py-2 text-right font-medium">{money(m.credits - m.debits)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {/* Drill-down */}
      {(month || showAll) && (
        <Card>
          <CardHeader className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle className="text-lg">{month ? `Transactions — ${monthLabel(month)}` : "Transactions"}</CardTitle>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => downloadPdf(true)}>PDF</Button>
                <Button size="sm" variant="outline" onClick={exportCsv}>Export CSV</Button>
                <Button size="sm" variant="ghost" onClick={() => { setMonth(null); setShowAll(false); }}>Close</Button>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 items-center">
              {(["", "credit", "debit"] as const).map((k) => (
                <Button key={k || "all"} size="sm" variant={type === k ? "default" : "outline"} onClick={() => setType(k)}>
                  {k === "" ? "All" : k === "credit" ? "Money in" : "Money out"}
                </Button>
              ))}
              <Input
                className="max-w-xs"
                placeholder="Search description, reference, name…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && loadLines()}
              />
              <Button size="sm" variant="outline" onClick={loadLines}>Search</Button>
            </div>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            {!lines ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : lines.length === 0 ? (
              <p className="text-sm text-muted-foreground">No transactions.</p>
            ) : (
              <>
                <p className="text-xs text-muted-foreground mb-2">
                  {lines.length} transaction(s) · in {money(lines.filter((l) => l.amount > 0).reduce((s, l) => s + l.amount, 0))} · out{" "}
                  {money(-lines.filter((l) => l.amount < 0).reduce((s, l) => s + l.amount, 0))}
                </p>
                <table className="w-full text-sm">
                  <thead className="text-left text-muted-foreground border-b">
                    <tr>
                      <th className="py-2 pr-2">Date</th>
                      <th className="py-2 pr-2">Details</th>
                      <th className="py-2 pr-2">Event / category</th>
                      <th className="py-2 text-right">Amount</th>
                      <th className="py-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((l) => (
                      <tr key={l.id} className="border-b align-top">
                        <td className="py-2 pr-2 whitespace-nowrap">{l.date ? l.date.split("-").reverse().join("/") : "—"}</td>
                        <td className="py-2 pr-2">
                          <p>{l.description || l.merchantName || "—"}</p>
                          {l.reference && <p className="text-xs text-muted-foreground">Ref: {l.reference}</p>}
                          {l.registrationNumber && (
                            <p className="text-xs text-green-700">Matched to {l.registrationNumber} · {l.registrantName}</p>
                          )}
                          {l.notes && <p className="text-xs text-muted-foreground italic">{l.notes}</p>}
                        </td>
                        <td className="py-2 pr-2">
                          {editing === l.id ? (
                            <div className="space-y-2 min-w-[220px]">
                              <select
                                className="border rounded-md h-9 px-2 text-sm bg-background w-full"
                                value={draft.event}
                                onChange={(e) => setDraft({ ...draft, event: e.target.value })}
                              >
                                <option value="">{l.autoTagged ? `(automatic: ${l.event?.name})` : "No event"}</option>
                                {events.map((e) => (
                                  <option key={e.key} value={e.key}>{e.name} {e.name.includes(e.year) ? "" : e.year}</option>
                                ))}
                              </select>
                              <Input list="bank-categories" placeholder="Category" value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })} />
                              <Input placeholder="Notes" value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} />
                              <div className="flex gap-2">
                                <Button size="sm" onClick={() => saveTag(l.id)}>Save</Button>
                                <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
                              </div>
                            </div>
                          ) : (
                            <div className="space-y-1">
                              {l.event ? (
                                <Badge variant={l.autoTagged ? "secondary" : "default"}>
                                  {l.event.name} {l.event.name.includes(l.event.year) ? "" : l.event.year}
                                  {l.autoTagged ? " · auto" : ""}
                                </Badge>
                              ) : (
                                <span className="text-xs text-muted-foreground">—</span>
                              )}
                              {l.category && <p className="text-xs">{l.category}</p>}
                            </div>
                          )}
                        </td>
                        <td className={`py-2 text-right whitespace-nowrap font-medium ${l.amount > 0 ? "text-green-700" : "text-red-700"}`}>
                          {l.amount > 0 ? "+" : "−"}{money(Math.abs(l.amount))}
                        </td>
                        <td className="py-2 pl-2 text-right">
                          {editing !== l.id && (
                            <Button size="sm" variant="ghost" onClick={() => startEdit(l)}>Tag</Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {lines.length >= 2000 && (
                  <p className="text-xs text-muted-foreground mt-2">Showing the latest 2,000 — narrow the period or use Export CSV for everything.</p>
                )}
              </>
            )}
            <datalist id="bank-categories">
              {CATEGORIES.map((c) => <option key={c} value={c} />)}
            </datalist>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

function Stat({ label, value, tone }: { label: string; value: string; tone?: "in" | "out" | "warn" }) {
  const color = tone === "in" ? "text-green-700" : tone === "out" ? "text-red-700" : tone === "warn" ? "text-orange-700" : "";
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-xl font-semibold ${color}`}>{value}</p>
    </div>
  );
}

export default BankDashboard;
