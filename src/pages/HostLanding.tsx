import { ArrowRight, BarChart3, CalendarPlus, Check, TicketCheck } from "lucide-react";
import { Link } from "react-router-dom";
import MarketplaceHeader from "@/components/MarketplaceHeader";
import MarketplaceFooter from "@/components/MarketplaceFooter";

const steps = [
  { icon: CalendarPlus, title: "Set up your event", copy: "Add the details people need to decide if it’s for them." },
  { icon: TicketCheck, title: "Offer the right tickets", copy: "Choose ticket types, prices and capacity in the organiser console." },
  { icon: BarChart3, title: "Welcome your guests", copy: "Track orders, manage your guest list and check people in." },
];

export default function HostLanding() {
  return (
    <div className="marketplace-app">
      <MarketplaceHeader />
      <main className="host-page">
        <section className="host-hero">
          <div className="host-hero-copy"><span className="market-eyebrow"><span className="host-eyebrow-dot" /> FOR EVENT ORGANISERS</span><h1>Make the event.<br /><span>We’ll help with the rest.</span></h1><p>One simple place to publish your event, offer tickets and keep the day running smoothly.</p><Link to="/organiser" className="market-primary-button">Open organiser console <ArrowRight size={17} /></Link><small>Already part of a charity team? Sign in to its workspace.</small><p className="mt-5 text-sm">New charity? <Link to="/charities/join" className="underline">Register your charity</Link>.</p></div>
          <div className="host-hero-graphic"><div className="host-graphic-grid" /><div className="host-ticket host-ticket-back"><span>YOUR NEXT<br />BIG THING</span></div><div className="host-ticket host-ticket-front"><TicketCheck size={30} /><strong>YOU’RE<br />ON THE LIST</strong><small>KUTUMBLINK · ADMIT ONE</small></div><span className="host-graphic-spark host-spark-a">✳</span><span className="host-graphic-spark host-spark-b">✦</span></div>
        </section>
        <section className="host-steps-section"><span className="market-kicker">FROM IDEA TO EVENT DAY</span><h2>Everything starts with a few details.</h2><div className="host-steps-grid">{steps.map(({ icon: Icon, title, copy }, index) => <article className="host-step" key={title}><span className="host-step-number">0{index + 1}</span><span className="host-step-icon"><Icon size={21} /></span><h3>{title}</h3><p>{copy}</p></article>)}</div></section>
        <section className="host-cta-band"><div><span className="market-kicker">YOUR COMMUNITY IS READY</span><h2>Let’s bring everyone together.</h2></div><Link to="/organiser" className="market-primary-button">Open charity workspace <ArrowRight size={17} /></Link></section>
        <p className="host-access-note"><Check size={15} /> Charity organisers use their own workspace. KutumbLink platform staff sign in separately.</p>
      </main>
      <MarketplaceFooter />
    </div>
  );
}
