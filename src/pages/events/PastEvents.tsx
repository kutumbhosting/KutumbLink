import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { TabsContent } from "@/components/ui/tabs";

interface MediaItem {
  type: "image" | "video";
  src: string;
}

interface PastEvent {
  title: string;
  date: string;
  description: string;
  highlights: string;
  media: MediaItem[];
}

const PastEvents = () => {
  const [pastEvents, setPastEvents] = useState<PastEvent[]>([]);

  useEffect(() => {
    fetch("/api/pastevents")
      .then((res) => res.json())
      .then((data) => setPastEvents(data))
      .catch((err) => console.error("Failed to load past events:", err));
  }, []);

  return (
    <TabsContent value="past" className="space-y-8">
      {pastEvents.map((event, index) => (
        <Card key={index} className="border border-border">
          <CardContent className="p-8">

            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 mb-4">
              <h3 className="text-2xl font-bold">{event.title}</h3>
              <span className="text-sm text-primary font-semibold bg-primary/10 px-4 py-2 rounded-full self-start whitespace-nowrap">
                {event.date}
              </span>
            </div>

            {event.description && event.description.trim() !== "" && (
              <p className="text-muted-foreground leading-relaxed mb-6">
                {event.description}
              </p>
            )}

            {event.media && event.media.length > 0 ? (
              <div className="w-full overflow-x-auto mb-6">
                <div className="flex gap-4 pb-2">
                  {event.media.map((item, i) => (
                    <div
                      key={i}
                      className="min-w-[240px] h-44 rounded-lg overflow-hidden shadow-md flex-shrink-0"
                    >
                      {item.type === "image" ? (
                        <img
                          src={`/api/media/${item.src}`}
                          alt={`${event.title} media ${i + 1}`}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <video
                          src={`/api/media/${item.src}`}
                          controls
                          preload="metadata"
                          className="w-full h-full object-cover"
                        />
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              // No photos were uploaded for this event - show a Kutumb-branded
              // placeholder rather than leaving a visual gap.
              <div className="w-full h-40 rounded-lg mb-6 bg-muted/40 flex items-center justify-center">
                <span className="text-lg font-semibold text-primary opacity-70">KutumbLink</span>
              </div>
            )}

            {event.highlights && event.highlights.trim() !== "" && (
              <div className="bg-muted/50 rounded-lg p-4">
                <h4 className="font-semibold mb-2 text-sm">Event Highlights:</h4>
                <p className="text-sm text-muted-foreground italic">
                  {event.highlights}
                </p>
              </div>
            )}

          </CardContent>
        </Card>
      ))}
    </TabsContent>
  );
};

export default PastEvents;
