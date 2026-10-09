import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import MarketplaceHeader from "@/components/MarketplaceHeader";
import MarketplaceFooter from "@/components/MarketplaceFooter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";

// ─── Tab components (each lives in /pages/admin/) ───────────────────────────
import EventRegistration from "./admin/EventRegistration";
import Members from "./admin/Members";
import UpcomingEvents from "./admin/UpcomingEvents";
import DatabaseTables from "./admin/DatabaseTables";
import FileManagement from "./admin/FileManagement";
import PastEvents from "./admin/PastEvents";
import TicketingManager from "./admin/TicketingManager";
import CheckIn from "./admin/CheckIn";
import Coupons from "./admin/Coupons";
import PlatformConsole from "./admin/PlatformConsole";
import BankDashboard from "./admin/BankDashboard";
import VerificationConsole from "./admin/VerificationConsole";

// ─── Shared utilities ────────────────────────────────────────────────────────
import { safeFetch } from "./admin/safeFetch";

const Admin = () => {
  const { toast } = useToast();
  const navigate = useNavigate();

  // ─── Auth state ────────────────────────────────────────────────────────────
  // Real login against /api/admin-auth/login, which sets an httpOnly session
  // cookie the browser sends automatically on every same-origin request from
  // here on — that's what actually protects every admin API route now (see
  // requireAdmin in server/lib/auth.js), not this React state, which just
  // controls what's rendered. `checkingSession` avoids a flash of the login
  // form while we confirm an existing cookie session on page load.
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [adminName, setAdminName] = useState("");
  // "superadmin" gets the full console; any other role ("admin") is a
  // limited admin — see the tab filtering below and the requireSuperAdmin
  // guards on the server for Members, Database Tables, API Keys and Settings.
  const [adminRole, setAdminRole] = useState<string>("admin");
  const isSuperAdmin = ["superadmin", "platform_admin"].includes(adminRole);
  const [loginData, setLoginData] = useState({ email: "admin@kutumb.org.au", password: "" });
  const [loginError, setLoginError] = useState("");
  const [loggingIn, setLoggingIn] = useState(false);

  useEffect(() => {
    fetch("/api/admin-auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((admin) => {
        if (admin) {
          if (admin.role === "organisation_user") {
            navigate("/organiser", { replace: true });
            return;
          }
          setIsLoggedIn(true);
          setAdminName(admin.name);
          setAdminRole(admin.role || "admin");
        }
      })
      .finally(() => setCheckingSession(false));
  }, [navigate]);

  // ─── Shared data passed down to tab components ────────────────────────────
  // groupedEvents and memberData are fetched here (in Admin) so both
  // EventRegistration and Members always have fresh, consistent data.
  const [groupedEvents, setGroupedEvents] = useState<Record<string, any[]>>({});
  const [memberData, setMemberData] = useState<any[]>([]);

  // ─── fetchData ─────────────────────────────────────────────────────────────
  // Loads all event files individually (safe — one bad file won't crash load)
  // then groups registrations by eventName_eventYear for the dropdown.
  const fetchData = async (superAdmin: boolean) => {
    try {
      const events = await safeFetch("/api/all-registrations");

      let grouped: Record<string, any[]> = {};
      if (!Array.isArray(events)) {
        console.warn("[fetchData] /api/all-registrations did not return an array:", events);
      } else {
        console.log("[fetchData] total event rows loaded:", events.length);

        grouped = events.reduce((acc: Record<string, any[]>, item: any) => {
          if (!item?.eventName) return acc; // skip malformed rows
          const key = `${item.eventName}_${item.eventYear || "unknown"}`;
          if (!acc[key]) acc[key] = [];
          acc[key].push(item);
          return acc;
        }, {});
      }

      // groupedEvents above only ever contains events that already HAVE at
      // least one registration — it's built purely from registration rows,
      // so a brand-new event with zero sign-ups so far had no key at all,
      // and every dropdown built from groupedEvents (here, Coupons,
      // TicketingManager, CheckIn) simply couldn't offer it. Fill in the
      // gap: for every currently active/upcoming event that doesn't
      // already have a key, add one holding a single placeholder row —
      // just enough for those dropdowns (which all read eventName/eventYear
      // off `rows[0]`) to list it. It's marked __placeholder so screens
      // that total up real registrants (EventRegistration's selected-event
      // summary) can filter it back out rather than counting it as an
      // actual attendee.
      const upcoming = await safeFetch("/api/upcoming-events");
      if (Array.isArray(upcoming)) {
        for (const event of upcoming) {
          if (!event?.title) continue;
          const eventYear = event.eventYear || "unknown";
          const key = `${event.title}_${eventYear}`;
          if (!grouped[key]) {
            grouped[key] = [{ eventName: event.title, eventYear, adults: 0, children: 0, fee: 0, __placeholder: true }];
          }
        }
      } else {
        console.warn("[fetchData] /api/upcoming-events did not return an array:", upcoming);
      }

      console.log("[fetchData] grouped keys:", Object.keys(grouped));
      setGroupedEvents(grouped);

      // Members is Super Admin-only on the server now — a limited admin
      // can't see the Members tab at all, so don't even ask for the data.
      if (superAdmin) {
        const members = await safeFetch("/api/members");
        setMemberData(Array.isArray(members) ? members : []);
      } else {
        setMemberData([]);
      }
    } catch (err) {
      // safeFetch absorbs errors, but keep this as a safety net
      console.error("[fetchData] unexpected error:", err);
    }
  };

  // Refresh dashboard data whenever we become logged in - covers both a
  // fresh login and a restored session (page navigated to/from, or reloaded).
  useEffect(() => {
    if (isLoggedIn) fetchData(isSuperAdmin);
  }, [isLoggedIn, isSuperAdmin]);

  // ─── Login handler ─────────────────────────────────────────────────────────
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError("");
    setLoggingIn(true);
    try {
      const res = await fetch("/api/admin-auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: loginData.email, password: loginData.password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Login failed");
      if (data.admin.role === "organisation_user") {
        navigate("/organiser", { replace: true });
        return;
      }
      setIsLoggedIn(true);
      setAdminName(data.admin.name);
      setAdminRole(data.admin.role || "admin");
      toast({ title: "Login Successful", description: `Welcome, ${data.admin.name}` });
    } catch (err: any) {
      setLoginError(err.message || "Invalid email or password");
      toast({ title: "Invalid Credentials", description: err.message, variant: "destructive" });
    } finally {
      setLoggingIn(false);
    }
  };

  // ─── Logout handler ─────────────────────────────────────────────────────────
  const handleLogout = async () => {
    await fetch("/api/admin-auth/logout", { method: "POST" }).catch(() => {});
    setIsLoggedIn(false);
    setAdminRole("admin");
    setLoginData({ email: "admin@kutumb.org.au", password: "" });
    toast({ title: "Logged Out", description: "You have been logged out." });
  };

  // ─── RENDER ────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen flex flex-col">
      <MarketplaceHeader />

      <main className="flex-grow">

        {/* HERO */}
        <section className="gradient-warm text-white py-20">
          <div className="container mx-auto px-4 text-center">
            <h1 className="mb-6">KutumbLink Admin Console</h1>
            <p className="text-xl max-w-3xl mx-auto opacity-95">
              Platform administration, verification and operations
            </p>
          </div>
        </section>

        {/* LOGIN */}
        {!checkingSession && !isLoggedIn && (
          <section className="py-20">
            <div className="container mx-auto px-4 max-w-md">
              <Card className="border-2">
                <CardContent className="p-8">
                  <h2 className="mb-6 text-center">Platform team sign in</h2>
                  <form onSubmit={handleLogin} className="space-y-4">
                    <Input
                      type="email"
                      placeholder="Email"
                      value={loginData.email}
                      onChange={(e) => setLoginData({ ...loginData, email: e.target.value })}
                    />
                    <PasswordInput
                      placeholder="Password"
                      value={loginData.password}
                      onChange={(e) => setLoginData({ ...loginData, password: e.target.value })}
                    />
                    {loginError && <p className="text-sm text-destructive">{loginError}</p>}
                    <Button type="submit" disabled={loggingIn} className="w-full btn-hero">
                      {loggingIn ? "Logging in..." : "Login"}
                    </Button>
                  </form>
                </CardContent>
              </Card>
            </div>
          </section>
        )}

        {/* DASHBOARD */}
        {isLoggedIn && (
          <section className="py-20 bg-muted/30">
            <div className="container mx-auto px-4">
              <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-2 mb-4">
                <p className="text-muted-foreground">Logged in as <strong>{adminName}</strong></p>
                <Button
                  onClick={handleLogout}
                  className="bg-accent hover:bg-accent/90 text-accent-foreground"
                >
                  Logout
                </Button>
              </div>
              {/* Tab order: Members, Events Settings, Events Management, Data
                  Management, Key Settings & Access. A limited ("admin") user
                  only sees Events Settings, Events Management and Data
                  Management (File Management only, no Database Tables) — the
                  server enforces the same boundaries independently, so hiding
                  these tabs is a UX convenience, not the actual security
                  boundary. */}
              <Tabs
                defaultValue={isSuperAdmin ? "members" : "events-settings"}
                className="max-w-7xl mx-auto"
              >
                <TabsList className="flex flex-wrap h-auto w-full max-w-5xl mx-auto gap-3 mb-12">
                  {isSuperAdmin && <TabsTrigger value="members">Members</TabsTrigger>}
                  {isSuperAdmin && <TabsTrigger value="bank">Bank</TabsTrigger>}
                  <TabsTrigger value="events-settings">Events Settings</TabsTrigger>
                  <TabsTrigger value="events-management">Events Management</TabsTrigger>
                  <TabsTrigger value="data-management">Data Management</TabsTrigger>
                  {isSuperAdmin && <TabsTrigger value="console">Key Settings & Access</TabsTrigger>}
                  {isSuperAdmin && <TabsTrigger value="verification">Charity verification</TabsTrigger>}
                </TabsList>

                {/* ── Members (Super Admin only) ── */}
                {isSuperAdmin && (
                  <TabsContent value="members">
                    <Members
                      memberData={memberData}
                      onReload={() => fetchData(isSuperAdmin)}
                    />
                  </TabsContent>
                )}

                {/* ── Bank dashboard (Super Admin only) ── */}
                {isSuperAdmin && (
                  <TabsContent value="bank">
                    <BankDashboard />
                  </TabsContent>
                )}

                {/* ── Events Settings: Upcoming Events / Past Events ── */}
                <TabsContent value="events-settings">
                  <Tabs defaultValue="upcoming">
                    <TabsList className="flex flex-wrap h-auto gap-2 mb-8">
                      <TabsTrigger value="upcoming">Upcoming Events</TabsTrigger>
                      <TabsTrigger value="past">Past Events</TabsTrigger>
                    </TabsList>
                    <TabsContent value="upcoming">
                      <UpcomingEvents />
                    </TabsContent>
                    <TabsContent value="past">
                      <PastEvents />
                    </TabsContent>
                  </Tabs>
                </TabsContent>

                {/* ── Events Management: Event Registration, Ticketing &
                     Payments, Coupons, QR Check-in ── */}
                <TabsContent value="events-management">
                  <Tabs defaultValue="registration">
                    <TabsList className="flex flex-wrap h-auto gap-2 mb-8">
                      <TabsTrigger value="registration">Event Registration</TabsTrigger>
                      <TabsTrigger value="ticketing">Ticketing & Payments</TabsTrigger>
                      <TabsTrigger value="coupons">Coupons</TabsTrigger>
                      <TabsTrigger value="checkin">QR Check-in</TabsTrigger>
                    </TabsList>
                    <TabsContent value="registration">
                      <EventRegistration
                        groupedEvents={groupedEvents}
                        onReload={() => fetchData(isSuperAdmin)}
                      />
                    </TabsContent>
                    <TabsContent value="ticketing">
                      <TicketingManager groupedEvents={groupedEvents} />
                    </TabsContent>
                    <TabsContent value="coupons">
                      <Coupons groupedEvents={groupedEvents} />
                    </TabsContent>
                    <TabsContent value="checkin">
                      <CheckIn groupedEvents={groupedEvents} />
                    </TabsContent>
                  </Tabs>
                </TabsContent>

                {/* ── Data Management: Database Tables (Super Admin only) /
                     File Management ── */}
                <TabsContent value="data-management">
                  <Tabs defaultValue={isSuperAdmin ? "database-tables" : "files"}>
                    <TabsList className="flex flex-wrap h-auto gap-2 mb-8">
                      {isSuperAdmin && <TabsTrigger value="database-tables">Database Tables</TabsTrigger>}
                      <TabsTrigger value="files">File Management</TabsTrigger>
                    </TabsList>
                    {isSuperAdmin && (
                      <TabsContent value="database-tables">
                        <DatabaseTables />
                      </TabsContent>
                    )}
                    <TabsContent value="files">
                      <FileManagement />
                    </TabsContent>
                  </Tabs>
                </TabsContent>

                {/* ── Key Settings & Access (Super Admin only) ── */}
                {isSuperAdmin && (
                  <TabsContent value="console">
                    <PlatformConsole currentAdminEmail={adminName} />
                  </TabsContent>
                )}

                {isSuperAdmin && <TabsContent value="verification"><VerificationConsole /></TabsContent>}

              </Tabs>
            </div>
          </section>
        )}
      </main>

      <MarketplaceFooter />
    </div>
  );
};

export default Admin;
