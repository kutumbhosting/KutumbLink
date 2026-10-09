import { useEffect, useMemo, useState } from "react";
import { Search, SlidersHorizontal, X } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import MarketplaceHeader from "@/components/MarketplaceHeader";
import MarketplaceFooter from "@/components/MarketplaceFooter";
import ExploreTabs from "@/components/ExploreTabs";
import EventCard from "@/components/EventCard";
import { fetchPlatformEvents, type PlatformEvent } from "@/lib/platformEvents";

const filters = ["All events", "Free", "Community", "Music & arts", "Wellness", "Fundraisers"];

export default function EventDiscovery() {
  const [params, setParams] = useSearchParams();
  const [events, setEvents] = useState<PlatformEvent[]>([]);
  const [charityCauses, setCharityCauses] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("All events");
  const [search, setSearch] = useState(params.get("q") || "");
  const [place, setPlace] = useState(params.get("place") || "");
  const [dateFrom, setDateFrom] = useState(params.get("from") || "");
  const [dateTo, setDateTo] = useState(params.get("to") || "");
  const [cause, setCause] = useState(params.get("cause") || "");
  const [eventMode, setEventMode] = useState(params.get("mode") || "");
  const [priceType, setPriceType] = useState(params.get("price") || "");

  useEffect(() => {
    fetchPlatformEvents().then(setEvents).catch((e: Error) => setError(e.message)).finally(() => setLoading(false));
    fetch("/api/organisations/public").then((response) => response.json()).then((data) => {
      if (Array.isArray(data)) setCharityCauses(data.flatMap((charity) => Array.isArray(charity.causes) ? charity.causes : []));
    }).catch(() => {});
  }, []);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const loc = place.trim().toLowerCase();
    return events.filter((event) => {
      const text = `${event.title} ${event.description || ""} ${event.location || ""} ${event.charityName || ""} ${(event.causes || []).join(" ")}`.toLowerCase();
      const matchesSearch = !q || q.split(/\s+/).every((part) => text.includes(part));
      const matchesPlace = !loc || (event.location || "").toLowerCase().includes(loc);
      const eventDate = new Date(event.date || "").getTime();
      const matchesDate = (!dateFrom || (Number.isFinite(eventDate) && eventDate >= new Date(dateFrom).getTime())) && (!dateTo || (Number.isFinite(eventDate) && eventDate <= new Date(dateTo + "T23:59:59").getTime()));
      const typeText = (event.eventType || "community").toLowerCase().replace(/_/g, " ");
      const matchesFilter = filter === "All events" || (filter === "Free" ? !(Number(event.startingPriceCents ?? (Number(event.nonMemberFee || 0) * 100)) > 0)
        : filter === "Fundraisers" ? typeText.includes("fundrais") : filter === "Community" ? typeText.includes("community")
          : text.includes(filter.toLowerCase().split(" ")[0]) || typeText.includes(filter.toLowerCase().split(" ")[0]));
      const matchesCause = !cause || (event.causes || []).some((value) => value.toLowerCase() === cause.toLowerCase());
      const matchesMode = !eventMode || event.eventMode === eventMode;
      const price = Number(event.startingPriceCents ?? (Number(event.nonMemberFee || 0) * 100));
      const matchesPrice = !priceType || (priceType === "free" ? price === 0 : price > 0);
      return matchesSearch && matchesPlace && matchesFilter && matchesDate && matchesCause && matchesMode && matchesPrice;
    });
  }, [events, filter, place, search, dateFrom, dateTo, cause, eventMode, priceType]);

  const updateSearch = (nextSearch: string, nextPlace = place) => {
    setSearch(nextSearch);
    const next = new URLSearchParams(window.location.search);
    next.delete("q"); next.delete("place");
    if (nextSearch.trim()) next.set("q", nextSearch.trim());
    if (nextPlace.trim()) next.set("place", nextPlace.trim());
    setParams(next, { replace: true });
  };

  const setFilterParam = (key: string, value: string, setter: (next: string) => void) => {
    setter(value);
    const next = new URLSearchParams(window.location.search);
    if (value) next.set(key, value); else next.delete(key);
    setParams(next, { replace: true });
  };
  const clearFilters = () => {
    setFilter("All events"); setSearch(""); setPlace(""); setDateFrom(""); setDateTo(""); setCause(""); setEventMode(""); setPriceType("");
    setParams(new URLSearchParams(), { replace: true });
  };
  const causes = Array.from(new Set([...charityCauses, ...events.flatMap((event) => event.causes || [])])).sort((a, b) => a.localeCompare(b));

  return (
    <div className="marketplace-app">
      <MarketplaceHeader />
      <ExploreTabs />
      <main className="discovery-page">
        <div className="discovery-intro"><span className="market-kicker">MAKE ROOM FOR SOMETHING GOOD</span><h1>Find your next<br /><span>great experience.</span></h1><p>Discover events created by people bringing their communities together.</p></div>
        <div className="discovery-tools">
          <label className="discovery-search"><Search size={18} /><span className="sr-only">Search events</span><input value={search} onChange={(e) => updateSearch(e.target.value)} placeholder="Search events, interests or organisers" /></label>
          <label className="discovery-location"><span className="sr-only">Filter by location</span><input value={place} onChange={(e) => updateSearch(search, e.target.value)} placeholder="Any location" /></label>
          <details className="discovery-filter-label"><summary><SlidersHorizontal size={16} /> More filters</summary><div className="discovery-advanced-filters"><label>From<input type="date" value={dateFrom} onChange={(e) => setFilterParam("from", e.target.value, setDateFrom)} /></label><label>To<input type="date" value={dateTo} onChange={(e) => setFilterParam("to", e.target.value, setDateTo)} /></label><label>Cause<select value={cause} onChange={(e) => setFilterParam("cause", e.target.value, setCause)}><option value="">Any cause</option>{causes.map((value) => <option key={value}>{value}</option>)}</select></label><label>Format<select value={eventMode} onChange={(e) => setFilterParam("mode", e.target.value, setEventMode)}><option value="">Any format</option><option value="in_person">In person</option><option value="online">Online</option><option value="hybrid">Hybrid</option></select></label><label>Price<select value={priceType} onChange={(e) => setFilterParam("price", e.target.value, setPriceType)}><option value="">Free or paid</option><option value="free">Free</option><option value="paid">Paid</option></select></label></div></details>
        </div>
        <div className="discovery-filter-row" role="tablist" aria-label="Browse events by category">
          {filters.map((option) => <button type="button" role="tab" aria-selected={filter === option} key={option} className={filter === option ? "selected" : ""} onClick={() => setFilter(option)}>{option}</button>)}
          {(search || place || filter !== "All events" || dateFrom || dateTo || cause || eventMode || priceType) && <button className="clear-filters" onClick={clearFilters}><X size={14} /> Clear</button>}
        </div>
        <div className="discovery-results-heading"><div><h2>{search || place || dateFrom || dateTo || cause || eventMode || priceType ? "Search results" : "Events worth getting out for"}</h2><span>{loading ? "Loading events…" : `${visible.length} ${visible.length === 1 ? "event" : "events"}`}</span></div></div>
        {loading ? <div className="event-card-grid">{[0, 1, 2, 3, 4, 5].map((n) => <div className="event-card-skeleton" key={n}><div /><span /><span /><span /></div>)}</div> : error ? (
          <div className="market-empty-state"><p>{error}</p><button className="market-inline-button" onClick={() => location.reload()}>Try again</button></div>
        ) : visible.length ? <div className="event-card-grid">{visible.map((event, index) => <EventCard key={event.title} event={event} index={index} />)}</div> : (
          <div className="market-empty-state"><span className="empty-sparkle">✳</span><h3>No events match that search</h3><p>Try a different keyword, date or location. New community events are added all the time.</p><button className="market-outline-button" onClick={clearFilters}>Show all events <X size={15} /></button></div>
        )}
      </main>
      <MarketplaceFooter />
    </div>
  );
}
