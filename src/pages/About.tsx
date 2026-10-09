import { ArrowRight, CalendarDays, HeartHandshake, Sparkles, Users } from "lucide-react";
import { Link } from "react-router-dom";
import MarketplaceHeader from "@/components/MarketplaceHeader";
import MarketplaceFooter from "@/components/MarketplaceFooter";

const pillars = [
  { icon: CalendarDays, title: "Events made easier", text: "Help people discover local events, book tickets and feel welcome from the first click." },
  { icon: HeartHandshake, title: "Good work, better connected", text: "Give Australian charities a simple place to share their work and invite people to take part." },
  { icon: Users, title: "Built around people", text: "Bring event participation, giving and community relationships together in one useful place." },
];

export default function About() {
  return (
    <div className="marketplace-app">
      <MarketplaceHeader />
      <main className="discovery-page">
        <section className="discovery-intro">
          <span className="market-kicker"><Sparkles className="mr-1 inline h-4 w-4" /> ABOUT KUTUMBLINK</span>
          <h1>A better way to<br /><span>bring good things together.</span></h1>
          <p>KutumbLink is an Australian platform for finding community events and helping charities grow their reach, fundraising and participation.</p>
        </section>
        <section className="mt-10 grid gap-5 md:grid-cols-3">
          {pillars.map(({ icon: Icon, title, text }) => <article key={title} className="rounded-2xl border bg-card p-6 shadow-sm"><span className="mb-4 inline-flex rounded-xl bg-primary/10 p-3 text-primary"><Icon /></span><h2 className="text-xl font-semibold">{title}</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">{text}</p></article>)}
        </section>
        <section className="mt-10 rounded-2xl bg-primary p-7 text-primary-foreground md:p-10">
          <span className="text-xs font-semibold tracking-[0.18em]">FOR AUSTRALIAN CHARITIES</span>
          <h2 className="mt-3 text-3xl font-semibold">Spend less time juggling tools.</h2>
          <p className="mt-3 max-w-2xl opacity-90">Create an organisation profile, publish events and campaigns, manage your team and keep supporter activity together in your charity workspace.</p>
          <div className="mt-6 flex flex-wrap gap-3"><Link className="inline-flex items-center gap-2 rounded-lg bg-white px-4 py-3 font-semibold text-primary" to="/charities/join">Join KutumbLink <ArrowRight size={17} /></Link><Link className="inline-flex items-center gap-2 rounded-lg border border-white/40 px-4 py-3 font-semibold" to="/host">Explore charity tools</Link></div>
        </section>
        <p className="mt-8 text-sm text-muted-foreground">KutumbLink is a new platform initiative. It is separate from the Kutumb community organisation and its existing website.</p>
      </main>
      <MarketplaceFooter />
    </div>
  );
}
