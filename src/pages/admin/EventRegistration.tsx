import { useState, useRef, useEffect, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { safeFetch, downloadCSV } from "./safeFetch";
import { ColumnFilterHeader } from "@/components/admin/ColumnFilterHeader";

type RegistrationColumnKey =
  | "registrationNumber" | "name" | "email" | "phone" | "adults" | "children"
  | "fee" | "paymentStatus" | "paymentAmount" | "paymentDate" | "transactionNumber"
  | "membershipNumber" | "registrationStatus" | "paymentMethod" | "paymentMatchConfidence"
  | "heardAbout" | "comments";

// Display-string extractor for each filterable column — used both to build
// the dropdown's checklist and to test a row against the active filter.
// Columns where practically every row holds a different value — a filter
// checklist would just be a long list of one-offs, so no filter is offered
// (sorting still works where it did before).
const UNIQUE_VALUE_COLUMNS: RegistrationColumnKey[] = [
  "registrationNumber", "name", "email", "phone", "transactionNumber", "membershipNumber", "comments",
];

const REGISTRATION_COLUMNS: { key: RegistrationColumnKey; label: string; getValue: (m: any) => string }[] = [
  { key: "registrationNumber", label: "Reg. No", getValue: (m) => String(m.registrationNumber ?? "") },
  { key: "name", label: "Name", getValue: (m) => m.name || "" },
  { key: "email", label: "Email", getValue: (m) => m.email || "" },
  { key: "phone", label: "Phone", getValue: (m) => m.phone || "" },
  { key: "adults", label: "Adults", getValue: (m) => String(m.adults ?? "") },
  { key: "children", label: "Children", getValue: (m) => String(m.children ?? "") },
  { key: "fee", label: "Fee", getValue: (m) => (typeof m.fee === "number" ? `$${m.fee}` : "-") },
  { key: "paymentStatus", label: "Payment Status", getValue: (m) => m.paymentStatus || "N/A" },
  { key: "paymentAmount", label: "Amount Paid", getValue: (m) => (typeof m.paymentAmount === "number" && m.paymentAmount > 0 ? `$${m.paymentAmount}` : "-") },
  { key: "paymentDate", label: "Date Paid", getValue: (m) => (m.paymentDate ? new Date(m.paymentDate).toLocaleDateString("en-AU") : "-") },
  { key: "transactionNumber", label: "Transaction No", getValue: (m) => m.transactionNumber || "" },
  { key: "membershipNumber", label: "Membership No", getValue: (m) => m.membershipNumber || "" },
  { key: "registrationStatus", label: "Registration Status", getValue: (m) => m.registrationStatus || "-" },
  { key: "paymentMethod", label: "Payment Method", getValue: (m) =>
      m.paymentMethod === "card" ? "Card" :
      m.paymentMethod === "bank_transfer" ? "Bank Transfer" :
      m.paymentMethod === "coupon" ? "Coupon" : "-" },
  { key: "paymentMatchConfidence", label: "Match Confidence", getValue: (m) => m.paymentMatchConfidence || "-" },
  { key: "heardAbout", label: "Heard About", getValue: (m) => m.heardAboutSource || "-" },
  { key: "comments", label: "Comments", getValue: (m) => m.comments || "-" },
];

interface EventRegistrationProps {
  groupedEvents: Record<string, any[]>;
  onReload: () => void;
}

const EventRegistration = ({ groupedEvents, onReload }: EventRegistrationProps) => {
  const { toast } = useToast();

  const [selectedEventKey, setSelectedEventKey] = useState<string>("");
  const [selectedEventRows, setSelectedEventRows] = useState<string[]>([]);
  const [editingEvent, setEditingEvent] = useState<any | null>(null);
  const [eventActionMessage, setEventActionMessage] = useState("");
  const [justOpened, setJustOpened] = useState(false);
  const editPanelRef = useRef<HTMLDivElement | null>(null);

  // ── Bank statement reconciliation ───────────────────────────────────────
  const bankStatementInputRef = useRef<HTMLInputElement | null>(null);
  const [reconciling, setReconciling] = useState(false);
  const [reconcileResultOpen, setReconcileResultOpen] = useState(false);
  const [reconcileResult, setReconcileResult] = useState<any | null>(null);
  const [latestReconciliation, setLatestReconciliation] = useState<any | null>(null);

  const fetchLatestReconciliation = async (eventName: string, eventYear: string) => {
    if (!eventName || !eventYear) {
      setLatestReconciliation(null);
      return;
    }
    const data = await safeFetch(
      `/api/events/reconcile/latest?eventName=${encodeURIComponent(eventName)}&eventYear=${encodeURIComponent(eventYear)}`
    );
    setLatestReconciliation(data || null);
  };

  const triggerBankStatementUpload = () => bankStatementInputRef.current?.click();

  const handleBankStatementSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file later
    if (!file || !selectedEvent) return;

    setReconciling(true);
    try {
      const formData = new FormData();
      formData.append("bankStatement", file);
      formData.append("eventName", selectedEvent.eventName);
      formData.append("eventYear", selectedEvent.eventYear);

      const res = await fetch("/api/events/reconcile", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Reconciliation failed");

      setReconcileResult(data);
      setReconcileResultOpen(true);
      setLatestReconciliation({
        reconciliationId: data.reconciliationId,
        uploadedFilename: file.name,
        summary: data.summary,
      });
      toast({ title: "Reconciliation complete", description: data.message });
      onReload();
    } catch (err: any) {
      toast({ title: "Couldn't reconcile that file", description: err.message, variant: "destructive" });
    } finally {
      setReconciling(false);
    }
  };

  // ── Live NAB feed (openfeed) ─────────────────────────────────────────────
  const [bankFeed, setBankFeed] = useState<any | null>(null);
  const [syncingBank, setSyncingBank] = useState(false);

  const fetchBankFeedStatus = async () => {
    const data = await safeFetch("/api/openfeed/status");
    setBankFeed(data || null);
  };
  useEffect(() => {
    fetchBankFeedStatus();
  }, []);

  // Pulls new NAB credits and reconciles ALL events with unpaid registrations.
  const syncFromBank = async () => {
    setSyncingBank(true);
    try {
      const res = await fetch("/api/openfeed/sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Bank sync failed");
      toast({ title: "Bank sync complete", description: data.message });
      onReload();
      if (selectedEvent) fetchLatestReconciliation(selectedEvent.eventName, selectedEvent.eventYear);
      fetchBankFeedStatus();
    } catch (err: any) {
      toast({ title: "Couldn't sync from bank", description: err.message, variant: "destructive" });
    } finally {
      setSyncingBank(false);
    }
  };

  const downloadReconciliationReport = (id: number | string) => {
    window.open(`/api/events/reconcile/${id}/export`, "_blank");
  };

  // ── Search / filter / sort ──────────────────────────────────────────────
  const [search, setSearch] = useState("");

  // Per-column dropdown filters (Excel-style, with a search box in each
  // dropdown) — one entry per column in REGISTRATION_COLUMNS. An empty
  // array for a column means "no filter applied" on it.
  const emptyRegistrationFilters = (): Record<RegistrationColumnKey, string[]> => ({
    registrationNumber: [], name: [], email: [], phone: [], adults: [], children: [],
    fee: [], paymentStatus: [], paymentAmount: [], paymentDate: [], transactionNumber: [],
    membershipNumber: [], registrationStatus: [], paymentMethod: [], paymentMatchConfidence: [],
    heardAbout: [], comments: [],
  });
  const [columnFilters, setColumnFilters] = useState<Record<RegistrationColumnKey, string[]>>(
    emptyRegistrationFilters()
  );
  const setColumnFilter = (key: RegistrationColumnKey, values: string[]) =>
    setColumnFilters((prev) => ({ ...prev, [key]: values }));
  const anyColumnFilterActive = Object.values(columnFilters).some((v) => v.length > 0);

  const [sortKey, setSortKey] = useState<
    "registrationNumber" | "name" | "email" | "phone" | "adults" | "children" | "fee" | "paymentStatus" | "paymentAmount" | "paymentDate" | "transactionNumber" | "membershipNumber"
  >("registrationNumber");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const toggleSort = (key: typeof sortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  // ─── derived: selected event ─────────────────────────────────────────────
  // groupedEvents[key] holds one placeholder row (see Admin.tsx's fetchData)
  // for an active event that has zero real registrations so far, purely so
  // it still has a key to show up in the dropdown below. It's not an actual
  // attendee, so it's filtered out here before counting/summing anything —
  // selecting such an event correctly shows "0 registrations" rather than 1.
  const selectedEventAllRows = selectedEventKey ? groupedEvents[selectedEventKey] || [] : [];
  const selectedEventRealRows = selectedEventAllRows.filter((m: any) => !m.__placeholder);
  // Cancelled registrations stay listed but don't count towards headcount/fees.
  const selectedEventActiveRows = selectedEventRealRows.filter((m: any) => m.registrationStatus !== "cancelled");
  const selectedEvent =
    selectedEventKey && selectedEventAllRows.length
      ? {
          members: selectedEventRealRows,
          eventName: selectedEventAllRows[0]?.eventName,
          eventYear: selectedEventAllRows[0]?.eventYear,
          adults: selectedEventActiveRows.reduce(
            (sum: number, m: any) => sum + 1 + Number(m.adults || 0), 0
          ),
          children: selectedEventActiveRows.reduce(
            (sum: number, m: any) => sum + Number(m.children || 0), 0
          ),
          totalPeople: selectedEventActiveRows.reduce(
            (sum: number, m: any) => sum + 1 + Number(m.adults || 0) + Number(m.children || 0), 0
          ),
          totalFees: selectedEventActiveRows.reduce(
            (sum: number, m: any) => sum + Number(m.fee || 0), 0
          ),
        }
      : null;

  // Distinct values per column, scoped to the currently selected event, used
  // to populate each column's filter dropdown.
  const columnOptions = useMemo(() => {
    const options = {} as Record<RegistrationColumnKey, string[]>;
    const rows = selectedEvent?.members || [];
    for (const col of REGISTRATION_COLUMNS) {
      options[col.key] = Array.from(new Set(rows.map((m: any) => col.getValue(m))));
    }
    return options;
  }, [selectedEvent]);

  const visibleRegistrations = (selectedEvent?.members || [])
    .filter((m: any) => {
      for (const col of REGISTRATION_COLUMNS) {
        const active = columnFilters[col.key];
        if (active.length > 0 && !active.includes(col.getValue(m))) return false;
      }
      if (!search.trim()) return true;
      const q = search.trim().toLowerCase();
      return [m.registrationNumber, m.name, m.email, m.phone, m.transactionNumber, m.membershipNumber, m.comments, m.heardAboutSource, m.heardAboutOther]
        .some((field: any) => String(field || "").toLowerCase().includes(q));
    })
    .sort((a: any, b: any) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (typeof av === "number" || typeof bv === "number") {
        const cmp = (Number(av) || 0) - (Number(bv) || 0);
        return sortDir === "asc" ? cmp : -cmp;
      }
      const cmp = String(av || "").toLowerCase().localeCompare(String(bv || "").toLowerCase(), undefined, { numeric: true });
      return sortDir === "asc" ? cmp : -cmp;
    });

  const toggleEventRow = (email: string) =>
    setSelectedEventRows((prev) =>
      prev.includes(email) ? prev.filter((e) => e !== email) : [...prev, email]
    );

  // ── Select-all (respects the current search/status filter — "all" means
  // "all currently visible rows", not every registration for the event) ───
  const selectAllRef = useRef<HTMLInputElement | null>(null);
  const visibleEmails = visibleRegistrations.map((m: any) => m.email);
  const allVisibleSelected = visibleEmails.length > 0 && visibleEmails.every((e) => selectedEventRows.includes(e));
  const someVisibleSelected = visibleEmails.some((e) => selectedEventRows.includes(e));

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = someVisibleSelected && !allVisibleSelected;
    }
  }, [someVisibleSelected, allVisibleSelected]);

  const toggleSelectAllVisible = () => {
    if (allVisibleSelected) {
      // Deselect only the currently-visible ones — a selection made under a
      // different filter (if any) is left alone.
      setSelectedEventRows((prev) => prev.filter((e) => !visibleEmails.includes(e)));
    } else {
      setSelectedEventRows((prev) => Array.from(new Set([...prev, ...visibleEmails])));
    }
  };

  // ── Excel export — sends exactly what's on screen (respecting filters),
  // or just the checkbox-selected rows, so the download always matches
  // what the admin is looking at. ──────────────────────────────────────────
  const [exporting, setExporting] = useState(false);
  const exportExcel = async (scope: "filtered" | "selected") => {
    const rows =
      scope === "selected"
        ? (selectedEvent?.members || []).filter((m: any) => selectedEventRows.includes(m.email))
        : visibleRegistrations;
    if (!rows.length) {
      toast({ title: "Nothing to export", description: "No registrations match this selection.", variant: "destructive" });
      return;
    }
    setExporting(true);
    try {
      const res = await fetch("/api/events/export-excel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventName: selectedEvent?.eventName,
          eventYear: selectedEvent?.eventYear,
          scope,
          rows,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.message || "Export failed");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${selectedEvent?.eventName || "event"}_${selectedEvent?.eventYear || ""}_${scope}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      toast({ title: "Export failed", description: err.message, variant: "destructive" });
    } finally {
      setExporting(false);
    }
  };

  // ── Individual attendees / QR check-in dialog ───────────────────────────
  const [attendeesDialogOpen, setAttendeesDialogOpen] = useState(false);
  const [attendeesFor, setAttendeesFor] = useState<any | null>(null);
  const [attendeesList, setAttendeesList] = useState<any[]>([]);
  const [loadingAttendees, setLoadingAttendees] = useState(false);

  const openAttendeesDialog = async (registration: any) => {
    setAttendeesFor(registration);
    setAttendeesDialogOpen(true);
    setLoadingAttendees(true);
    try {
      const data = await safeFetch(`/api/events/registration/${registration.id}/attendees`);
      setAttendeesList(Array.isArray(data) ? data : []);
    } finally {
      setLoadingAttendees(false);
    }
  };

  const manualCheckInAttendee = async (attendeeId: number) => {
    try {
      const res = await fetch(`/api/checkin/manual/reg:${attendeeId}`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Check-in failed");
      toast({ title: "Checked in" });
      if (attendeesFor) openAttendeesDialog(attendeesFor);
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

  // ── Bulk email ────────────────────────────────────────────────────────
  // "Selected" = checked rows, "filtered" = whatever the search/status
  // filters above currently show (e.g. set the Payment Status filter to
  // "Pending" and pick this to email every unpaid registrant at once),
  // "all" = every registrant for this event regardless of filters.
  const [emailDialogOpen, setEmailDialogOpen] = useState(false);
  const [emailAudience, setEmailAudience] = useState<"selected" | "filtered" | "all">("selected");
  const [emailTopic, setEmailTopic] = useState("");
  const [emailSubject, setEmailSubject] = useState("");
  const [emailMessage, setEmailMessage] = useState("");
  const [sendingEmail, setSendingEmail] = useState(false);
  const [generatingDraft, setGeneratingDraft] = useState(false);

  const audienceRecipients = () => {
    const source =
      emailAudience === "selected"
        ? (selectedEvent?.members || []).filter((m: any) => selectedEventRows.includes(m.email))
        : emailAudience === "filtered"
        ? visibleRegistrations
        : selectedEvent?.members || [];
    return source.map((m: any) => ({
      email: m.email,
      name: m.name,
      membershipNumber: m.membershipNumber || null,
      fee: m.fee,
      paymentAmount: m.paymentAmount,
    }));
  };

  const openEmailDialog = () => {
    // Default to "selected" only if rows are actually checked, otherwise
    // fall back to whatever the current filter shows (e.g. Pending only),
    // since that's the common case for chasing unpaid registrations.
    setEmailAudience(selectedEventRows.length > 0 ? "selected" : "filtered");
    setEmailTopic("");
    setEmailSubject("");
    setEmailMessage("");
    setEmailDialogOpen(true);
  };

  const generateDraft = async () => {
    if (!emailTopic.trim()) {
      toast({
        title: "Describe the email first",
        description: "Type a quick topic or brief, e.g. \"reminder that payment is still pending\".",
        variant: "destructive",
      });
      return;
    }

    setGeneratingDraft(true);
    try {
      const res = await fetch("/api/members/generate-email-draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: emailTopic }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Couldn't generate a draft.");
      setEmailSubject(data.subject || "");
      setEmailMessage(data.message || "");
      toast({ title: "Draft ready", description: "Review it below and edit anything before sending." });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setGeneratingDraft(false);
    }
  };

  const sendBulkEmail = async () => {
    if (!emailSubject.trim() || !emailMessage.trim()) {
      toast({
        title: "Subject and message required",
        description: "Please fill in both the subject and message before sending.",
        variant: "destructive",
      });
      return;
    }

    const recipients = audienceRecipients();
    if (recipients.length === 0) {
      toast({
        title: "No recipients",
        description: "No registrants match this audience — pick another option.",
        variant: "destructive",
      });
      return;
    }

    setSendingEmail(true);
    try {
      const res = await fetch("/api/events/send-bulk-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventName: selectedEvent?.eventName,
          eventYear: selectedEvent?.eventYear,
          subject: emailSubject,
          message: emailMessage,
          recipients,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Couldn't send the email.");
      const firstError = data.failures?.[0]?.error;
      const description = data.failed && firstError ? `${data.message} Reason: ${firstError}` : data.message;
      toast({
        title: data.failed ? "Sent with some failures" : "Email sent",
        description,
        variant: data.failed ? "destructive" : "default",
      });
      if (!data.failed) setEmailDialogOpen(false);
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setSendingEmail(false);
    }
  };

  const deleteEventRows = async () => {
    try {
      const res = await fetch("/api/events/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventName: selectedEvent?.eventName,
          eventYear: selectedEvent?.eventYear,
          emails: selectedEventRows,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Delete failed");
      setEventActionMessage(`✅ ${data.message || "Deleted successfully"}`);
      setSelectedEventRows([]);
      onReload();
    } catch (err: any) {
      setEventActionMessage(`❌ ${err.message}`);
    }
  };

  return (
    <div>
      {/* ── Event selector ── */}
      <div className="mb-6 max-w-md">
        <label className="text-sm font-medium">Select Event</label>
        <p className="text-xs text-muted-foreground mt-1">
          {Object.keys(groupedEvents).length === 0
            ? "⚠️ No events loaded — check console for errors"
            : `${Object.keys(groupedEvents).length} event(s) loaded`}
        </p>

        <select
          className="w-full mt-2 p-2 border rounded text-foreground bg-background"
          value={selectedEventKey}
          onChange={(e) => {
            setSelectedEventKey(e.target.value);
            setSelectedEventRows([]);
            setEditingEvent(null);
            setEventActionMessage("");
            setSearch("");
            setColumnFilters(emptyRegistrationFilters());
            const first = groupedEvents[e.target.value]?.[0];
            fetchLatestReconciliation(first?.eventName, first?.eventYear);
          }}
        >
          <option value="">-- Choose Event --</option>
          {Object.entries(groupedEvents).map(([key, events]: any) => {
            const first = events?.[0];
            if (!first) return null;
            return (
              <option key={key} value={key}>
                {first.eventName} {first.eventYear}
              </option>
            );
          })}
        </select>

        <Button variant="outline" size="sm" className="mt-2" onClick={onReload}>
          🔄 Reload Events
        </Button>
      </div>

      {/* ── Event table ── */}
      {selectedEvent?.members?.length > 0 && (
        <Card className="mb-6">
          <CardContent className="p-6">
            <div className="flex flex-wrap justify-between items-start gap-3 mb-4">
              <div>
                <h2 className="text-xl font-bold">
                  {selectedEvent.eventName} {selectedEvent.eventYear}
                </h2>
                <div className="flex gap-4 text-sm text-muted-foreground mt-1 flex-wrap">
                  <span>Total People: {selectedEvent.totalPeople}</span>
                  <span>👨 Adults: {selectedEvent.adults}</span>
                  <span>🧒 Children: {selectedEvent.children}</span>
                  <span>💰 Fees Collected: ${selectedEvent.totalFees}</span>
                </div>
              </div>
              <div className="flex gap-2 flex-wrap items-center">
                <Button variant="outline" onClick={openEmailDialog} disabled={!selectedEvent?.members?.length}>
                  ✉️ Send Email
                </Button>
                <input
                  ref={bankStatementInputRef}
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  className="hidden"
                  onChange={handleBankStatementSelected}
                />
                <Button variant="outline" onClick={triggerBankStatementUpload} disabled={reconciling}>
                  {reconciling ? "Reconciling..." : "🏦 Upload Bank Statement"}
                </Button>
                {bankFeed?.connected && (
                  <Button
                    variant="outline"
                    onClick={syncFromBank}
                    disabled={syncingBank}
                    title={bankFeed.lastSync?.at ? `Last synced ${new Date(bankFeed.lastSync.at).toLocaleString("en-AU")}` : "Not synced yet"}
                  >
                    {syncingBank ? "Syncing..." : "🔄 Sync from Bank"}
                  </Button>
                )}

                {latestReconciliation?.reconciliationId && (
                  <Button
                    variant="outline"
                    onClick={() => downloadReconciliationReport(latestReconciliation.reconciliationId)}
                  >
                    📊 Download Reconciliation Report
                  </Button>
                )}
                <Button
                  onClick={() =>
                    downloadCSV(
                      selectedEvent?.members || [],
                      `${selectedEvent?.eventName || "event"}_${selectedEvent?.eventYear || "unknown"}.csv`
                    )
                  }
                >
                  Download CSV
                </Button>
                <Button
                  variant="outline"
                  onClick={() => exportExcel("filtered")}
                  disabled={exporting}
                  title="Downloads exactly the rows currently shown by your search/filter above"
                >
                  {exporting ? "Exporting..." : "📥 Export Filtered (Excel)"}
                </Button>
                {selectedEventRows.length > 0 && (
                  <Button
                    variant="outline"
                    onClick={() => exportExcel("selected")}
                    disabled={exporting}
                    title="Downloads only the checkbox-selected rows below"
                  >
                    {exporting ? "Exporting..." : `📥 Export Selected (${selectedEventRows.length})`}
                  </Button>
                )}
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex gap-2 mb-3">
              {selectedEventRows.length > 0 && (
                <Button variant="destructive" onClick={deleteEventRows}>
                  Delete Selected
                </Button>
              )}
              <Button
                onClick={() => {
                  if (!selectedEventRows.length) return;
                  const member = selectedEvent?.members.find(
                    (m: any) => m.email === selectedEventRows[0]
                  );
                  if (!member) return;
                  setEditingEvent({ ...member });

                  // Scroll to and flash the edit panel so it's obvious it opened.
                  setJustOpened(true);
                  setTimeout(() => {
                    editPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
                  }, 50);
                  setTimeout(() => setJustOpened(false), 1200);
                }}
                disabled={selectedEventRows.length !== 1}
              >
                Modify Selected
              </Button>
            </div>

            {eventActionMessage && (
              <div className="mt-3 text-sm font-medium text-blue-600">
                {eventActionMessage}
              </div>
            )}

            <div className="flex flex-wrap gap-2 mb-3 mt-3">
              <Input
                placeholder="Search by name, email, phone, transaction no, membership no, comments..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="max-w-sm"
              />
              {(search.trim() || anyColumnFilterActive) && (
                <Button
                  variant="ghost"
                  onClick={() => {
                    setSearch("");
                    setColumnFilters(emptyRegistrationFilters());
                  }}
                >
                  Clear filters
                </Button>
              )}
              {(search.trim() || anyColumnFilterActive) && (
                <span className="text-sm text-muted-foreground self-center">
                  Showing {visibleRegistrations.length} of {selectedEvent.members.length}
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground -mt-2 mb-3">
              Use the funnel icon in each column header below to filter by that field (each has its own search box).
            </p>

            {/* Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="p-2">
                      <input
                        ref={selectAllRef}
                        type="checkbox"
                        checked={allVisibleSelected}
                        onChange={toggleSelectAllVisible}
                        title="Select all currently shown rows"
                      />
                    </th>
                    {(
                      [
                        "registrationNumber", "name", "email", "phone", "adults", "children",
                        "fee", "paymentStatus", "paymentAmount", "paymentDate",
                        "transactionNumber", "membershipNumber",
                      ] as RegistrationColumnKey[]
                    ).map((key) => {
                      const col = REGISTRATION_COLUMNS.find((c) => c.key === key)!;
                      const sortableKey = key as typeof sortKey;
                      return (
                        <th key={key} className="p-2 text-left">
                          <ColumnFilterHeader
                            label={col.label}
                            filterable={!UNIQUE_VALUE_COLUMNS.includes(key)}
                            options={columnOptions[key] || []}
                            selected={columnFilters[key]}
                            onChange={(values) => setColumnFilter(key, values)}
                            sortDir={sortKey === sortableKey ? sortDir : null}
                            onSortClick={() => toggleSort(sortableKey)}
                          />
                        </th>
                      );
                    })}
                    {(
                      [
                        "registrationStatus", "paymentMethod", "paymentMatchConfidence",
                        "heardAbout", "comments",
                      ] as RegistrationColumnKey[]
                    ).map((key) => {
                      const col = REGISTRATION_COLUMNS.find((c) => c.key === key)!;
                      return (
                        <th key={key} className="p-2 text-left">
                          <ColumnFilterHeader
                            label={col.label}
                            filterable={!UNIQUE_VALUE_COLUMNS.includes(key)}
                            options={columnOptions[key] || []}
                            selected={columnFilters[key]}
                            onChange={(values) => setColumnFilter(key, values)}
                          />
                        </th>
                      );
                    })}
                    <th className="p-2 text-left">Attendees / QR</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRegistrations.map((item, i) => (
                    <tr key={i} className="border-b">
                      <td className="p-2">
                        <input
                          type="checkbox"
                          checked={selectedEventRows.includes(item.email)}
                          onChange={() => toggleEventRow(item.email)}
                        />
                      </td>
                      <td className="p-2">{item.registrationNumber || "-"}</td>
                      <td className="p-2">{item.name}</td>
                      <td className="p-2">{item.email}</td>
                      <td className="p-2">{item.phone}</td>
                      <td className="p-2">{item.adults}</td>
                      <td className="p-2">
                        {item.children}
                        {(item.childrenUnder5 > 0 || item.children5Plus > 0) && (
                          <span className="text-muted-foreground text-xs block whitespace-nowrap">
                            ({item.childrenUnder5 || 0} under 5, {item.children5Plus ?? item.children} 5+)
                          </span>
                        )}
                      </td>
                      <td className="p-2">{typeof item.fee === "number" ? `$${item.fee}` : "-"}</td>
                      <td className="p-2">
                        {item.paymentStatus === "Paid" ? (
                          <span className="text-green-700 font-medium">Paid</span>
                        ) : item.paymentStatus === "Pending" ? (
                          <span className="text-orange-600 font-medium">Pending</span>
                        ) : (
                          <span className="text-muted-foreground">{item.paymentStatus || "N/A"}</span>
                        )}
                      </td>
                      <td className="p-2">
                        {typeof item.paymentAmount === "number" && item.paymentAmount > 0
                          ? `$${item.paymentAmount}`
                          : "-"}
                      </td>
                      <td className="p-2 whitespace-nowrap">
                        {item.paymentDate ? new Date(item.paymentDate).toLocaleDateString("en-AU") : "-"}
                      </td>
                      <td className="p-2 font-mono">{item.transactionNumber || "-"}</td>
                      <td className="p-2">{item.membershipNumber || "-"}</td>
                      <td className="p-2">
                        {item.registrationStatus === "confirmed" ? (
                          <span className="text-green-700 font-medium">Confirmed</span>
                        ) : item.registrationStatus === "pending_payment" ? (
                          <span className="text-orange-600 font-medium">Pending Payment</span>
                        ) : item.registrationStatus === "payment_failed" ? (
                          <span className="text-red-600 font-medium">Payment Failed</span>
                        ) : item.registrationStatus === "cancelled" ? (
                          <span className="text-muted-foreground">Cancelled</span>
                        ) : (
                          <span className="text-muted-foreground">{item.registrationStatus || "-"}</span>
                        )}
                      </td>
                      <td className="p-2 whitespace-nowrap">
                        {item.paymentMethod === "card"
                          ? "💳 Card"
                          : item.paymentMethod === "bank_transfer"
                          ? "🏦 Bank Transfer"
                          : item.paymentMethod === "coupon"
                          ? `🎟️ Coupon${item.couponCode ? ` (${item.couponCode})` : ""}`
                          : "-"}
                      </td>
                      <td className="p-2">
                        {item.paymentMatchConfidence ? (
                          <span
                            className={
                              item.paymentMatchConfidence === "High"
                                ? "text-green-700"
                                : item.paymentMatchConfidence === "Medium"
                                ? "text-orange-600"
                                : "text-red-600"
                            }
                            title={item.paymentMatchNote || ""}
                          >
                            {item.paymentMatchConfidence}
                          </span>
                        ) : (
                          "-"
                        )}
                      </td>
                      <td className="p-2">
                        {item.heardAboutSource
                          ? item.heardAboutSource === "Other" && item.heardAboutOther
                            ? `Other: ${item.heardAboutOther}`
                            : item.heardAboutSource
                          : "-"}
                      </td>
                      <td className="p-2">{item.comments || "-"}</td>
                      <td className="p-2">
                        <Button size="sm" variant="outline" onClick={() => openAttendeesDialog(item)}>
                          🪪 Attendees
                        </Button>
                      </td>
                    </tr>
                  ))}
                  {visibleRegistrations.length === 0 && (
                    <tr>
                      <td colSpan={19} className="p-4 text-center text-muted-foreground">
                        No registrations match your search/filter.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Edit form */}
            {editingEvent && (
              <Card
                ref={editPanelRef}
                className={`mt-4 transition-shadow duration-300 ${
                  justOpened ? "ring-4 ring-primary ring-offset-2 shadow-lg" : ""
                }`}
              >
                <CardContent className="p-4 space-y-3">
                  <h3 className="font-bold">Edit Registration</h3>
                  <Input
                    placeholder="Name"
                    value={editingEvent.name}
                    onChange={(e) => setEditingEvent({ ...editingEvent, name: e.target.value })}
                  />
                  <Input
                    placeholder="Phone"
                    value={editingEvent.phone}
                    onChange={(e) => setEditingEvent({ ...editingEvent, phone: e.target.value })}
                  />
                  <Input
                    type="number"
                    placeholder="Adults"
                    value={editingEvent.adults}
                    onChange={(e) => setEditingEvent({ ...editingEvent, adults: e.target.value })}
                  />
                  <Input
                    type="number"
                    placeholder="Children"
                    value={editingEvent.children}
                    onChange={(e) => setEditingEvent({ ...editingEvent, children: e.target.value })}
                  />
                  <Input
                    type="number"
                    placeholder="Fee"
                    value={editingEvent.fee ?? 0}
                    onChange={(e) => setEditingEvent({ ...editingEvent, fee: e.target.value })}
                  />

                  <div>
                    <label className="text-sm font-medium block mb-1">
                      Transaction / Reference Number
                    </label>
                    <Input
                      placeholder="e.g. TXN123456789 — from the bank transfer"
                      value={editingEvent.transactionNumber || ""}
                      onChange={(e) =>
                        setEditingEvent({ ...editingEvent, transactionNumber: e.target.value })
                      }
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      Required before this registration can be marked Paid — leave blank while
                      payment is still Pending.
                    </p>
                  </div>

                  <div>
                    <label className="text-sm font-medium block mb-1">Payment Status</label>
                    <select
                      className="w-full p-2 border rounded text-foreground bg-background"
                      value={editingEvent.paymentStatus || "N/A"}
                      onChange={(e) => setEditingEvent({ ...editingEvent, paymentStatus: e.target.value })}
                    >
                      <option value="N/A">N/A (no fee)</option>
                      <option value="Pending">Pending</option>
                      <option value="Paid">Paid</option>
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-sm font-medium block mb-1">Amount Paid</label>
                      <Input
                        type="number"
                        placeholder="0"
                        value={editingEvent.paymentAmount ?? ""}
                        onChange={(e) => setEditingEvent({ ...editingEvent, paymentAmount: e.target.value })}
                      />
                    </div>
                    <div>
                      <label className="text-sm font-medium block mb-1">Date Paid</label>
                      <Input
                        type="date"
                        value={editingEvent.paymentDate ? String(editingEvent.paymentDate).slice(0, 10) : ""}
                        onChange={(e) => setEditingEvent({ ...editingEvent, paymentDate: e.target.value })}
                      />
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground -mt-2">
                    Usually filled in automatically by "Upload Bank Statement" — edit here only to correct a match.
                  </p>
                  <Input
                    placeholder="Comments"
                    value={editingEvent.comments || ""}
                    onChange={(e) => setEditingEvent({ ...editingEvent, comments: e.target.value })}
                  />
                  <div className="flex gap-2">
                    <Button
                      onClick={async () => {
                        if (
                          editingEvent.paymentStatus === "Paid" &&
                          !String(editingEvent.transactionNumber || "").trim()
                        ) {
                          toast({
                            title: "Transaction number required",
                            description:
                              "Enter the bank transfer transaction number before marking this registration Paid.",
                            variant: "destructive",
                          });
                          return;
                        }

                        try {
                          const res = await fetch("/api/events/update", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                              eventName: selectedEvent?.eventName,
                              eventYear: selectedEvent?.eventYear,
                              email: editingEvent.email,
                              updatedData: {
                                ...editingEvent,
                                adults: Number(editingEvent.adults),
                                children: Number(editingEvent.children),
                                fee: Number(editingEvent.fee) || 0,
                                transactionNumber: String(editingEvent.transactionNumber || "").trim(),
                                paymentAmount:
                                  editingEvent.paymentAmount === "" || editingEvent.paymentAmount === null
                                    ? null
                                    : Number(editingEvent.paymentAmount),
                                paymentDate: editingEvent.paymentDate || null,
                              },
                            }),
                          });
                          const data = await res.json();
                          if (!res.ok) throw new Error(data.message || "Update failed");
                          toast({ title: "Success 🎉", description: data.message || "Updated successfully" });
                          setEditingEvent(null);
                          setSelectedEventRows([]);
                          onReload();
                        } catch (err: any) {
                          toast({ title: "Error", description: err.message, variant: "destructive" });
                        }
                      }}
                    >
                      Save Changes
                    </Button>
                    <Button variant="outline" onClick={() => setEditingEvent(null)}>
                      Cancel
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}
          </CardContent>
        </Card>
      )}

      <Dialog open={emailDialogOpen} onOpenChange={setEmailDialogOpen}>
        <DialogContent className="sm:max-w-lg max-h-[85vh] flex flex-col gap-0 p-0 overflow-hidden">
          <DialogHeader className="p-6 pb-4 shrink-0">
            <DialogTitle>Send Bulk Email</DialogTitle>
            <DialogDescription>
              Compose a message to send to registrants of {selectedEvent?.eventName} {selectedEvent?.eventYear}.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 overflow-y-auto px-6 py-1 min-h-0">
            <div>
              <Label className="text-xs font-medium text-muted-foreground">Recipients</Label>
              <RadioGroup
                value={emailAudience}
                onValueChange={(value) => setEmailAudience(value as "selected" | "filtered" | "all")}
                className="mt-2 space-y-2"
              >
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="selected" id="ev-audience-selected" disabled={selectedEventRows.length === 0} />
                  <Label htmlFor="ev-audience-selected" className="font-normal cursor-pointer">
                    Selected rows ({selectedEventRows.length} selected)
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="filtered" id="ev-audience-filtered" />
                  <Label htmlFor="ev-audience-filtered" className="font-normal cursor-pointer">
                    Everyone matching current filter ({visibleRegistrations.length})
                    {anyColumnFilterActive ? " — column filters active" : ""}
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="all" id="ev-audience-all" />
                  <Label htmlFor="ev-audience-all" className="font-normal cursor-pointer">
                    All registrants ({selectedEvent?.members?.length || 0} total)
                  </Label>
                </div>
              </RadioGroup>
              <p className="text-xs text-muted-foreground mt-2">
                Tip: to email everyone with a pending payment, set the "Payment Status" filter above
                to Pending, then choose "Everyone matching current filter".
              </p>
            </div>

            <div>
              <Label className="text-xs font-medium text-muted-foreground">
                What's this email about? <span className="font-normal">(optional — for AI drafting)</span>
              </Label>
              <div className="flex gap-2 mt-1">
                <Input
                  value={emailTopic}
                  onChange={(e) => setEmailTopic(e.target.value)}
                  placeholder="e.g. Reminder that event payment is still pending"
                />
                <Button type="button" variant="secondary" onClick={generateDraft} disabled={generatingDraft}>
                  {generatingDraft ? "Writing..." : "✨ Generate"}
                </Button>
              </div>
            </div>

            <div>
              <Label className="text-xs font-medium text-muted-foreground">Subject</Label>
              <Input
                value={emailSubject}
                onChange={(e) => setEmailSubject(e.target.value)}
                placeholder="e.g. Payment Reminder — Kutumb Utsav"
              />
            </div>

            <div>
              <Label className="text-xs font-medium text-muted-foreground">Message</Label>
              <Textarea
                value={emailMessage}
                onChange={(e) => setEmailMessage(e.target.value)}
                placeholder="Write your message here, or generate a draft above..."
                rows={6}
                className="min-h-[100px] resize-y"
              />
            </div>
          </div>

          <DialogFooter className="p-6 pt-4 shrink-0 border-t">
            <Button variant="outline" onClick={() => setEmailDialogOpen(false)} disabled={sendingEmail}>
              Cancel
            </Button>
            <Button onClick={sendBulkEmail} disabled={sendingEmail}>
              {sendingEmail ? "Sending..." : `Send to ${audienceRecipients().length}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={reconcileResultOpen} onOpenChange={setReconcileResultOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[85vh] flex flex-col gap-0 p-0 overflow-hidden">
          <DialogHeader className="p-6 pb-4 shrink-0">
            <DialogTitle>Reconciliation Results</DialogTitle>
            <DialogDescription>
              {reconcileResult?.message}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 overflow-y-auto px-6 py-1 min-h-0">
            {reconcileResult?.summary && (
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-md border p-3">
                  <div className="text-muted-foreground text-xs">Newly marked Paid</div>
                  <div className="text-lg font-semibold text-green-700">{reconcileResult.summary.newlyMatched}</div>
                </div>
                <div className="rounded-md border p-3">
                  <div className="text-muted-foreground text-xs">Still unpaid</div>
                  <div className="text-lg font-semibold text-orange-600">{reconcileResult.summary.stillUnpaid}</div>
                </div>
                <div className="rounded-md border p-3">
                  <div className="text-muted-foreground text-xs">Amount matched</div>
                  <div className="text-lg font-semibold">${reconcileResult.summary.amountMatched}</div>
                </div>
                <div className="rounded-md border p-3">
                  <div className="text-muted-foreground text-xs">Unmatched bank credits</div>
                  <div className="text-lg font-semibold">
                    {reconcileResult.summary.unmatchedCreditsCount} (${reconcileResult.summary.unmatchedCreditsValue})
                  </div>
                </div>
              </div>
            )}

            {reconcileResult?.updated?.length > 0 && (
              <div>
                <h4 className="text-sm font-medium mb-2">Registrations newly matched</h4>
                <div className="max-h-40 overflow-y-auto border rounded-md">
                  <table className="w-full text-xs">
                    <tbody>
                      {reconcileResult.updated.map((u: any, i: number) => (
                        <tr key={i} className="border-b last:border-0">
                          <td className="p-2">{u.name}</td>
                          <td className="p-2">${u.amount}</td>
                          <td className="p-2">{u.confidence}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {reconcileResult?.unmatchedCredits?.length > 0 && (
              <div>
                <h4 className="text-sm font-medium mb-2">
                  Bank credits that couldn't be matched to a registration
                </h4>
                <div className="max-h-40 overflow-y-auto border rounded-md">
                  <table className="w-full text-xs">
                    <tbody>
                      {reconcileResult.unmatchedCredits.map((u: any, i: number) => (
                        <tr key={i} className="border-b last:border-0">
                          <td className="p-2 whitespace-nowrap">
                            {u.date ? new Date(u.date).toLocaleDateString("en-AU") : "-"}
                          </td>
                          <td className="p-2">${u.amount}</td>
                          <td className="p-2 text-muted-foreground">{u.classification}</td>
                          <td className="p-2 truncate max-w-[220px]" title={u.details}>{u.details}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  These are in the downloadable report too, with suggested follow-up for each.
                </p>
              </div>
            )}
          </div>

          <DialogFooter className="p-6 pt-4 shrink-0 border-t">
            <Button variant="outline" onClick={() => setReconcileResultOpen(false)}>
              Close
            </Button>
            {reconcileResult?.reconciliationId && (
              <Button onClick={() => downloadReconciliationReport(reconcileResult.reconciliationId)}>
                📊 Download Excel Report
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Individual Attendees / QR Check-in ── */}
      <Dialog open={attendeesDialogOpen} onOpenChange={setAttendeesDialogOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[85vh] flex flex-col gap-0 p-0 overflow-hidden">
          <DialogHeader className="p-6 pb-4 shrink-0">
            <DialogTitle>Attendees — {attendeesFor?.name}</DialogTitle>
            <DialogDescription>
              Registration {attendeesFor?.registrationNumber} for {attendeesFor?.eventName || selectedEvent?.eventName}.
              Each person below has their own QR code and independent check-in status.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 overflow-y-auto px-6 py-1 min-h-0">
            {loadingAttendees && <p className="text-sm text-muted-foreground">Loading attendees...</p>}

            {!loadingAttendees && attendeesList.length === 0 && (
              <p className="text-sm text-muted-foreground">No individual attendee records yet for this registration.</p>
            )}

            {!loadingAttendees &&
              attendeesList.map((a) => (
                <div key={a.id} className="flex items-center gap-4 border rounded-lg p-3">
                  <img
                    src={a.qrCode}
                    alt={`QR code for ${a.name}`}
                    className="w-[72px] h-[72px] rounded border bg-white shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium">{a.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {a.category === "primary_adult"
                        ? "Primary Registrant"
                        : a.category === "adult"
                        ? "Additional Adult"
                        : a.category === "child_under5"
                        ? "Child (Under 5)"
                        : "Child (5+)"}
                    </p>
                    <p className="text-xs font-mono text-muted-foreground break-all mt-1">{a.qrToken}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    {a.checkedInAt ? (
                      <p className="text-xs text-green-700 font-medium whitespace-nowrap">
                        ✅ Checked in
                        <br />
                        {new Date(a.checkedInAt).toLocaleString("en-AU")}
                        {a.checkedInBy && (
                          <>
                            <br />
                            <span className="font-normal text-muted-foreground">
                              by {a.checkedInBy}
                              {a.checkedInCode ? ` (code ${a.checkedInCode})` : ""}
                            </span>
                          </>
                        )}
                      </p>
                    ) : (
                      <Button size="sm" onClick={() => manualCheckInAttendee(a.id)}>
                        Check in
                      </Button>
                    )}
                  </div>
                </div>
              ))}
          </div>

          <DialogFooter className="p-6 pt-4 shrink-0 border-t">
            <Button variant="outline" onClick={() => setAttendeesDialogOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
};

export default EventRegistration;
