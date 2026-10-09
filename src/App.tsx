import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Routes, Route, Navigate } from "react-router-dom";

import About from "./pages/About";
import Executive from "./pages/Executive";
import Activities from "./pages/Activities";
import Events from "./pages/Events";
import Membership from "./pages/Membership";
import Contact from "./pages/Contact";
import NotFound from "./pages/NotFound";
import Admin from "./pages/Admin"; // 👈 ADD THIS
import CheckInStaff from "./pages/CheckInStaff";
import PrivacyPolicy from "./pages/PrivacyPolicy";
import EventTerms from "./pages/EventTerms";
import CheckoutReturn from "./pages/CheckoutReturn";
import PayRegistration from "./pages/PayRegistration";
import MarketplaceHome from "./pages/MarketplaceHome";
import EventDiscovery from "./pages/EventDiscovery";
import EventListing from "./pages/EventListing";
import HostLanding from "./pages/HostLanding";
import PublicCharityProfile from "./pages/PublicCharityProfile";
import SupporterPortal from "./pages/SupporterPortal";
import CharityJoin from "./pages/CharityJoin";
import TermsOfUse from "./pages/legal/TermsOfUse";
import PrivacyPolicyPage from "./pages/legal/PrivacyPolicyPage";
import OrganiserTermsPage from "./pages/legal/OrganiserTermsPage";
import PrivacyChoices from "./pages/legal/PrivacyChoices";
import CharityDiscovery from "./pages/CharityDiscovery";
import CommunityOpportunities from "./pages/CommunityOpportunities";
import Pricing from "./pages/Pricing";
import OrganiserConsole from "./pages/OrganiserConsole";
import CampaignPage from "./pages/fundraising/CampaignPage";
import FundraiserPage from "./pages/fundraising/FundraiserPage";
import FundraisingSuite from "./pages/FundraisingSuite";
import FundraisingSamples from "./pages/FundraisingSamples";
import { AuctionPage, StorePage, MembershipPage, MembershipManagePage, FundraisingCheckoutReturn } from "./pages/FundraisingCommerce";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />

      {/* ❌ REMOVE BrowserRouter FROM HERE */}
      <Routes>
        <Route path="/" element={<MarketplaceHome />} />
        <Route path="/events" element={<EventDiscovery />} />
        <Route path="/events/:eventSlug" element={<EventListing />} />
        <Route path="/charities/:slug" element={<PublicCharityProfile />} />
        <Route path="/charities" element={<CharityDiscovery />} />
        <Route path="/causes" element={<Navigate to={{ pathname: "/charities", search: window.location.search }} replace />} />
        <Route path="/fundraising" element={<CommunityOpportunities />} />
        <Route path="/fundraising/demo/:capability" element={<FundraisingSamples />} />
        <Route path="/organiser/fundraising" element={<FundraisingSuite />} />
        <Route path="/fundraising/auctions/:slug" element={<AuctionPage />} />
        <Route path="/fundraising/checkout-return" element={<FundraisingCheckoutReturn />} />
        <Route path="/fundraising/auction-return" element={<FundraisingCheckoutReturn />} />
        <Route path="/fundraising/store-return" element={<FundraisingCheckoutReturn />} />
        <Route path="/fundraising/membership-return" element={<FundraisingCheckoutReturn />} />
        <Route path="/stores/:organisationSlug" element={<StorePage />} />
        <Route path="/memberships/:organisationSlug" element={<MembershipPage />} />
        <Route path="/memberships/manage" element={<MembershipManagePage />} />
        <Route path="/pricing" element={<Pricing />} />
        <Route path="/fundraising/campaigns/:slug" element={<CampaignPage />} />
        <Route path="/fundraisers/:slug" element={<FundraiserPage />} />
        <Route path="/charities/join" element={<CharityJoin />} />
        <Route path="/supporter/access" element={<SupporterPortal />} />
        <Route path="/host" element={<HostLanding />} />
        <Route path="/organiser" element={<OrganiserConsole />} />
        <Route path="/about" element={<About />} />
        <Route path="/executive" element={<Executive />} />
        <Route path="/activities" element={<Activities />} />
        <Route path="/community/events" element={<Events />} />
        <Route path="/membership" element={<Membership />} />
        <Route path="/contact" element={<Contact />} />

        {/* ✅ ADMIN ROUTE */}
        <Route path="/Admin" element={<Admin />} />
        <Route path="/admin" element={<Admin />} />

        {/* ✅ SIMPLE MOBILE CHECK-IN — login + continuous camera scanning only */}
        <Route path="/checkin" element={<CheckInStaff />} />

        {/* ✅ LEGAL CENTRE ROUTES */}
        <Route path="/terms" element={<TermsOfUse />} />
        <Route path="/privacy" element={<PrivacyPolicyPage />} />
        <Route path="/organiser-terms" element={<OrganiserTermsPage />} />
        <Route path="/privacy-choices" element={<PrivacyChoices />} />
        <Route path="/privacy-policy" element={<PrivacyPolicy />} />
        <Route path="/event-terms" element={<EventTerms />} />
        <Route path="/checkout/return" element={<CheckoutReturn />} />
        <Route path="/pay/:token" element={<PayRegistration />} />

        <Route path="*" element={<NotFound />} />
      </Routes>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
