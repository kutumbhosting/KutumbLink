import { Link, useLocation } from "react-router-dom";

const tabs = [
  { label: "Events", to: "/events", matches: (path: string) => path === "/events" || path.startsWith("/events/") },
  { label: "Charities & causes", to: "/charities", matches: (path: string) => path === "/charities" || path.startsWith("/charities/") || path === "/causes" },
  { label: "Fundraising", to: "/fundraising", matches: (path: string) => path === "/fundraising" || path.startsWith("/fundraising/") || path.startsWith("/fundraisers/") },
];

export default function ExploreTabs() {
  const { pathname } = useLocation();
  return (
    <nav className="border-b bg-white" aria-label="Explore KutumbLink">
      <div className="mx-auto flex max-w-[1240px] gap-2 overflow-x-auto px-4 sm:px-8" role="tablist">
        {tabs.map((tab) => {
          const active = tab.matches(pathname);
          return <Link key={tab.to} to={tab.to} role="tab" aria-selected={active} className={`shrink-0 border-b-2 px-4 py-3 text-sm font-semibold transition-colors ${active ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}>{tab.label}</Link>;
        })}
      </div>
    </nav>
  );
}
