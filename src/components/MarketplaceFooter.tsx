import { Link } from "react-router-dom";
import { Ticket } from "lucide-react";

export default function MarketplaceFooter() {
  return (
    <footer className="market-footer">
      <div className="market-footer-inner">
        <div>
          <Link to="/" className="market-brand market-footer-brand">
            <span className="market-brand-mark"><Ticket size={19} /></span>
            <span>Kutumb<span className="market-brand-light">Link</span></span>
          </Link>
          <p>Good events bring people together. We make it easier to find yours.</p>
        </div>
        <nav className="market-footer-links" aria-label="Legal and privacy links">
          <Link to="/privacy">Privacy and cookie policy</Link>
          <Link to="/terms">Terms of use</Link>
          <Link to="/organiser-terms">Organiser terms</Link>
          <Link to="/privacy-choices">Your privacy choices</Link>
        </nav>
        <span className="market-copyright">© {new Date().getFullYear()} KutumbLink</span>
      </div>
    </footer>
  );
}
