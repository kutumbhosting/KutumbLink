import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import MarketplaceHeader from "@/components/MarketplaceHeader";
import MarketplaceFooter from "@/components/MarketplaceFooter";
import ExploreTabs from "@/components/ExploreTabs";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ContactRound, Gavel, HandCoins, HeartHandshake, Mail, ShoppingBag, UsersRound } from "lucide-react";

const fundraisingTools = [
  { title: "Donations", detail: "Publish a campaign and accept one-time donations in AUD.", icon: HeartHandshake, path: "donations" },
  { title: "Auctions", detail: "Publish event items, collect public bids, award winners and take secure card payment.", icon: Gavel, path: "auctions" },
  { title: "Membership", detail: "Create monthly or annual paid tiers with automatic Stripe renewals.", icon: UsersRound, path: "membership" },
  { title: "Peer-to-Peer Campaigns", detail: "Supporters create fundraising pages, join teams and raise money for a campaign.", icon: HandCoins, path: "peer" },
  { title: "Online Stores", detail: "Publish products, manage stock and take secure AUD checkout payments.", icon: ShoppingBag, path: "stores" },
  { title: "CRM & Donor Management", detail: "Review organisation-scoped supporter histories and save donation-based audience segments.", icon: ContactRound, path: "crm" },
  { title: "Newsletter & Emails", detail: "Compose and schedule updates, send only to opted-in supporters, and review send/open results.", icon: Mail, path: "newsletter" },
];

export default function CommunityOpportunities() {
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [auctions, setAuctions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    document.title = "Fundraising | KutumbLink";
    fetch("/api/organisations/public-campaigns").then((response) => response.json()).then((data) => setCampaigns(Array.isArray(data) ? data : [])).catch(() => setCampaigns([])).finally(() => setLoading(false));
    fetch("/api/fundraising-tools/auctions").then((response) => response.json()).then((data) => setAuctions(Array.isArray(data) ? data : [])).catch(() => setAuctions([]));
  }, []);

  return <div className="marketplace-app"><MarketplaceHeader /><ExploreTabs /><main className="discovery-page">
    <div className="discovery-intro"><span className="market-kicker">HELP GOOD WORK GROW</span><h1>Fundraising that makes a difference.</h1><p>Support published campaigns from approved Australian charities.</p></div>
    <section aria-labelledby="fundraising-tools-heading" className="mt-10">
      <div className="mb-5"><span className="market-kicker">FUNDRAISING TOOLS</span><h2 id="fundraising-tools-heading" className="mt-2 text-2xl font-semibold">More ways to bring supporters together</h2><p className="mt-2 text-sm text-muted-foreground">KutumbLink platform pricing is A$0. Explore each fundraising tool. Live campaigns need organisation data; payment and email actions also need provider setup.</p><Button asChild className="mt-4"><Link to="/organiser">Open organiser workspace</Link></Button></div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{fundraisingTools.map(({ title, detail, icon: Icon, path }) => <Link key={title} to={`/fundraising/demo/${path}`} className="block h-full rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><Card className="h-full transition-all duration-200 hover:-translate-y-1 hover:border-primary hover:shadow-md motion-reduce:transform-none"><CardContent className="h-full p-5"><div className="flex items-center justify-end gap-3"><Icon aria-hidden="true" className="h-5 w-5 text-primary" /></div><h3 className="mt-4 font-semibold">{title}</h3><p className="mt-2 text-sm leading-6 text-muted-foreground">{detail}</p><span className="mt-4 inline-block text-sm font-medium text-primary">Explore {title} →</span></CardContent></Card></Link>)}</div>
    </section>
    <section aria-labelledby="open-auctions-heading" className="mt-12"><div className="discovery-intro"><span className="market-kicker">BID FOR A CAUSE</span><h2 id="open-auctions-heading">Open auctions</h2></div>{auctions.length ? <div className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-3">{auctions.map((auction: any) => <Card key={auction.id}><CardContent className="p-5"><p className="text-xs text-primary">{auction.public_name || auction.legal_name}</p><h3 className="mt-1 font-semibold">{auction.title}</h3><p className="mt-2 text-sm text-muted-foreground">Current bid A${Number(auction.current_bid).toFixed(2)} · {auction.ends_at ? `Closes ${new Date(auction.ends_at).toLocaleString()}` : "Open now"}</p><Button asChild className="mt-4 w-full"><Link to={`/fundraising/auctions/${auction.slug}`}>View auction & bid</Link></Button></CardContent></Card>)}</div> : <Card className="mt-4"><CardContent className="p-5"><span className="market-kicker">EXAMPLE ONLY</span><h3 className="mt-2 font-semibold">Harbour lunch for four · sample current bid A$180</h3><p className="mt-2 text-sm text-muted-foreground">No live auctions have been published yet. Preview an auction with sample data.</p><Button asChild className="mt-4"><Link to="/fundraising/demo/auctions">Open auction sample</Link></Button></CardContent></Card>}</section>
    <section id="published-campaigns" aria-labelledby="published-campaigns-heading" className="mt-12">
      <div className="discovery-intro"><span className="market-kicker">SUPPORT A CAUSE</span><h2 id="published-campaigns-heading">Published campaigns</h2></div>
      {loading ? <p className="py-10 text-muted-foreground">Loading campaigns…</p> : campaigns.length ? <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">{campaigns.map((campaign) => <Card key={campaign.id}><CardContent className="p-5"><p className="text-xs font-medium text-primary">{campaign.public_name || campaign.legal_name}</p><h3 className="mt-1 text-lg font-semibold">{campaign.title}</h3><p className="mt-3 text-sm text-muted-foreground">{campaign.description || "Learn more about this campaign."}</p><Button asChild className="mt-4 w-full"><a href={campaign.fundraising_url} target="_blank" rel="noreferrer">Support campaign</a></Button><Link className="mt-3 block text-center text-xs underline" to={`/charities/${campaign.organisation_slug || campaign.slug}`}>View charity profile</Link></CardContent></Card>)}</div> : <div className="market-empty-state"><h3>No published campaigns yet</h3><p>Browse <Link className="underline" to="/charities">approved charities</Link> or open an explicitly marked example.</p><Card className="mt-4 text-left"><CardContent className="p-5"><span className="market-kicker">EXAMPLE ONLY</span><h4 className="mt-2 font-semibold">Help stock the neighbourhood pantry</h4><p className="mt-2 text-sm text-muted-foreground">Sample campaign · A$2,460 raised of A$5,000.</p><Button asChild className="mt-4"><Link to="/fundraising/demo/donations">Open donations sample</Link></Button></CardContent></Card></div>}
    </section>
  </main><MarketplaceFooter /></div>;
}
