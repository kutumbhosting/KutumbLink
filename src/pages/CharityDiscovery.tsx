import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import MarketplaceHeader from "@/components/MarketplaceHeader";
import MarketplaceFooter from "@/components/MarketplaceFooter";
import ExploreTabs from "@/components/ExploreTabs";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export default function CharityDiscovery() {
  const [params, setParams] = useSearchParams();
  const [charities, setCharities] = useState<any[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => { document.title = "Find charities and causes | KutumbLink"; fetch("/api/organisations/public").then((r) => r.json()).then((data) => setCharities(Array.isArray(data) ? data : [])).catch(() => setCharities([])).finally(() => setLoading(false)); }, []);
  const cause = params.get("cause") || "";
  const causes = useMemo(() => Array.from(new Set(charities.flatMap((charity) => Array.isArray(charity.causes) ? charity.causes : []))).sort((a: string, b: string) => a.localeCompare(b)), [charities]);
  const visible = useMemo(() => charities.filter((charity) => {
    const text = [charity.public_name, charity.legal_name, charity.description, charity.suburb, charity.state, ...(charity.causes || [])].join(" ").toLowerCase();
    return (!search.trim() || search.trim().toLowerCase().split(/\s+/).every((part) => text.includes(part))) && (!cause || (charity.causes || []).some((value: string) => value.toLowerCase() === cause.toLowerCase()));
  }), [charities, search, cause]);
  const selectCause = (value: string) => { const next = new URLSearchParams(params); if (value) next.set("cause", value); else next.delete("cause"); setParams(next, { replace: true }); };

  return <div className="marketplace-app"><MarketplaceHeader /><ExploreTabs /><main className="discovery-page">
    <div className="discovery-intro"><span className="market-kicker">SUPPORT GOOD WORK</span><h1>Charities & causes<br /><span>that matter to you.</span></h1><p>Browse approved Australian community organisations, then filter by the causes they support.</p></div>
    <div className="discovery-tools"><label className="discovery-search"><span className="sr-only">Search charities</span><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, cause or location" /></label><label className="discovery-location"><span>Cause</span><select aria-label="Filter charities by cause" value={cause} onChange={(e) => selectCause(e.target.value)}><option value="">All causes</option>{causes.map((value) => <option key={value} value={value}>{value}</option>)}</select></label></div>
    {causes.length > 0 && <section aria-label="Browse causes" className="mt-5"><h2 className="text-sm font-semibold">Browse by cause</h2><div className="mt-2 flex flex-wrap gap-2"><button type="button" onClick={() => selectCause("")} className={`rounded-full border px-3 py-1.5 text-sm ${!cause ? "border-primary bg-primary text-primary-foreground" : "hover:border-primary"}`}>All causes</button>{causes.map((value) => <button type="button" key={value} onClick={() => selectCause(value)} aria-pressed={cause.toLowerCase() === value.toLowerCase()} className={`rounded-full border px-3 py-1.5 text-sm ${cause.toLowerCase() === value.toLowerCase() ? "border-primary bg-primary text-primary-foreground" : "hover:border-primary"}`}>{value}</button>)}</div></section>}
    <div className="discovery-results-heading mt-6"><div><h2>{cause ? `${cause} charities` : "Charities"}</h2><span>{loading ? "Loading…" : `${visible.length} ${visible.length === 1 ? "charity" : "charities"}`}</span></div>{cause && <Link className="text-sm underline" to={`/events?cause=${encodeURIComponent(cause)}`}>See {cause.toLowerCase()} events</Link>}</div>
    {loading ? <p className="py-10 text-muted-foreground">Loading charities…</p> : visible.length ? <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">{visible.map((charity) => <Card key={charity.id}><CardContent className="p-5">{charity.logo_url && <img src={charity.logo_url} alt="" className="mb-3 h-14 w-14 rounded-lg object-contain" />}<p className="text-xs text-primary">KutumbLink approved</p><h2 className="mt-1 text-lg font-semibold">{charity.public_name || charity.legal_name}</h2><p className="mt-1 text-sm text-muted-foreground">{[charity.suburb, charity.state].filter(Boolean).join(", ")}</p><p className="mt-3 line-clamp-3 text-sm text-muted-foreground">{charity.description}</p><div className="mt-3 flex flex-wrap gap-2">{(charity.causes || []).slice(0, 3).map((item: string) => <Link key={item} className="rounded-full border px-2 py-1 text-xs" to={`/charities?cause=${encodeURIComponent(item)}`}>{item}</Link>)}</div><Button className="mt-4 w-full" asChild><Link to={`/charities/${charity.slug}`}>View charity</Link></Button></CardContent></Card>)}</div> : <div className="market-empty-state"><h2>{cause ? `No charities listed for ${cause}` : "No charities found"}</h2><p>Try another cause, name or location. You can also <Link className="underline" to={cause ? `/events?cause=${encodeURIComponent(cause)}` : "/events"}>browse matching events</Link>.</p>{cause && <Button variant="outline" className="mt-4" onClick={() => selectCause("")}>Clear cause filter</Button>}</div>}
  </main><MarketplaceFooter /></div>;
}
