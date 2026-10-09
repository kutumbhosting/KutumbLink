import { useEffect, useState } from "react";
import { ArrowLeft, CalendarDays, Check, Clock3, MapPin, Share2, Ticket } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import MarketplaceHeader from "@/components/MarketplaceHeader";
import MarketplaceFooter from "@/components/MarketplaceFooter";
import CheckoutModal from "@/components/CheckoutModal";
import { eventImage, eventSlug, fetchPlatformEvents, prettyEventDate, startingPrice, type PlatformEvent } from "@/lib/platformEvents";
import { setPageMetadata } from "@/lib/seo";

interface TicketOption {
  id: number;
  name: string;
  price_cents: number;
  quantity_total: number;
  quantity_sold: number;
}

export default function EventListing() {
  const { eventSlug: selectedSlug = "" } = useParams();
  const [event, setEvent] = useState<PlatformEvent | null>(null);
  const [tickets, setTickets] = useState<TicketOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [shareError, setShareError] = useState("");
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let live = true;
    fetchPlatformEvents()
      .then(async (events) => {
        const found = events.find((item) => eventSlug(item.title) === selectedSlug);
        if (!found) throw new Error("We couldn't find this event. It may have ended or moved.");
        const response = await fetch(`/api/ticketing/${eventSlug(found.title)}/ticket-types`);
        const ticketData = response.ok ? await response.json() : [];
        if (live) {
          setEvent(found);
          setTickets(Array.isArray(ticketData) ? ticketData : []);
        }
      })
      .catch((e: Error) => { if (live) setError(e.message); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [selectedSlug]);

  useEffect(() => { if (event) setPageMetadata(event.title + " | KutumbLink", event.description || "Event details and tickets on KutumbLink."); }, [event]);
  useEffect(() => {
    if (!event?.id) return;
    const query = new URLSearchParams(window.location.search);
    void fetch(`/api/fundraising/event-view/${event.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ source: query.get("utm_source"), medium: query.get("utm_medium"), campaign: query.get("utm_campaign") }) }).catch(() => undefined);
  }, [event?.id]);

  const hasTickets = tickets.some((ticket) => ticket.quantity_total === 0 || ticket.quantity_sold < ticket.quantity_total);
  const image = event ? eventImage(event) : "";

  const shareEvent = async () => {
    setShareError("");
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setShareError("Copy this page's address to share the event.");
    }
  };

  return (
    <div className="marketplace-app">
      <MarketplaceHeader />
      <main className="event-page">
        {loading ? <div className="event-page-loading"><div className="event-image-skeleton" /><div className="event-info-skeleton" /></div> : error && !event ? (
          <div className="market-empty-state event-not-found"><h2>Event unavailable</h2><p>{error}</p><Link to="/events" className="market-primary-button"><ArrowLeft size={16} /> Explore events</Link></div>
        ) : event ? (
          <>
            <Link to="/events" className="event-back-link"><ArrowLeft size={16} /> All events</Link>
            <div className="event-page-hero">
              {image ? <img src={image} alt="" /> : <div className="event-detail-art"><span>✳</span><strong>GOOD THINGS<br />HAPPEN TOGETHER</strong></div>}
              <button className="event-share-button" onClick={shareEvent}><Share2 size={16} /> {copied ? "Link copied" : "Share event"}</button>
            </div>
            {shareError && <p className="share-event-error" role="status">{shareError}</p>}
            <div className="event-page-layout">
              <section className="event-main-info">
                <span className="market-kicker">A KUTUMBLINK EVENT</span>
                <h1>{event.title}</h1>
                <div className="event-detail-lines">
                  <div><CalendarDays size={19} /><span>{prettyEventDate(event.date)}</span></div>
                  {event.time && <div><Clock3 size={19} /><span>{event.time}</span></div>}
                  <div><MapPin size={19} /><span>{event.eventMode === "online" ? "Online event" : event.location || "Location to be announced"}</span></div>
                </div>
                <div className="event-description"><h2>About this event</h2><p>{event.description || "Come along, meet your community and be part of a memorable day."}</p></div>
                {event.accessibilityNotes && <div className="event-description"><h2>Accessibility</h2><p>{event.accessibilityNotes}</p></div>}
                {!!event.faqs?.length && <div className="event-description"><h2>Common questions</h2>{event.faqs.map((faq, index) => <details key={`${faq.question}-${index}`} className="mb-2 rounded border p-3"><summary className="cursor-pointer font-medium">{faq.question}</summary><p className="mt-2">{faq.answer}</p></details>)}</div>}
                <div className="event-host-note"><span className="event-host-icon"><Ticket size={18} /></span><div><strong>{event.charitySlug ? <Link to={`/charities/${event.charitySlug}`}>{event.charityName || "View charity"}</Link> : "Hosted by a community organiser"}</strong><p>Event details and ticket options are provided by the organiser.</p></div></div>
              </section>
              <aside className="event-ticket-panel">
                <span className="ticket-panel-kicker">SAVE YOUR SPOT</span>
                <h2>{startingPrice(event)}</h2>
                <p className="ticket-panel-date"><CalendarDays size={16} /> {prettyEventDate(event.date)}</p>
                <div className="ticket-panel-divider" />
                {tickets.length > 0 ? (
                  <div className="ticket-option-list">
                    {tickets.map((ticket) => {
                      const remaining = ticket.quantity_total > 0 ? Math.max(ticket.quantity_total - ticket.quantity_sold, 0) : null;
                      return <div className="ticket-option" key={ticket.id}><div><strong>{ticket.name}</strong><span>{ticket.price_cents ? `$${(ticket.price_cents / 100).toFixed(2)} AUD` : "Free"}</span></div><small>{remaining === null ? "Available" : remaining > 0 ? `${remaining} left` : "Sold out"}</small></div>;
                    })}
                  </div>
                ) : <p className="ticket-not-ready">The organiser hasn't opened ticket sales for this event yet. Check back soon.</p>}
                <button className="market-primary-button ticket-buy-button" disabled={!hasTickets} onClick={() => setCheckoutOpen(true)}>{hasTickets ? "Get tickets" : "Tickets unavailable"}<ArrowLeft className="ticket-button-arrow" size={17} /></button>
                <div className="secure-checkout-note"><Check size={15} /> Secure checkout · No account needed</div>
                {event.availableSpots > 0 && <div className="event-spots-note">{event.availableSpots} places still available</div>}
              </aside>
            </div>
            <section className="event-detail-bottom"><span>MAKE PLANS. MAKE CONNECTIONS.</span><Link to={`/events?q=${encodeURIComponent(event.location || "")}`}>Explore more events <ArrowLeft size={15} /></Link></section>
            {checkoutOpen && <CheckoutModal eventTitle={event.title} onClose={() => setCheckoutOpen(false)} />}
          </>
        ) : null}
      </main>
      <MarketplaceFooter />
    </div>
  );
}
