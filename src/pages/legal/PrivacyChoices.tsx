import { useEffect } from "react";
import { Link } from "react-router-dom";
import { Mail, MapPin, Settings2 } from "lucide-react";
import MarketplaceHeader from "@/components/MarketplaceHeader";
import MarketplaceFooter from "@/components/MarketplaceFooter";
import { LEGAL_EMAIL } from "@/lib/legalContent";

export default function PrivacyChoices() {
  useEffect(() => { document.title = "Your privacy choices | KutumbLink"; window.scrollTo(0, 0); }, []);
  return (
    <div className="marketplace-app flex min-h-screen flex-col">
      <MarketplaceHeader />
      <main className="flex-1 bg-muted/20 px-4 py-10 sm:py-14">
        <div className="mx-auto max-w-3xl rounded-xl border bg-card p-6 shadow-sm sm:p-10">
          <span className="market-kicker">YOUR CONTROL</span>
          <h1 className="mt-2 text-3xl font-bold tracking-tight">Your privacy choices</h1>
          <p className="mt-3 text-muted-foreground">Choose what you share and how KutumbLink contacts you. We do not currently use advertising or third-party analytics cookies.</p>
          <div className="mt-7 grid gap-4">
            <section className="rounded-lg border p-5">
              <h2 className="flex items-center gap-2 font-semibold"><MapPin size={18} /> Location</h2>
              <p className="mt-2 text-sm text-muted-foreground">“Use my location” is optional. Your browser will ask permission; approximate coordinates go to KutumbLink and are forwarded to the configured geocoding service (OpenStreetMap by default) to identify a nearby area. We briefly cache a rounded lookup to limit repeat requests, but do not save precise coordinates to your account. Revoke or change location permission in your browser’s site settings.</p>
            </section>
            <section className="rounded-lg border p-5">
              <h2 className="flex items-center gap-2 font-semibold"><Settings2 size={18} /> Cookies</h2>
              <p className="mt-2 text-sm text-muted-foreground">Necessary sign-in and interface preference cookies support core features. You can block or clear them in your browser settings, though this may sign you out or reset a preference.</p>
            </section>
            <section className="rounded-lg border p-5">
              <h2 className="flex items-center gap-2 font-semibold"><Mail size={18} /> Messages and personal information</h2>
              <p className="mt-2 text-sm text-muted-foreground">Use the unsubscribe link in a marketing email to stop those messages. You can request access, correction or deletion of information by contacting us; we may retain records where required for legal, payment or accounting purposes.</p>
              <div className="mt-4 flex flex-wrap gap-3">
                <Link className="market-primary-button" to="/supporter/access">Manage supporter account</Link>
                <a className="market-outline-button" href={`mailto:${LEGAL_EMAIL}?subject=Privacy%20request`}>Email a privacy request</a>
              </div>
            </section>
          </div>
          <p className="mt-6 text-sm text-muted-foreground">For more detail, read our <Link className="underline" to="/privacy">Privacy and cookie policy</Link>.</p>
        </div>
      </main>
      <MarketplaceFooter />
    </div>
  );
}
