import { useEffect, useRef, useState } from "react";
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
  if (!res.ok) {
    const err: any = new Error(data?.message || "Request failed");
    err.canOverride = !!data?.canOverride;
    throw err;
  }
  return data;
}

const slugify = (t: string) => t?.toLowerCase().trim().replace(/\s+/g, "-").replace(/[^\w-]+/g, "");

interface CheckInProps {
  groupedEvents: Record<string, any[]>;
}

export default function CheckIn({ groupedEvents }: CheckInProps) {
  const { toast } = useToast();
  const [eventId, setEventId] = useState("");
  const [attendees, setAttendees] = useState<any[]>([]);
  const [search, setSearch] = useState("");
  const [tokenInput, setTokenInput] = useState("");
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const scannerRef = useRef<any>(null);
  const lastScanRef = useRef<{ token: string; at: number } | null>(null);

  // ── Temporary check-in login codes ───────────────────────────────────
  // date_text lives on kutumb_upcoming_events, not on the registration rows
  // groupedEvents is built from — so it's fetched separately here, purely
  // to work out when a generated code should expire (end of the event day).
  const [upcomingEvents, setUpcomingEvents] = useState<any[]>([]);
  const [generatingCodes, setGeneratingCodes] = useState(false);
  const [generatedCodes, setGeneratedCodes] = useState<{ codes: string[]; expiresAt: string; emailSent: boolean } | null>(null);

  // ── Existing code batches (management table) ────────────────────────
  interface CodeBatch {
    event_name: string;
    event_year: string | null;
    event_date_text: string | null;
    expires_at: string;
    generated_at: string;
    codes: string[];
    code_details?: { code: string; used_at: string | null; used_by_name: string | null }[];
  }
  const [codeBatches, setCodeBatches] = useState<CodeBatch[]>([]);
  const [loadingBatches, setLoadingBatches] = useState(false);
  const [editingBatch, setEditingBatch] = useState<string | null>(null); // key = event_name + "|" + event_year
  const [editExpiresAt, setEditExpiresAt] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const [deletingBatch, setDeletingBatch] = useState<string | null>(null);

  const batchKey = (b: CodeBatch) => `${b.event_name}|${b.event_year || ""}`;

  const loadCodeBatches = async () => {
    setLoadingBatches(true);
    try {
      const data = await api("/api/checkin/codes");
      setCodeBatches(data);
    } catch (err: any) {
      toast({ title: "Couldn't load check-in codes", description: err.message, variant: "destructive" });
    } finally {
      setLoadingBatches(false);
    }
  };

  // Ticks every 15s purely so the table below re-evaluates which batches
  // have expired and drops them from view the moment their clock runs out,
  // without waiting on a manual refresh. The rows are actually deleted from
  // the database by the periodic server-side sweep (see
  // cleanupExpiredCheckinCodes in registrationScheduler.js) and, failing
  // that, the moment anyone tries to redeem an expired code — this is just
  // about hiding a stale row from the admin's screen promptly.
  const [nowTick, setNowTick] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNowTick(Date.now()), 15_000);
    return () => clearInterval(t);
  }, []);

  // Also re-pull the batch list periodically so newly-generated codes (from
  // another admin, say) and rows the server has already cleaned up both
  // stay in sync without the admin needing to click Refresh.
  useEffect(() => {
    const t = setInterval(() => loadCodeBatches(), 60_000);
    return () => clearInterval(t);
  }, []);

  const visibleCodeBatches = codeBatches.filter((b) => new Date(b.expires_at).getTime() > nowTick);

  useEffect(() => {
    fetch("/api/upcoming-events").then((r) => r.json()).then(setUpcomingEvents).catch(() => {});
    loadCodeBatches();
  }, []);

  const startEditBatch = (b: CodeBatch) => {
    setEditingBatch(batchKey(b));
    // Format the ISO expiry as the value a <input type="datetime-local"> expects (local time, no seconds/zone).
    const d = new Date(b.expires_at);
    const pad = (n: number) => String(n).padStart(2, "0");
    setEditExpiresAt(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`);
  };

  const cancelEditBatch = () => {
    setEditingBatch(null);
    setEditExpiresAt("");
  };

  const saveEditBatch = async (b: CodeBatch) => {
    if (!editExpiresAt) return;
    setSavingEdit(true);
    try {
      await api("/api/checkin/codes/update-expiry", {
        method: "PUT",
        body: JSON.stringify({ eventName: b.event_name, eventYear: b.event_year, expiresAt: new Date(editExpiresAt).toISOString() }),
      });
      toast({ title: "Expiry updated" });
      cancelEditBatch();
      loadCodeBatches();
    } catch (err: any) {
      toast({ title: "Couldn't update expiry", description: err.message, variant: "destructive" });
    } finally {
      setSavingEdit(false);
    }
  };

  const deleteBatch = async (b: CodeBatch) => {
    if (!window.confirm(`Delete all ${b.codes.length} check-in codes for "${b.event_name}"? Door volunteers using them will be logged out immediately.`)) return;
    setDeletingBatch(batchKey(b));
    try {
      await api("/api/checkin/codes/delete", {
        method: "POST",
        body: JSON.stringify({ eventName: b.event_name, eventYear: b.event_year }),
      });
      toast({ title: "Codes deleted" });
      loadCodeBatches();
    } catch (err: any) {
      toast({ title: "Couldn't delete codes", description: err.message, variant: "destructive" });
    } finally {
      setDeletingBatch(null);
    }
  };

  const eventOptions = Array.from(
    new Set(Object.values(groupedEvents).map((rows: any) => rows[0]?.eventName).filter(Boolean))
  );

  const selectedEventRows = Object.values(groupedEvents).find((rows: any) => rows[0]?.eventName === eventId) as any[] | undefined;
  const selectedEventYear = selectedEventRows?.[0]?.eventYear;
  const selectedEventDateText = upcomingEvents.find((e) => e.title === eventId)?.date;

  const generateCodes = async () => {
    if (!eventId) return;
    setGeneratingCodes(true);
    setGeneratedCodes(null);
    try {
      const data = await api("/api/checkin/generate-codes", {
        method: "POST",
        body: JSON.stringify({ eventName: eventId, eventYear: selectedEventYear, eventDateText: selectedEventDateText }),
      });
      setGeneratedCodes(data);
      toast({
        title: "5 check-in codes generated",
        description: data.emailSent ? "Emailed to info@kutumb.org.au." : "Could not send the email — copy the codes below manually.",
      });
      loadCodeBatches();
    } catch (err: any) {
      toast({ title: "Couldn't generate codes", description: err.message, variant: "destructive" });
    } finally {
      setGeneratingCodes(false);
    }
  };

  const load = async (id: string) => {
    if (!id) return;
    const data = await api(`/api/checkin/${slugify(id)}/attendees`).catch(() => []);
    setAttendees(data);
  };

  useEffect(() => { if (eventId) load(eventId); }, [eventId]);

  const scan = async (qrToken: string, override = false) => {
    try {
      const result = await api("/api/checkin/scan", { method: "POST", body: JSON.stringify({ qrToken, override }) });
      toast({ title: "✅ Checked in", description: result.attendee?.name || result.attendee?.email });
      setTokenInput("");
      load(eventId);
    } catch (err: any) {
      // 409 = already checked in — offer an explicit override instead of
      // silently failing, so a genuine duplicate scan can still be
      // deliberately confirmed by an authorised admin.
      if (err.canOverride || /already checked in/i.test(err.message || "")) {
        toast({
          title: "Already checked in",
          description: `${err.message} — scan again within 10s to override, or use the list below.`,
          variant: "destructive",
        });
        return;
      }
      toast({ title: "Check-in failed", description: err.message, variant: "destructive" });
    }
  };

  // A second scan of the SAME token within 10 seconds is treated as a
  // deliberate override (e.g. staff scanning twice on purpose to correct a
  // mistake); any other token always starts fresh.
  const handleDecodedToken = (token: string) => {
    const now = Date.now();
    const isRepeat = lastScanRef.current?.token === token && now - lastScanRef.current.at < 10000;
    lastScanRef.current = { token, at: now };
    scan(token, isRepeat);
  };

  const manualCheckIn = async (id: string | number) => {
    try {
      await api(`/api/checkin/manual/${id}`, { method: "POST" });
      toast({ title: "Checked in" });
      load(eventId);
    } catch (err: any) {
      // 409 here means someone else (another admin, or this same click
      // firing twice) already checked this person in a moment ago — the
      // list was just stale. Refresh it so the row reflects reality
      // instead of leaving a "Check in" button visible for someone who's
      // already through the door.
      if (err.canOverride || /already checked in/i.test(err.message || "")) {
        toast({ title: "Already checked in", description: err.message });
        load(eventId);
        return;
      }
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

  // ── Camera scanning (html5-qrcode) — starts/stops the device camera only
  // while the scanner panel is open, and is fully optional: staff can
  // always fall back to typing/pasting the token below instead. ──────────
  useEffect(() => {
    if (!cameraOpen) return;
    let cancelled = false;
    setCameraError("");

    (async () => {
      try {
        const { Html5Qrcode } = await import("html5-qrcode");
        if (cancelled) return;
        const scanner = new Html5Qrcode("qr-camera-reader");
        scannerRef.current = scanner;
        await scanner.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: 250 },
          (decodedText: string) => handleDecodedToken(decodedText),
          () => {} // per-frame "no QR found yet" — ignored, not an error
        );
      } catch (err: any) {
        if (!cancelled) setCameraError(err?.message || "Could not access the camera");
      }
    })();

    return () => {
      cancelled = true;
      const scanner = scannerRef.current;
      if (scanner) {
        scanner.stop().then(() => scanner.clear()).catch(() => {});
        scannerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraOpen, eventId]);

  const filtered = attendees.filter(
    (a) => !search || a.name?.toLowerCase().includes(search.toLowerCase()) || a.email?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div className="max-w-md">
        <Label>Event</Label>
        <select
          className="w-full mt-1 p-2 border rounded text-foreground bg-background"
          value={eventId}
          onChange={(e) => setEventId(e.target.value)}
        >
          <option value="">-- Choose an event --</option>
          {eventOptions.map((name) => <option key={name} value={name}>{name}</option>)}
        </select>
        <Input className="mt-2" placeholder="Or type event id / name" value={eventId} onChange={(e) => setEventId(e.target.value)} />
      </div>

      {eventId && (
        <>
          <div className="border rounded-lg p-4 max-w-lg space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div>
                <Label>Door volunteer login codes</Label>
                <p className="text-xs text-muted-foreground">
                  Generates 5 single-use codes for this event so volunteers can log in (each volunteer enters their name, and the code is then tied to them) to kutumb.org.au/checkin without an
                  admin email/password. They expire at the end of {selectedEventDateText || "the event's day"} and are
                  deleted automatically.
                </p>
              </div>
              <Button size="sm" variant="outline" onClick={generateCodes} disabled={generatingCodes} className="shrink-0">
                {generatingCodes ? "Generating…" : "Generate 5 codes"}
              </Button>
            </div>
            {generatedCodes && (
              <div className="rounded-md bg-muted/50 p-3 space-y-2">
                <div className="flex flex-wrap gap-2">
                  {generatedCodes.codes.map((c) => (
                    <span key={c} className="font-mono font-bold tracking-wider text-sm border-2 border-dashed border-orange-400 bg-orange-50 rounded-md px-3 py-1">
                      {c}
                    </span>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  {generatedCodes.emailSent ? "✅ Emailed to info@kutumb.org.au." : "⚠️ Email could not be sent — share these codes directly."}{" "}
                  Expires {new Date(generatedCodes.expiresAt).toLocaleString()}.
                </p>
              </div>
            )}
          </div>

          <div className="border rounded-lg p-4 max-w-4xl space-y-3">
            <div className="flex items-center justify-between">
              <Label>Active check-in codes</Label>
              <Button size="sm" variant="ghost" onClick={loadCodeBatches} disabled={loadingBatches}>
                {loadingBatches ? "Refreshing…" : "↻ Refresh"}
              </Button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left border-b">
                    <th className="py-1 pr-2">Event Name</th>
                    <th className="py-1 pr-2">Event Date</th>
                    <th className="py-1 pr-2">Generated</th>
                    <th className="py-1 pr-2">Expires</th>
                    <th className="py-1 pr-2">Codes</th>
                    <th className="py-1"></th>
                  </tr>
                </thead>
                <tbody>
                  {visibleCodeBatches.map((b) => {
                    const key = batchKey(b);
                    const isEditing = editingBatch === key;
                    return (
                      <tr key={key} className="border-b align-top">
                        <td className="py-2 pr-2 font-medium">
                          {b.event_name}
                          {b.event_year ? ` (${b.event_year})` : ""}
                        </td>
                        <td className="py-2 pr-2">{b.event_date_text || "—"}</td>
                        <td className="py-2 pr-2">{new Date(b.generated_at).toLocaleString()}</td>
                        <td className="py-2 pr-2">
                          {isEditing ? (
                            <Input
                              type="datetime-local"
                              className="h-8 text-xs"
                              value={editExpiresAt}
                              onChange={(e) => setEditExpiresAt(e.target.value)}
                            />
                          ) : (
                            new Date(b.expires_at).toLocaleString()
                          )}
                        </td>
                        <td className="py-2 pr-2">
                          <div className="flex flex-wrap gap-1">
                            {(b.code_details || b.codes.map((c) => ({ code: c, used_at: null, used_by_name: null }))).map((d) => (
                              <span
                                key={d.code}
                                className={`font-mono text-xs border rounded px-1.5 py-0.5 ${d.used_at ? "bg-muted text-muted-foreground" : ""}`}
                                title={d.used_at ? `Used by ${d.used_by_name} at ${new Date(d.used_at).toLocaleString()}` : "Not used yet"}
                              >
                                <span className={d.used_at ? "line-through" : ""}>{d.code}</span>
                                {d.used_at ? ` — ${d.used_by_name}` : " — unused"}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="py-2">
                          {isEditing ? (
                            <div className="flex gap-1 shrink-0">
                              <Button size="sm" onClick={() => saveEditBatch(b)} disabled={savingEdit}>
                                {savingEdit ? "Saving…" : "Save"}
                              </Button>
                              <Button size="sm" variant="outline" onClick={cancelEditBatch} disabled={savingEdit}>
                                Cancel
                              </Button>
                            </div>
                          ) : (
                            <div className="flex gap-1 shrink-0">
                              <Button size="sm" variant="outline" onClick={() => startEditBatch(b)}>
                                Edit
                              </Button>
                              <Button
                                size="sm"
                                variant="destructive"
                                onClick={() => deleteBatch(b)}
                                disabled={deletingBatch === key}
                              >
                                {deletingBatch === key ? "Deleting…" : "Delete"}
                              </Button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {!loadingBatches && visibleCodeBatches.length === 0 && (
              <p className="text-sm text-muted-foreground">No active check-in codes right now.</p>
            )}
          </div>

          <div className="border rounded-lg p-4 max-w-lg space-y-3">
            <div className="flex items-center justify-between">
              <Label>Scan attendee QR code</Label>
              <Button size="sm" variant="outline" onClick={() => setCameraOpen((v) => !v)}>
                {cameraOpen ? "✕ Close Camera" : "📷 Scan with Camera"}
              </Button>
            </div>

            {cameraOpen && (
              <div className="space-y-2">
                <div id="qr-camera-reader" className="w-full rounded-md overflow-hidden border" />
                {cameraError && (
                  <p className="text-xs text-destructive">
                    {cameraError}. Make sure you've allowed camera access, or use the field below instead.
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  Point the camera at an attendee's QR code. It checks them in automatically the moment it's recognised.
                </p>
              </div>
            )}

            <div className="flex gap-2">
              <Input
                value={tokenInput}
                onChange={(e) => setTokenInput(e.target.value)}
                placeholder="Or type/paste the QR token from the attendee's e-ticket"
                onKeyDown={(e) => e.key === "Enter" && tokenInput && scan(tokenInput)}
              />
              <Button onClick={() => tokenInput && scan(tokenInput)}>Check in</Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Already checked in? Scanning (or submitting) the same code again within 10 seconds overrides it —
              otherwise use the manual list below.
            </p>
          </div>

          <div className="border rounded-lg p-4 max-w-2xl">
            <div className="flex flex-wrap justify-between items-center gap-2 mb-3">
              <h3 className="font-bold">Attendees ({attendees.length})</h3>
              <Input className="w-full sm:w-48" placeholder="Search name/email" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-left border-b"><th className="py-1">Name</th><th>Ticket</th><th>Status</th><th>Checked in by</th><th></th></tr></thead>
                <tbody>
                  {filtered.map((a) => (
                    <tr key={a.id} className="border-b">
                      <td className="py-1">{a.name} ({a.email})</td>
                      <td>{a.ticket_type_name}</td>
                      <td>{a.checked_in_at ? `✅ ${new Date(a.checked_in_at).toLocaleTimeString()}` : "—"}</td>
                      <td>{a.checked_in_at ? `${a.checked_in_by || "—"}${a.checked_in_code ? ` (${a.checked_in_code})` : ""}` : ""}</td>
                      <td>
                        {!a.checked_in_at && (
                          <Button size="sm" onClick={() => manualCheckIn(a.id)}>Check in</Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {attendees.length === 0 && <p className="text-sm text-muted-foreground">No ticketed attendees for this event yet.</p>}
          </div>
        </>
      )}
    </div>
  );
}
