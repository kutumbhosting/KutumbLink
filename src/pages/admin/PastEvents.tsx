import { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { safeFetch } from "./safeFetch";

interface MediaItem {
  type: "image" | "video";
  src: string;
}

interface PastEvent {
  title: string;
  date: string;
  description?: string;
  highlights?: string;
  media?: MediaItem[];
  attendeesCount?: number;
  archivedAt?: string;
}

const PastEvents = () => {
  const { toast } = useToast();
  const [events, setEvents] = useState<PastEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState<string | null>(null);

  const fetchPastEvents = async () => {
    const data = await safeFetch("/api/pastevents");
    setEvents(Array.isArray(data) ? data : []);
    setLoading(false);
  };

  useEffect(() => {
    fetchPastEvents();
  }, []);

  const key = (e: PastEvent) => `${e.title}__${e.date}`;

  const updateField = (idx: number, field: "description" | "highlights", value: string) => {
    setEvents((prev) => prev.map((ev, i) => (i === idx ? { ...ev, [field]: value } : ev)));
  };

  const saveEvent = async (event: PastEvent) => {
    const result = await safeFetch("/api/pastevents/update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: event.title,
        date: event.date,
        description: event.description || "",
        highlights: event.highlights || "",
      }),
    });
    if (result) {
      toast({ title: "Saved", description: `Updated "${event.title}"` });
    } else {
      toast({ title: "Error", description: "Could not save changes", variant: "destructive" });
    }
  };

  const uploadMedia = async (event: PastEvent, file: File) => {
    setUploading(key(event));
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("title", event.title);
      formData.append("date", event.date);

      const res = await fetch("/api/pastevents/upload-media", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Upload failed");

      toast({ title: "Uploaded 🎉", description: `Photo/video added to "${event.title}"` });
      fetchPastEvents();
    } catch (err: any) {
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
    } finally {
      setUploading(null);
    }
  };

  const deleteMedia = async (event: PastEvent, src: string) => {
    if (!confirm("Remove this photo/video?")) return;
    try {
      const res = await fetch("/api/pastevents/delete-media", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: event.title, date: event.date, src }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Delete failed");

      toast({ title: "Removed", description: "Media deleted" });
      fetchPastEvents();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="p-12 text-center text-muted-foreground">Loading past events…</CardContent>
      </Card>
    );
  }

  if (events.length === 0) {
    return (
      <Card>
        <CardContent className="p-12 text-center space-y-2">
          <div className="text-5xl">🗓️</div>
          <h2 className="text-2xl font-bold">Past Events</h2>
          <p className="text-muted-foreground max-w-md mx-auto">
            No past events yet. Events move here automatically once their date has passed.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-bold">Past Events Management</h2>
        <span className="text-sm text-muted-foreground">{events.length} event(s)</span>
      </div>

      {events.map((event, idx) => (
        <Card key={key(event)} className="border">
          <CardContent className="p-6 space-y-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div>
                <h3 className="text-lg font-bold">{event.title}</h3>
                <p className="text-sm text-muted-foreground">{event.date}</p>
              </div>
              {typeof event.attendeesCount === "number" && (
                <span className="text-xs bg-muted px-2 py-1 rounded">
                  {event.attendeesCount} attendee(s)
                </span>
              )}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1">
                <label className="text-sm font-medium">Description</label>
                <Textarea
                  value={event.description || ""}
                  onChange={(e) => updateField(idx, "description", e.target.value)}
                  rows={3}
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">Highlights</label>
                <Textarea
                  value={event.highlights || ""}
                  onChange={(e) => updateField(idx, "highlights", e.target.value)}
                  rows={3}
                />
              </div>
            </div>

            <Button size="sm" onClick={() => saveEvent(event)}>
              Save Text
            </Button>

            {/* Media gallery */}
            <div>
              <label className="text-sm font-medium block mb-2">Photos & Videos</label>
              <div className="flex flex-wrap gap-3">
                {(event.media || []).map((m) => (
                  <div key={m.src} className="relative group">
                    {m.type === "image" ? (
                      <img
                        src={`/api/media/${m.src}`}
                        alt={event.title}
                        className="w-28 h-28 object-cover rounded border"
                      />
                    ) : (
                      <video
                        src={`/api/media/${m.src}`}
                        className="w-28 h-28 object-cover rounded border"
                        muted
                      />
                    )}
                    <button
                      className="absolute top-1 right-1 bg-black/70 text-white text-xs px-1.5 py-0.5 rounded opacity-0 group-hover:opacity-100 transition"
                      onClick={() => deleteMedia(event, m.src)}
                      title="Remove"
                    >
                      ✕
                    </button>
                  </div>
                ))}

                {/* Upload new media tile */}
                <label className="w-28 h-28 flex items-center justify-center border-2 border-dashed rounded cursor-pointer text-xs text-muted-foreground hover:bg-muted/50 text-center p-2">
                  {uploading === key(event) ? "Uploading…" : "+ Add photo/video"}
                  <input
                    type="file"
                    accept="image/*,video/*"
                    className="hidden"
                    disabled={uploading === key(event)}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) uploadMedia(event, file);
                      e.target.value = "";
                    }}
                  />
                </label>
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
};

export default PastEvents;