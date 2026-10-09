import { ArrowRight, Check, Info, Mail } from "lucide-react";
import { Link } from "react-router-dom";
import MarketplaceHeader from "@/components/MarketplaceHeader";
import MarketplaceFooter from "@/components/MarketplaceFooter";

const included = [
  "Charity and campaign pages",
  "One-time donations in AUD",
  "Supporter-led fundraising pages and teams",
  "Public auctions with bids and winner checkout",
  "Paid memberships with monthly or annual renewals",
  "Online stores, stock and Australian delivery checkout",
  "Donor history, saved segments and consent-aware email campaigns",
  "Event listings, ticketing and registrations",
  "Supporter and member records with activity history",
  "Fundraiser reporting and team progress",
  "Organiser tools, roles and event check-in",
];

export default function Pricing() {
  return (
    <div className="marketplace-app">
      <MarketplaceHeader />
      <main className="discovery-page">
        <section className="discovery-intro">
          <span className="market-kicker">ALWAYS FREE</span>
          <h1>A$0, always free.<br /><span>No KutumbLink platform fee.</span></h1>
          <p>There is no subscription, setup charge, or percentage taken by KutumbLink. The same available tools are included for every organisation.</p>
        </section>

        <section className="mt-10 grid gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
          <article className="rounded-2xl border-2 border-primary bg-card p-6 shadow-sm md:p-8">
            <span className="text-xs font-semibold tracking-[0.16em] text-primary">ALL ORGANISATIONS</span>
            <h2 className="mt-3 text-2xl font-semibold">One plan</h2>
            <p className="mt-2 text-muted-foreground">For fundraising, events and supporter tools.</p>
            <p className="my-6 text-4xl font-bold">A$0</p>
            <p className="text-sm text-muted-foreground">No KutumbLink subscription or platform transaction fee.</p>
          </article>
          <article className="rounded-2xl border bg-card p-6 shadow-sm md:p-8">
            <h2 className="text-xl font-semibold">Included in the platform</h2>
            <p className="mt-2 text-sm text-muted-foreground">Available tools for Australian charities and community organisations.</p>
            <ul className="mt-5 grid gap-3 sm:grid-cols-2">{included.map((item) => <li key={item} className="flex items-start gap-2 text-sm"><Check className="h-5 w-5 shrink-0 text-primary" />{item}</li>)}</ul>
          </article>
        </section>

        <section className="mt-8 rounded-2xl bg-muted/50 p-6 md:p-8">
          <div className="flex items-start gap-3">
            <Info className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
            <div>
              <h2 className="text-lg font-semibold">Payment and Australian charity details</h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">KutumbLink does not add a platform fee. Banks and payment providers may charge the organisation their own processing fees under the organisation’s provider agreement. Donation receipts must not describe a gift as tax-deductible unless the recipient is entitled to receive deductible gifts and the particular payment qualifies. Fundraising, raffles and gaming can have state or territory requirements.</p>
            </div>
          </div>
        </section>

        <section className="mt-8 rounded-2xl border p-6 md:p-8">
          <h2 className="text-xl font-semibold">What this package supports today</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">The package includes donations, supporter-led campaigns and teams, public auctions, paid monthly and annual memberships, online stores, organisation-scoped donor records and segments, and consent-aware scheduled emails. Live tools need an organisation with data; checkouts and email campaigns require provider setup. Raffle sales are not offered because gaming rules vary by state and territory.</p>
          <Link className="mt-5 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-3 font-semibold text-primary-foreground" to="/charities/join"><Mail size={16} /> Get started <ArrowRight size={16} /></Link>
        </section>
      </main>
      <MarketplaceFooter />
    </div>
  );
}
