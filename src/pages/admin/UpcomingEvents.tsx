import { useState, useEffect, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { safeFetch, downloadCSV } from "./safeFetch";
import { ColumnFilterHeader } from "@/components/admin/ColumnFilterHeader";

type EventColumnKey =
  | "isActive"
  | "title"
  | "date"
  | "time"
  | "location"
  | "capacity"
  | "memberFee"
  | "nonMemberFee"
  | "under5Free"
  | "childMemberFee"
  | "childNonMemberFee"
  | "description"
  | "flyerImage";

// One place to describe every filterable/sortable column: its header label
// and how to turn a raw event row into the display string used both in the
// filter dropdown's checklist and for matching against the active filter.
// Title and description are effectively unique per event, so a filter
// checklist on them isn't useful — no funnel is shown for these.
const UNIQUE_VALUE_COLUMNS: EventColumnKey[] = ["title", "description"];

const EVENT_COLUMNS: { key: EventColumnKey; label: string; getValue: (e: any) => string }[] = [
  { key: "isActive", label: "Active", getValue: (e) => (e.isActive ? "Yes" : "No") },
  { key: "title", label: "Title", getValue: (e) => e.title || "" },
  { key: "date", label: "Date", getValue: (e) => e.date || "" },
  { key: "time", label: "Time", getValue: (e) => e.time || "" },
  { key: "location", label: "Location", getValue: (e) => e.location || "" },
  { key: "capacity", label: "Capacity", getValue: (e) => String(e.capacity ?? "") },
  { key: "memberFee", label: "Member Fee", getValue: (e) => String(e.memberFee ?? 0) },
  { key: "nonMemberFee", label: "Non-Member Fee", getValue: (e) => String(e.nonMemberFee ?? 0) },
  { key: "under5Free", label: "Under-5 Free", getValue: (e) => (e.under5Free !== false ? "Yes" : "No") },
  { key: "childMemberFee", label: "Child Member Fee", getValue: (e) => (e.childMemberFee ?? "") === "" ? "(same as Member Fee)" : String(e.childMemberFee) },
  { key: "childNonMemberFee", label: "Child Non-Member Fee", getValue: (e) => (e.childNonMemberFee ?? "") === "" ? "(same as Non-Member Fee)" : String(e.childNonMemberFee) },
  { key: "description", label: "Description", getValue: (e) => e.description || "" },
  { key: "flyerImage", label: "Flyer", getValue: (e) => (e.flyerImage ? "Has flyer" : "No flyer") },
];

const UpcomingEvents = () => {
  const { toast } = useToast();

  const [upcomingEvents, setUpcomingEvents] = useState<any[]>([]);
  const [newFlyer, setNewFlyer] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [eventStep, setEventStep] = useState(0);

  const [newEvent, setNewEvent] = useState({
    title: "",
    eventType: "community",
    eventMode: "in_person",
    accessibilityNotes: "",
    date: "",
    time: "",
    location: "",
    capacity: "",
    description: "",
    isActive: true,
    memberFee: "0",
    nonMemberFee: "0",
    ticketPrice: "0",
    under5Free: true,
    childMemberFee: "",
    childNonMemberFee: "",
  });

  // ── Per-column dropdown filters (Excel-style, search box included) ──────
  const [columnFilters, setColumnFilters] = useState<Record<EventColumnKey, string[]>>({
    isActive: [], title: [], date: [], time: [], location: [], capacity: [],
    memberFee: [], nonMemberFee: [], under5Free: [], childMemberFee: [],
    childNonMemberFee: [], description: [], flyerImage: [],
  });
  const setColumnFilter = (key: EventColumnKey, values: string[]) =>
    setColumnFilters((prev) => ({ ...prev, [key]: values }));
  const anyColumnFilterActive = Object.values(columnFilters).some((v) => v.length > 0);
  const clearAllColumnFilters = () =>
    setColumnFilters({
      isActive: [], title: [], date: [], time: [], location: [], capacity: [],
      memberFee: [], nonMemberFee: [], under5Free: [], childMemberFee: [],
      childNonMemberFee: [], description: [], flyerImage: [],
    });

  const columnOptions = useMemo(() => {
    const options = {} as Record<EventColumnKey, string[]>;
    for (const col of EVENT_COLUMNS) {
      options[col.key] = Array.from(new Set(upcomingEvents.map((e) => col.getValue(e))));
    }
    return options;
  }, [upcomingEvents]);

  const visibleEvents = upcomingEvents.filter((e) =>
    EVENT_COLUMNS.every((col) => {
      const active = columnFilters[col.key];
      return active.length === 0 || active.includes(col.getValue(e));
    })
  );

  // ── Edit-in-popup ─────────────────────────────────────────────────────
  const [editingEvent, setEditingEvent] = useState<any | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [editFlyerFile, setEditFlyerFile] = useState<File | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);

  const openEditDialog = (event: any) => {
    setEditingEvent({
      ...event,
      memberFee: event.memberFee ?? 0,
      nonMemberFee: event.nonMemberFee ?? 0,
      under5Free: event.under5Free !== false,
      childMemberFee: event.childMemberFee ?? "",
      childNonMemberFee: event.childNonMemberFee ?? "",
    });
    setEditFlyerFile(null);
    setEditOpen(true);
  };

  const closeEditDialog = () => {
    setEditOpen(false);
    setEditingEvent(null);
    setEditFlyerFile(null);
  };

  const removeEditFlyer = async () => {
    if (!editingEvent?.flyerImage) return;
    if (!confirm("Delete flyer?")) return;
    try {
      const res = await fetch("/api/delete-flyer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: editingEvent.title,
          date: editingEvent.date,
          fileName: editingEvent.flyerImage,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message);
      setEditingEvent((prev: any) => ({ ...prev, flyerImage: "" }));
      toast({ title: "Deleted", description: "Flyer removed" });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

  const saveEditDialog = async () => {
    if (!editingEvent) return;
    if (!editingEvent.title?.trim()) {
      toast({ title: "Title required", description: "Event title can't be empty.", variant: "destructive" });
      return;
    }

    setSavingEdit(true);
    try {
      const res = await fetch("/api/upcoming-events/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editingEvent),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.message || "Update failed");

      if (editFlyerFile) {
        const formData = new FormData();
        formData.append("flyer", editFlyerFile);
        formData.append("title", editingEvent.title);
        formData.append("event", JSON.stringify(editingEvent));
        formData.append("eventYear", editingEvent.date?.split("-")[0]);
        const flyerRes = await fetch("/api/upload-flyer", { method: "POST", body: formData });
        const flyerData = await flyerRes.json();
        if (!flyerRes.ok) throw new Error(flyerData.message || "Flyer upload failed");
      }

      toast({ title: "Saved", description: `"${editingEvent.title}" was updated.` });
      closeEditDialog();
      fetchUpcomingEvents();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setSavingEdit(false);
    }
  };

  // ─── flyer preview (Add New Event form) ─────────────────────────────────
  useEffect(() => {
    if (!newFlyer) { setPreviewUrl(null); return; }
    const url = URL.createObjectURL(newFlyer);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [newFlyer]);

  // ─── fetch ──────────────────────────────────────────────────────────────
  const fetchUpcomingEvents = async () => {
    const data = await safeFetch("/api/upcoming-events");
    setUpcomingEvents(Array.isArray(data) ? data : []);
  };

  useEffect(() => { fetchUpcomingEvents(); }, []);

  return (
    <div>
      {/* ── Existing events table ── */}
      <Card className="border mb-6">
        <CardContent className="p-6">
          <div className="flex flex-wrap justify-between items-center gap-2 mb-6">
            <h2 className="text-xl font-bold">Upcoming Events Management</h2>
            <Button onClick={() => downloadCSV(upcomingEvents, "upcoming-events.csv")}>
              Download CSV
            </Button>
          </div>

          <div className="flex flex-wrap items-center gap-2 mb-4">
            <p className="text-sm text-muted-foreground">
              {anyColumnFilterActive ? (
                <>
                  Showing <span className="font-semibold text-foreground">{visibleEvents.length}</span> of{" "}
                  <span className="font-semibold text-foreground">{upcomingEvents.length}</span> events
                </>
              ) : (
                <>
                  Total Upcoming Events: <span className="font-semibold text-foreground">{upcomingEvents.length}</span>
                </>
              )}
            </p>
            {anyColumnFilterActive && (
              <Button variant="ghost" size="sm" onClick={clearAllColumnFilters}>
                Clear filters
              </Button>
            )}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  {EVENT_COLUMNS.map((col) => (
                    <th key={col.key} className="p-2 text-left">
                      <ColumnFilterHeader
                        label={col.label}
                        filterable={!UNIQUE_VALUE_COLUMNS.includes(col.key)}
                        options={columnOptions[col.key] || []}
                        selected={columnFilters[col.key]}
                        onChange={(values) => setColumnFilter(col.key, values)}
                      />
                    </th>
                  ))}
                  <th className="p-2 text-left">Action</th>
                </tr>
              </thead>
              <tbody>
                {visibleEvents.map((event, index) => (
                  <tr key={event.title ? `${event.title}-${index}` : index} className="border-b align-top">
                    <td className="p-2 text-center">
                      <input
                        type="checkbox"
                        checked={!!event.isActive}
                        onChange={async (e) => {
                          await safeFetch("/api/upcoming-events/update", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ ...event, isActive: e.target.checked }),
                          });
                          fetchUpcomingEvents();
                        }}
                        title="Quick toggle — active events are shown publicly"
                      />
                    </td>
                    <td className="p-2 font-medium max-w-[180px] truncate" title={event.title}>{event.title}</td>
                    <td className="p-2 whitespace-nowrap">{event.date}</td>
                    <td className="p-2 whitespace-nowrap">{event.time}</td>
                    <td className="p-2 max-w-[160px] truncate" title={event.location}>{event.location}</td>
                    <td className="p-2">{event.capacity}</td>
                    <td className="p-2">${event.memberFee ?? 0}</td>
                    <td className="p-2">${event.nonMemberFee ?? 0}</td>
                    <td className="p-2 text-center">{event.under5Free !== false ? "Yes" : "No"}</td>
                    <td className="p-2">
                      {(event.childMemberFee ?? "") === "" ? (
                        <span className="text-muted-foreground text-xs">same</span>
                      ) : (
                        `$${event.childMemberFee}`
                      )}
                    </td>
                    <td className="p-2">
                      {(event.childNonMemberFee ?? "") === "" ? (
                        <span className="text-muted-foreground text-xs">same</span>
                      ) : (
                        `$${event.childNonMemberFee}`
                      )}
                    </td>
                    <td className="p-2 max-w-[200px] truncate" title={event.description}>{event.description}</td>
                    <td className="p-2">
                      {event.flyerImage ? (
                        <img
                          src={`/api/media/${event.flyerImage}?t=${Date.now()}`}
                          className="max-h-[48px] rounded border"
                          alt="flyer"
                        />
                      ) : (
                        <span className="text-muted-foreground text-xs">No flyer</span>
                      )}
                    </td>
                    <td className="p-2">
                      <div className="flex gap-2">
                        <Button size="sm" onClick={() => openEditDialog(event)}>
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={async () => {
                            if (!confirm(`Delete "${event.title}"? This can't be undone.`)) return;
                            await safeFetch("/api/upcoming-events/delete", {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ title: event.title }),
                            });
                            fetchUpcomingEvents();
                          }}
                        >
                          Delete
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
                {visibleEvents.length === 0 && (
                  <tr>
                    <td colSpan={EVENT_COLUMNS.length + 1} className="p-4 text-center text-muted-foreground">
                      No events match your filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* ── Edit Event popup ── */}
      <Dialog open={editOpen} onOpenChange={(open) => (open ? setEditOpen(true) : closeEditDialog())}>
        <DialogContent className="sm:max-w-lg max-h-[85vh] flex flex-col gap-0 p-0 overflow-hidden">
          <DialogHeader className="p-6 pb-4 shrink-0">
            <DialogTitle>Edit Event</DialogTitle>
            <DialogDescription>
              Update the details for this upcoming event.
            </DialogDescription>
          </DialogHeader>

          {editingEvent && (
            <div className="space-y-3 overflow-y-auto px-6 py-1 min-h-0">
              <div>
                <label className="text-xs font-medium text-muted-foreground">Title</label>
                <Input
                  value={editingEvent.title}
                  onChange={(e) => setEditingEvent({ ...editingEvent, title: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Date</label>
                  <Input
                    value={editingEvent.date}
                    onChange={(e) => setEditingEvent({ ...editingEvent, date: e.target.value })}
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Time</label>
                  <Input
                    value={editingEvent.time}
                    onChange={(e) => setEditingEvent({ ...editingEvent, time: e.target.value })}
                  />
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Location</label>
                <Input
                  value={editingEvent.location}
                  onChange={(e) => setEditingEvent({ ...editingEvent, location: e.target.value })}
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Capacity</label>
                <Input
                  value={editingEvent.capacity}
                  onChange={(e) => setEditingEvent({ ...editingEvent, capacity: e.target.value })}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Member Fee ($)</label>
                  <Input
                    type="number"
                    min="0"
                    value={editingEvent.memberFee}
                    onChange={(e) => setEditingEvent({ ...editingEvent, memberFee: e.target.value })}
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Non-Member Fee ($)</label>
                  <Input
                    type="number"
                    min="0"
                    value={editingEvent.nonMemberFee}
                    onChange={(e) => setEditingEvent({ ...editingEvent, nonMemberFee: e.target.value })}
                  />
                </div>
              </div>

              <div className="space-y-3 rounded border p-3">
                <div className="flex items-center gap-2">
                  <input
                    id="edit-event-under5free"
                    type="checkbox"
                    checked={editingEvent.under5Free}
                    onChange={(e) => setEditingEvent({ ...editingEvent, under5Free: e.target.checked })}
                  />
                  <label htmlFor="edit-event-under5free" className="text-sm font-medium">
                    Children under 5 register for free
                  </label>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-medium text-muted-foreground block mb-1">Child Member Fee ($)</label>
                    <Input
                      type="number"
                      min="0"
                      placeholder={`Same as Member Fee (${editingEvent.memberFee || 0})`}
                      value={editingEvent.childMemberFee}
                      onChange={(e) => setEditingEvent({ ...editingEvent, childMemberFee: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground block mb-1">Child Non-Member Fee ($)</label>
                    <Input
                      type="number"
                      min="0"
                      placeholder={`Same as Non-Member Fee (${editingEvent.nonMemberFee || 0})`}
                      value={editingEvent.childNonMemberFee}
                      onChange={(e) => setEditingEvent({ ...editingEvent, childNonMemberFee: e.target.value })}
                    />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Leave a child fee blank to charge children (5 and over) the same rate as adults.
                </p>
              </div>

              <div>
                <label className="text-xs font-medium text-muted-foreground">Description</label>
                <Input
                  value={editingEvent.description}
                  onChange={(e) => setEditingEvent({ ...editingEvent, description: e.target.value })}
                />
              </div>

              <div className="flex items-center gap-2">
                <input
                  id="edit-event-active"
                  type="checkbox"
                  checked={!!editingEvent.isActive}
                  onChange={(e) => setEditingEvent({ ...editingEvent, isActive: e.target.checked })}
                />
                <label htmlFor="edit-event-active" className="text-sm font-medium">
                  Active (visible to the public)
                </label>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Flyer Image</label>
                {editingEvent.flyerImage && !editFlyerFile && (
                  <div className="flex items-center gap-2">
                    <img
                      src={`/api/media/${editingEvent.flyerImage}?t=${Date.now()}`}
                      className="max-h-[64px] rounded border"
                      alt="current flyer"
                    />
                    <Button type="button" size="sm" variant="outline" onClick={removeEditFlyer}>
                      Remove flyer
                    </Button>
                  </div>
                )}
                <input
                  type="file"
                  accept="image/*"
                  className="w-full text-sm"
                  onChange={(e) => { const file = e.target.files?.[0]; if (file) setEditFlyerFile(file); }}
                />
                {editFlyerFile && (
                  <div className="flex items-center gap-2">
                    <img src={URL.createObjectURL(editFlyerFile)} className="max-h-[64px] rounded border" alt="new flyer preview" />
                    <p className="text-xs text-green-600">Will replace on save: {editFlyerFile.name}</p>
                  </div>
                )}
              </div>
            </div>
          )}

          <DialogFooter className="p-6 pt-4 shrink-0 border-t">
            <Button variant="outline" onClick={closeEditDialog} disabled={savingEdit}>
              Cancel
            </Button>
            <Button onClick={saveEditDialog} disabled={savingEdit}>
              {savingEdit ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Add New Event ── */}
      <div className="mb-8 max-w-3xl rounded-xl border bg-card p-5 space-y-5">
        <div><p className="text-xs font-semibold uppercase tracking-wide text-primary">Create an event · Step {eventStep + 1} of 5</p><h3 className="mt-1 font-bold text-xl">{["Start with the basics", "When and where", "Tell people what to expect", "Tickets", "Review and publish"][eventStep]}</h3><div className="mt-3 flex gap-1" aria-label="Event creation progress">{[0,1,2,3,4].map((step) => <span key={step} className={`h-1.5 flex-1 rounded ${step <= eventStep ? "bg-primary" : "bg-muted"}`} />)}</div></div>

        {eventStep === 0 && <div className="space-y-4">
          <div><label className="mb-1 block text-sm font-medium">Event idea</label><select className="w-full rounded-md border bg-background p-2" value={newEvent.eventType} onChange={(e) => setNewEvent({ ...newEvent, eventType: e.target.value })}><option value="community">Community event</option><option value="dinner_gala">Dinner or gala</option><option value="run_walk">Walk or run</option><option value="fundraiser">Fundraiser</option><option value="workshop">Workshop</option><option value="online">Online event</option></select><p className="mt-1 text-xs text-muted-foreground">We’ll use this to help people find your event.</p></div>
          <div><label className="mb-1 block text-sm font-medium">Event name</label><Input placeholder="e.g. Community Fun Run" value={newEvent.title} onChange={(e) => setNewEvent({ ...newEvent, title: e.target.value })} /></div>
        </div>}

        {eventStep === 1 && <div className="grid gap-3 sm:grid-cols-2">
          <div><label className="mb-1 block text-sm font-medium">Date</label><Input type="date" value={newEvent.date} onChange={(e) => setNewEvent({ ...newEvent, date: e.target.value })} /></div>
          <div><label className="mb-1 block text-sm font-medium">Time</label><Input placeholder="e.g. 10:00 am – 2:00 pm" value={newEvent.time} onChange={(e) => setNewEvent({ ...newEvent, time: e.target.value })} /></div>
          <div><label className="mb-1 block text-sm font-medium">Format</label><select className="w-full rounded-md border bg-background p-2" value={newEvent.eventMode} onChange={(e) => setNewEvent({ ...newEvent, eventMode: e.target.value })}><option value="in_person">In person</option><option value="online">Online</option><option value="hybrid">In person and online</option></select></div>
          {newEvent.eventMode !== "online" && <div><label className="mb-1 block text-sm font-medium">Location</label><Input placeholder="Venue, suburb or address" value={newEvent.location} onChange={(e) => setNewEvent({ ...newEvent, location: e.target.value })} /></div>}
        </div>}

        {eventStep === 2 && <div className="space-y-4">
          <div><label className="mb-1 block text-sm font-medium">Description</label><textarea className="min-h-32 w-full rounded-md border bg-background p-3 text-sm" placeholder="What will people enjoy or support by attending?" value={newEvent.description} onChange={(e) => setNewEvent({ ...newEvent, description: e.target.value })} /></div>
          <div><label className="mb-1 block text-sm font-medium">Event image (optional)</label><input type="file" accept="image/*" className="w-full text-sm" onChange={(e) => { const file = e.target.files?.[0]; if (file) setNewFlyer(file); }} />{newFlyer && <p className="mt-1 text-xs text-green-700">Ready: {newFlyer.name}</p>}</div>
          <details className="rounded-lg border p-3"><summary className="cursor-pointer text-sm font-medium">More options: accessibility details</summary><textarea className="mt-3 min-h-20 w-full rounded-md border bg-background p-3 text-sm" placeholder="Step-free access, hearing loop, quiet space…" value={newEvent.accessibilityNotes || ""} onChange={(e) => setNewEvent({ ...newEvent, accessibilityNotes: e.target.value })} /></details>
        </div>}

        {eventStep === 3 && <div className="space-y-4">
          <p className="text-sm text-muted-foreground">A simple General Admission ticket is set up automatically. You can add other ticket types and advanced options later.</p>
          <div className="grid gap-3 sm:grid-cols-2"><div><label className="mb-1 block text-sm font-medium">Ticket price (AUD)</label><Input type="number" min="0" step="0.01" value={newEvent.ticketPrice} onChange={(e) => setNewEvent({ ...newEvent, ticketPrice: e.target.value })} /><p className="mt-1 text-xs text-muted-foreground">Set to $0 for free tickets.</p></div><div><label className="mb-1 block text-sm font-medium">Places available</label><Input type="number" min="0" placeholder="No limit" value={newEvent.capacity} onChange={(e) => setNewEvent({ ...newEvent, capacity: e.target.value })} /></div></div>
          <details className="rounded-lg border p-3"><summary className="cursor-pointer text-sm font-medium">More options: member and child prices</summary><div className="mt-3 grid grid-cols-2 gap-3"><div><label className="mb-1 block text-xs">Member fee</label><Input type="number" min="0" value={newEvent.memberFee} onChange={(e) => setNewEvent({ ...newEvent, memberFee: e.target.value })} /></div><div><label className="mb-1 block text-xs">Non-member fee</label><Input type="number" min="0" value={newEvent.nonMemberFee} onChange={(e) => setNewEvent({ ...newEvent, nonMemberFee: e.target.value })} /></div><label className="col-span-2 flex items-center gap-2 text-sm"><input type="checkbox" checked={newEvent.under5Free} onChange={(e) => setNewEvent({ ...newEvent, under5Free: e.target.checked })} />Children under 5 are free</label></div></details>
        </div>}

        {eventStep === 4 && <div className="rounded-lg bg-muted/40 p-4 text-sm"><h4 className="font-semibold">{newEvent.title || "Your event"}</h4><p className="mt-1 text-muted-foreground">{newEvent.date || "Date to be confirmed"} · {newEvent.eventMode === "online" ? "Online" : newEvent.location || "Location to be confirmed"}</p><p className="mt-2">{Number(newEvent.ticketPrice) > 0 ? `$${Number(newEvent.ticketPrice).toFixed(2)} AUD per ticket` : "Free tickets"} · {newEvent.capacity ? `${newEvent.capacity} places` : "No capacity limit"}</p><p className="mt-3 text-xs text-muted-foreground">Publishing makes this event visible on KutumbLink Discover. You can edit it later.</p></div>}

        <div className="flex flex-wrap justify-between gap-2 border-t pt-4"><Button variant="outline" disabled={eventStep === 0} onClick={() => setEventStep((step) => Math.max(0, step - 1))}>Back</Button>{eventStep < 4 ? <Button onClick={() => { if (eventStep === 0 && !newEvent.title.trim()) { toast({ title: "Add an event name first", variant: "destructive" }); return; } setEventStep((step) => Math.min(4, step + 1)); }}>Continue</Button> : <Button onClick={async () => {
          try {
            if (!newEvent.title.trim()) throw new Error("Add an event name first");
            const res = await fetch("/api/upcoming-events/update", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...newEvent, published: true, isActive: true }) });
            const data = await res.json(); if (!res.ok) throw new Error(data.message || "Could not create event");
            const slug = newEvent.title.toLowerCase().trim().replace(/\s+/g, "-").replace(/[^\w-]+/g, "");
            const existingTypes = await fetch(`/api/ticketing/${slug}/ticket-types`).then((r) => r.json()).catch(() => []);
            if (!Array.isArray(existingTypes) || existingTypes.length === 0) {
              const ticketRes = await fetch(`/api/ticketing/admin/${slug}/ticket-types`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "General Admission", description: "Standard event entry", priceCents: Math.round(Number(newEvent.ticketPrice || 0) * 100), quantityTotal: Number(newEvent.capacity) || 0 }) });
              const ticketData = await ticketRes.json(); if (!ticketRes.ok) throw new Error(ticketData.message || "Event saved, but ticket setup needs attention");
            }
            if (newFlyer) { const formData = new FormData(); formData.append("flyer", newFlyer); formData.append("event", JSON.stringify({ title: newEvent.title, eventYear: new Date(newEvent.date).getFullYear() })); const flyerRes = await fetch("/api/upload-flyer", { method: "POST", body: formData }); const flyerData = await flyerRes.json(); if (!flyerRes.ok) throw new Error(flyerData.message || "Event saved, but image upload failed"); }
            toast({ title: "Event published", description: "Your event page and first ticket are ready." });
            setNewEvent({ title: "", eventType: "community", eventMode: "in_person", date: "", time: "", location: "", capacity: "", description: "", isActive: true, memberFee: "0", nonMemberFee: "0", ticketPrice: "0", under5Free: true, childMemberFee: "", childNonMemberFee: "", accessibilityNotes: "" });
            setNewFlyer(null); setEventStep(0); fetchUpcomingEvents();
          } catch (err: any) { toast({ title: "Couldn't publish event", description: err.message, variant: "destructive" }); }
        }}>Preview and publish</Button>}</div>
      </div>
    </div>
  );
};

export default UpcomingEvents;
