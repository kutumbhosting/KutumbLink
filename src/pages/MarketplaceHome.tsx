import { useEffect, useState, type FormEvent } from "react";
import { ArrowRight, ArrowUpRight, CalendarDays, HeartHandshake, MapPin, Search, Sparkles, Ticket } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import MarketplaceHeader from "@/components/MarketplaceHeader";
import MarketplaceFooter from "@/components/MarketplaceFooter";
import ExploreTabs from "@/components/ExploreTabs";
import EventCard from "@/components/EventCard";
import { fetchPlatformEvents, eventImage, prettyEventDate, startingPrice, type PlatformEvent } from "@/lib/platformEvents";

const categories = ["Community", "Music & arts", "Food & drink", "Wellness", "Fundraisers"];

export default function MarketplaceHome() {
  const navigate = useNavigate();
  const [events, setEvents] = useState<PlatformEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [search, setSearch] = useState("");
  const [place, setPlace] = useState("");

  const loadEvents = () => {
    setLoading(true);
    setLoadError("");
    fetchPlatformEvents()
      .then(setEvents)
      .catch((error: Error) => setLoadError(error.message))
      .finally(() => setLoading(false));
  };

  useEffect(loadEvents, []);

  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
    const params = new URLSearchParams();
    if (search.trim()) params.set("q", search.trim());
    if (place.trim()) params.set("place", place.trim());
    const query = params.toString();
    navigate(`/events${query ? `?${query}` : ""}`);
  };

  const featured = events[0];

  return (
    <div className="marketplace-app">
      <MarketplaceHeader />
      <ExploreTabs />
      <main>
        <section className="market-hero">
          <div className="market-hero-inner">
            <div className="market-hero-copy">
              <div className="market-eyebrow"><Sparkles size={15} /> FIND YOUR PEOPLE. FIND YOUR THING.</div>
              <h1>Good things<br /><span>happen together.</span></h1>
              <p>Discover local events, meet your community and be part of something good.</p>
              <form className="market-search" onSubmit={submitSearch}>
                <label className="market-search-field">
                  <Search size={19} />
                  <span className="sr-only">What are you looking for?</span>
                  <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="What are you in the mood for?" />
                </label>
                <span className="market-search-divider" />
                <label className="market-search-field market-place-field">
                  <MapPin size={19} />
                  <span className="sr-only">Location</span>
                  <input value={place} onChange={(e) => setPlace(e.target.value)} placeholder="City or postcode" />
                </label>
                <button className="market-search-button" type="submit" aria-label="Search events"><Search size={19} /><span>Search</span></button>
              </form>
              <div className="market-popular-searches">
                <span>Popular:</span>
                {categories.slice(0, 3).map((category) => <button key={category} onClick={() => navigate(`/events?q=${encodeURIComponent(category)}`)}>{category}</button>)}
              </div>
            </div>
            <div className="market-hero-visual" aria-label="Discover local events">
              <div className="hero-orbit hero-orbit-one" />
              <div className="hero-orbit hero-orbit-two" />
              <div className="hero-sticker hero-sticker-yellow"><span>GO OUT</span><span>DO GOOD</span><Sparkles size={22} /></div>
              {featured && eventImage(featured) ? (
                <div className="hero-featured-card">
                  <img src={eventImage(featured)} alt="" />
                  <div><span className="hero-card-label">A GOOD PLACE TO START</span><strong>{featured.title}</strong><small><CalendarDays size={14} /> {prettyEventDate(featured.date)}</small></div>
                </div>
              ) : (
                <div className="hero-featured-card hero-featured-placeholder">
                  <div className="hero-illustration"><span>✳</span><span>♡</span><span>✦</span></div>
                  <div><span className="hero-card-label">YOUR NEXT GOOD DAY</span><strong>Find an event that feels like you.</strong><small><Ticket size={14} /> Local events, made easy</small></div>
                </div>
              )}
              <div className="hero-sticker hero-sticker-purple"><HeartHandshake size={20} /><span>MADE FOR<br />COMMUNITY</span></div>
              <div className="hero-floating-dot" />
            </div>
          </div>
          <div className="market-hero-bottomline"><span>Make plans. Make connections. Make a difference.</span><span>EXPLORE WHAT'S ON <ArrowRight size={14} /></span></div>
        </section>

        <section className="market-category-section">
          <div className="market-section-heading"><div><span className="market-kicker">A LITTLE BIT OF EVERYTHING</span><h2>What are you into?</h2></div><Link to="/events" className="market-text-link">Explore all <ArrowUpRight size={16} /></Link></div>
          <div className="market-category-row">
            {categories.map((category, i) => (
              <Link key={category} to={`/events?q=${encodeURIComponent(category)}`} className={`market-category category-${i}`}>
                <span className="market-category-icon">{[<Sparkles key="a" />, <Ticket key="b" />, <HeartHandshake key="c" />, <CalendarDays key="d" />, <MapPin key="e" />][i]}</span>
                <span>{category}</span><ArrowUpRight size={16} />
              </Link>
            ))}
          </div>
        </section>

        <section className="market-events-section">
          <div className="market-section-heading"><div><span className="market-kicker">YOUR NEXT STORY STARTS HERE</span><h2>Coming up near you</h2></div><Link to="/events" className="market-text-link">See all events <ArrowUpRight size={16} /></Link></div>
          {loading ? <div className="event-card-grid">{[0, 1, 2].map((n) => <div className="event-card-skeleton" key={n}><div /><span /><span /><span /></div>)}</div> : loadError ? (
            <div className="market-empty-state"><p>{loadError}</p><button className="market-inline-button" onClick={loadEvents}>Try again</button></div>
          ) : events.length ? (
            <div className="event-card-grid">{events.slice(0, 3).map((event, index) => <EventCard key={event.title} event={event} index={index} />)}</div>
          ) : (
            <div className="market-empty-state"><span className="empty-sparkle">✳</span><h3>Something good is on its way</h3><p>There aren't any events listed yet. Check back soon or explore what organisers can create.</p><Link to="/host" className="market-outline-button">For event organisers <ArrowRight size={16} /></Link></div>
          )}
        </section>

        <section className="market-host-banner">
          <div className="market-host-art"><div className="host-sun" /><div className="host-shape host-shape-a" /><div className="host-shape host-shape-b" /><span>BRING<br />PEOPLE<br />TOGETHER</span></div>
          <div className="market-host-copy"><span className="market-kicker">FOR THE PEOPLE WHO MAKE IT HAPPEN</span><h2>Your event deserves a great start.</h2><p>From the first ticket to the final thank-you, make it simple for people to show up for what matters.</p><Link to="/host" className="market-primary-button">Host an event <ArrowRight size={17} /></Link></div>
          <ArrowUpRight className="market-host-arrow" size={26} />
        </section>
        <section className="market-impact-line"><HeartHandshake size={19} /><span>Built to help communities connect, celebrate and raise support.</span></section>
      </main>
      <MarketplaceFooter />
    </div>
  );
}
