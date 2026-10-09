import { Link, useParams } from "react-router-dom";
import { ArrowLeft, ArrowRight, BadgeCheck, MailCheck } from "lucide-react";
import MarketplaceHeader from "@/components/MarketplaceHeader";
import MarketplaceFooter from "@/components/MarketplaceFooter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Sample = { title: string; intro: string; rows: { label: string; value: string; detail: string }[]; action: string };

const samples: Record<string, Sample> = {
  donations: { title: "One-time donations", intro: "Example campaign: Help stock the neighbourhood community pantry.", action: "View donation workflow", rows: [{ label: "Raised", value: "A$2,460", detail: "of A$5,000 goal" }, { label: "Recent gift", value: "A$50", detail: "Sample supporter · one-time" }, { label: "Recent gift", value: "A$25", detail: "Sample supporter · one-time" }] },
  auctions: { title: "Community auction", intro: "Example item: A local chef’s dinner for four. The sample bids are not real offers.", action: "View auction workflow", rows: [{ label: "Current bid", value: "A$180", detail: "2 sample bids" }, { label: "Next minimum", value: "A$190", detail: "A$10 increment" }, { label: "Auction status", value: "Open", detail: "Example only · no checkout" }] },
  membership: { title: "Paid memberships", intro: "Example tiers and recurring prices shown in Australian dollars.", action: "View membership workflow", rows: [{ label: "Community member", value: "A$10 / month", detail: "Renews monthly until cancelled" }, { label: "Community patron", value: "A$120 / year", detail: "Renews annually until cancelled" }, { label: "Member record", value: "Sample member", detail: "Active until 30 June 2027" }] },
  peer: { title: "Peer-to-peer campaigns", intro: "Example: Supporters create personal pages, join teams and raise money for one campaign.", action: "View supporter fundraiser workflow", rows: [{ label: "Campaign", value: "Walk Together", detail: "A$8,400 raised of A$12,000" }, { label: "Northside team", value: "A$3,100", detail: "8 sample fundraisers" }, { label: "Personal page", value: "Alex’s 10 km walk", detail: "A$420 from 9 sample gifts" }] },
  stores: { title: "Online store", intro: "Example merchandise catalogue and stock. Sample orders do not reserve stock or charge a card.", action: "View store workflow", rows: [{ label: "Community tote", value: "A$25", detail: "18 sample units available" }, { label: "Tea towel", value: "A$15", detail: "32 sample units available" }, { label: "Recent order", value: "A$40", detail: "Sample order · awaiting fulfilment" }] },
  crm: { title: "CRM & donor management", intro: "Example supporter history and donation-based audience segment.", action: "View donor management workflow", rows: [{ label: "Supporter", value: "Sample supporter A", detail: "Record belongs to one organisation" }, { label: "Giving history", value: "A$240", detail: "3 sample donations" }, { label: "Saved segment", value: "Monthly pantry supporters", detail: "12 sample contacts · 9 opted in" }] },
  newsletter: { title: "Newsletter & emails", intro: "Example campaign analytics. No email is sent from this sample page.", action: "View email campaign workflow", rows: [{ label: "Campaign", value: "Winter pantry update", detail: "Sample campaign · sent" }, { label: "Delivery", value: "34 / 36", detail: "Sample sends accepted" }, { label: "Engagement", value: "21 opens · 8 clicks", detail: "Example analytics only" }] },
};

export default function FundraisingSamples() {
  const { capability = "" } = useParams();
  const sample = samples[capability];
  return <div className="marketplace-app min-h-screen flex flex-col"><MarketplaceHeader /><main className="discovery-page flex-1">
    <Link to="/fundraising" className="inline-flex items-center gap-2 text-sm underline"><ArrowLeft size={16} />Fundraising overview</Link>
    {!sample ? <Card className="mt-6"><CardContent className="p-8"><h1 className="text-2xl font-semibold">Sample page not found</h1><Link className="mt-4 inline-block underline" to="/fundraising">Return to fundraising</Link></CardContent></Card> : <>
      <div className="discovery-intro mt-6"><span className="market-kicker">SAMPLE PREVIEW · NOT LIVE</span><h1>{sample.title}</h1><p>{sample.intro}</p></div>
      <div role="note" className="mt-6 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950 dark:bg-amber-950 dark:text-amber-100">This page uses fictional sample data to demonstrate the layout. It does not create a real campaign, bid, membership, order, supporter record or email, and it will not process a payment.</div>
      <section aria-label={`${sample.title} sample data`} className="mt-6 grid gap-4 md:grid-cols-3">{sample.rows.map((row) => <Card key={row.label + row.value}><CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">{row.label}</CardTitle></CardHeader><CardContent><p className="text-2xl font-semibold">{row.value}</p><p className="mt-2 text-sm text-muted-foreground">{row.detail}</p></CardContent></Card>)}</section>
      <Card className="mt-6"><CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between"><div className="flex gap-3"><BadgeCheck className="mt-1 h-5 w-5 shrink-0 text-primary" /><p className="text-sm text-muted-foreground">To use real organisation data, sign in to the organiser workspace and configure the required organisation, database and payment settings.</p></div><Button asChild><Link to="/organiser/fundraising">{sample.action}<ArrowRight className="ml-2 h-4 w-4" /></Link></Button></CardContent></Card>
      <p className="mt-5 flex items-center gap-2 text-xs text-muted-foreground"><MailCheck size={15} />Any live campaign emails require supporter consent and configured sender details.</p>
    </>}
  </main><MarketplaceFooter /></div>;
}
