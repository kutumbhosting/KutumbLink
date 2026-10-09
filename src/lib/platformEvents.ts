export interface PlatformEvent {
  id?: number;
  title: string;
  eventYear?: string;
  date?: string;
  time?: string;
  location?: string;
  eventType?: string;
  eventMode?: string;
  accessibilityNotes?: string;
  faqs?: { question: string; answer: string }[];
  charityName?: string | null;
  charitySlug?: string | null;
  causes?: string[];
  startingPriceCents?: number | null;
  capacity?: number;
  nonMemberFee?: number;
  description?: string;
  isActive?: boolean;
  published?: boolean;
  flyerImage?: string;
  availableSpots?: number;
  registrationsCount?: number;
}

export const eventSlug = (value: string) => value
  .toLowerCase()
  .trim()
  .replace(/\s+/g, "-")
  .replace(/_/g, "-")
  .replace(/[^\w-]+/g, "");

export async function fetchPlatformEvents(): Promise<PlatformEvent[]> {
  const response = await fetch("/api/upcoming-events");
  if (!response.ok) throw new Error("Events could not be loaded right now.");
  const events = await response.json();
  return Array.isArray(events)
    ? events.filter((event) => event.isActive && event.published !== false)
    : [];
}

export const eventImage = (event: PlatformEvent) => event.flyerImage
  ? `/api/media/${encodeURIComponent(event.flyerImage)}`
  : "";

export const startingPrice = (event: PlatformEvent) => {
  const price = event.startingPriceCents != null ? Number(event.startingPriceCents) / 100 : Number(event.nonMemberFee) || 0;
  return price > 0 ? `From $${price.toFixed(2)}` : "Free entry";
};

export function prettyEventDate(date?: string, time?: string) {
  if (!date) return "Date to be announced";
  return [date, time].filter(Boolean).join(" · ");
}
