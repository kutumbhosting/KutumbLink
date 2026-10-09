import { Link, useLocation } from "react-router-dom";
import { ArrowUpRight, Ticket } from "lucide-react";

export default function MarketplaceHeader() {
  const location = useLocation();
  const isExplore = location.pathname === "/events" || location.pathname.startsWith("/events/");

  return (
    <header className="market-header">
      <div className="market-header-inner">
        <Link to="/" className="market-brand" aria-label="KutumbLink home">
          <span className="market-brand-mark"><Ticket size={21} strokeWidth={2.4} /></span>
          <span>Kutumb<span className="market-brand-light">Link</span></span>
        </Link>
        <nav className="market-nav" aria-label="Main navigation">
          <Link className={isExplore ? "active" : ""} to="/events">Find events</Link>
          <Link to="/pricing">A$0 Pricing</Link>
          <Link to="/about">About</Link>
        </nav>
        <details className="market-mobile-menu"><summary>Menu</summary><nav aria-label="Mobile main navigation"><Link to="/events">Find events</Link><Link to="/charities">Charities & causes</Link><Link to="/fundraising">Fundraising</Link><Link to="/pricing">A$0 Pricing</Link><Link to="/about">About KutumbLink</Link></nav></details>
        <Link className="market-header-cta" to="/host">
          Host an event <ArrowUpRight size={16} />
        </Link>
      </div>
    </header>
  );
}
