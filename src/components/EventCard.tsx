import { ArrowUpRight, CalendarDays, MapPin } from "lucide-react";
import { Link } from "react-router-dom";
import { eventImage, eventSlug, prettyEventDate, startingPrice, type PlatformEvent } from "@/lib/platformEvents";

const colorSets = ["lavender", "peach", "mint", "blue"];

export default function EventCard({ event, index = 0 }: { event: PlatformEvent; index?: number }) {
  const image = eventImage(event);
  return (
    <article className="event-card">
      <Link to={`/events/${eventSlug(event.title)}`} className="event-card-image-link" aria-label={`View ${event.title}`}>
        {image ? (
          <img className="event-card-image" src={image} alt="" loading="lazy" />
        ) : (
          <div className={`event-card-art ${colorSets[index % colorSets.length]}`}>
            <span className="event-card-art-label">Make a day of it</span>
            <span className="event-card-art-mark">✳</span>
            <span className="event-card-art-caption">GOOD THINGS<br />HAPPEN TOGETHER</span>
          </div>
        )}
        <span className="event-price-pill">{startingPrice(event)}</span>
      </Link>
      <div className="event-card-body">
        <div className="event-card-meta"><CalendarDays size={15} /> {prettyEventDate(event.date)}</div>
        <Link to={`/events/${eventSlug(event.title)}`} className="event-card-title">{event.title}</Link>
        {event.charityName && event.charitySlug && <Link to={`/charities/${event.charitySlug}`} className="event-card-meta">{event.charityName}</Link>}
        <div className="event-card-location"><MapPin size={15} /> <span>{event.location || "Location to be announced"}</span></div>
        <div className="event-card-bottom">
          <span>{(event.capacity ?? 0) > 0 ? ((event.availableSpots ?? 0) > 0 ? `${event.availableSpots} spots left` : "Fully booked") : "Open to all"}</span>
          <Link to={`/events/${eventSlug(event.title)}`} aria-label={`View ${event.title}`}><ArrowUpRight size={19} /></Link>
        </div>
      </div>
    </article>
  );
}
