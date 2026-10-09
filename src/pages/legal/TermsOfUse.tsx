import { useEffect } from "react";
import MarketplaceHeader from "@/components/MarketplaceHeader";
import MarketplaceFooter from "@/components/MarketplaceFooter";
import LegalDocument from "@/components/LegalDocument";
import { LEGAL_DOCS } from "@/lib/legalContent";

export default function TermsOfUse() {
  useEffect(() => { document.title = "Terms of use | KutumbLink"; window.scrollTo(0, 0); }, []);
  return (
    <div className="marketplace-app flex min-h-screen flex-col">
      <MarketplaceHeader />
      <main className="flex-1 bg-muted/20 px-4 py-10 sm:py-14">
        <div className="mx-auto max-w-3xl rounded-xl border bg-card p-6 shadow-sm sm:p-10">
          <LegalDocument doc={LEGAL_DOCS.terms} />
        </div>
      </main>
      <MarketplaceFooter />
    </div>
  );
}
