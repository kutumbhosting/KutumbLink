import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, Building2, LockKeyhole } from "lucide-react";
import MarketplaceHeader from "@/components/MarketplaceHeader";
import MarketplaceFooter from "@/components/MarketplaceFooter";
import OrganisationDashboard from "./admin/OrganisationDashboard";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import CharitySignupForm from "@/components/CharitySignupForm";

type SessionUser = { name: string; email: string; role: string };

export default function OrganiserConsole() {
  const navigate = useNavigate();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [checking, setChecking] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"login" | "signup">("login");

  useEffect(() => {
    fetch("/api/admin-auth/me").then(async (response) => response.ok ? response.json() : null).then((session) => {
      if (!session) return;
      if (session.role === "organisation_user") setUser(session);
      else if (["admin", "superadmin", "platform_admin"].includes(session.role)) navigate("/admin", { replace: true });
    }).catch(() => {}).finally(() => setChecking(false));
  }, [navigate]);

  async function login(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const response = await fetch("/api/admin-auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.message || "We couldn’t sign you in. Check your email and password.");
      if (result.admin?.role !== "organisation_user") {
        navigate("/admin", { replace: true });
        return;
      }
      setUser(result.admin);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "We couldn’t sign you in. Please try again.");
    } finally { setBusy(false); }
  }

  async function logout() {
    await fetch("/api/admin-auth/logout", { method: "POST" }).catch(() => {});
    setUser(null); setPassword("");
  }

  return <div className="marketplace-app min-h-screen flex flex-col">
    <MarketplaceHeader />
    <main className="flex-1 bg-muted/20 px-4 py-10 sm:py-14">
      <div className="mx-auto max-w-6xl">
        <div className="mb-8 max-w-2xl"><span className="market-kicker">KUTUMBLINK FOR CHARITIES</span><h1 className="mt-3 text-3xl font-bold sm:text-4xl">Charity organiser console</h1><p className="mt-3 text-muted-foreground">Manage your charity, team, events, supporters and fundraising in one workspace.</p></div>
        {checking ? <Card><CardContent className="p-8 text-muted-foreground">Checking your sign-in…</CardContent></Card> : user ? <>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-4"><p className="text-sm text-muted-foreground">Signed in as <strong className="text-foreground">{user.name || user.email}</strong></p><Button variant="outline" onClick={() => void logout()}>Sign out</Button></div>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-4"><p className="text-sm text-muted-foreground">Run auctions, sell products, manage paid memberships and send consent-based supporter updates.</p><Button asChild><Link to="/organiser/fundraising">Open fundraising toolkit<ArrowRight className="ml-2 h-4 w-4" /></Link></Button></div>
          <OrganisationDashboard />
        </> : <div className={mode === "signup" ? "mx-auto max-w-2xl" : "mx-auto max-w-md"}>
          <Card className="shadow-sm">
            <CardHeader className="text-center pb-4">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Building2 className="h-6 w-6" />
              </div>
              <CardTitle className="text-2xl">{mode === "signup" ? "Create your charity account" : "Get started creating events"}</CardTitle>
              <p className="mt-2 text-sm text-muted-foreground">{mode === "signup" ? "Fill in all required fields (*) to create your secure organisation workspace." : "Log in to your existing account, or switch to Sign up to create a new one."}</p>
              <div role="tablist" className="mx-auto mt-4 grid w-full max-w-xs grid-cols-2 rounded-lg bg-muted p-1 text-sm font-medium"><button type="button" role="tab" aria-selected={mode === "login"} className={`rounded-md py-1.5 ${mode === "login" ? "bg-background shadow-sm" : "text-muted-foreground"}`} onClick={() => { setMode("login"); setError(""); }}>Log in</button><button type="button" role="tab" aria-selected={mode === "signup"} className={`rounded-md py-1.5 ${mode === "signup" ? "bg-background shadow-sm" : "text-muted-foreground"}`} onClick={() => { setMode("signup"); setError(""); }}>Sign up</button></div>
            </CardHeader>
            <CardContent className="space-y-4">
              {mode === "signup" ? <CharitySignupForm onSuccess={(r) => { setUser({ name: r.name, email: r.email, role: "organisation_user" }); setMode("login"); }} /> : <>
              <button type="button" className="flex h-11 w-full items-center justify-center gap-3 rounded-md border bg-background px-4 text-sm font-medium transition-colors hover:bg-muted" onClick={() => setError("Google sign-in will be available once Google authentication is connected to this charity account.")}>
                <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5"><path fill="#4285F4" d="M21.35 12.23c0-.72-.06-1.42-.18-2.09H12v3.96h5.24a4.48 4.48 0 0 1-1.94 2.94v2.45h3.14c1.84-1.69 2.91-4.18 2.91-7.26Z"/><path fill="#34A853" d="M12 21.68c2.63 0 4.84-.87 6.45-2.37l-3.14-2.45c-.87.58-1.98.93-3.31.93-2.54 0-4.69-1.72-5.46-4.03H3.3v2.53A9.74 9.74 0 0 0 12 21.68Z"/><path fill="#FBBC05" d="M6.54 13.76a5.86 5.86 0 0 1 0-3.52V7.71H3.3a9.75 9.75 0 0 0 0 8.58l3.24-2.53Z"/><path fill="#EA4335" d="M12 6.21c1.43 0 2.72.49 3.73 1.46l2.8-2.8C16.84 3.22 14.63 2.32 12 2.32a9.74 9.74 0 0 0-8.7 5.39l3.24 2.53C7.31 7.93 9.46 6.21 12 6.21Z"/></svg>
                Continue with Google
              </button>
              <button type="button" className="flex h-11 w-full items-center justify-center gap-3 rounded-md border bg-background px-4 text-sm font-medium transition-colors hover:bg-muted" onClick={() => setError("Apple sign-in will be available once Apple authentication is connected to this charity account.")}>
                <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 fill-current"><path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.63-2.2.45-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.39 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.52 4.09ZM12.03 7.25C11.88 5.02 13.69 3.18 15.77 3c.29 2.58-2.34 4.5-3.74 4.25Z"/></svg>
                Continue with Apple
              </button>
              <div className="flex items-center gap-3 py-1" aria-hidden="true"><div className="h-px flex-1 bg-border" /><span className="text-xs text-muted-foreground">or</span><div className="h-px flex-1 bg-border" /></div>
              <form className="space-y-4" onSubmit={login}>
                <div className="space-y-2"><label htmlFor="organiser-email" className="text-sm font-medium">Email Address <span className="text-destructive">*</span></label><Input id="organiser-email" type="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} /></div>
                <div className="space-y-2"><label htmlFor="organiser-password" className="text-sm font-medium">Password <span className="text-destructive">*</span></label><PasswordInput id="organiser-password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} /></div>
                {error && <p role="alert" className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
                <Button className="w-full" disabled={busy}>{busy ? "Signing in…" : "Continue"}<ArrowRight className="ml-2 h-4 w-4" /></Button>
              </form>
              </>}
              <div className="border-t pt-4 text-center"><p className="text-sm text-muted-foreground">{mode === "login" ? "New to KutumbLink?" : "Already have an account?"}</p><Button type="button" variant="outline" className="mt-2 w-full" onClick={() => { setMode(mode === "login" ? "signup" : "login"); setError(""); }}>{mode === "login" ? "Create a charity account" : "Log in instead"} <ArrowRight className="ml-2 h-4 w-4" /></Button><p className="mt-4 text-xs text-muted-foreground">Platform staff use a separate <Link className="underline" to="/admin">admin console</Link>.</p></div>
            </CardContent>
          </Card>
        </div>}
      </div>
    </main>
    <MarketplaceFooter />
  </div>;
}
