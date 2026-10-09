import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { HeartHandshake, LogOut, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers || {}) } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.message || "Could not complete this request");
  return payload as T;
}

export default function SupporterPortal() {
  const [params, setParams] = useSearchParams();
  const [token] = useState(params.get("token") || "");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [organisationSlug, setOrganisationSlug] = useState(params.get("organisation") || "");
  const [profile, setProfile] = useState<any>(null);
  const [preferences, setPreferences] = useState({ emailOptOut: false, smsOptOut: false });
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const data = await call<any>("/api/supporter-portal/me");
    setProfile(data); setPreferences({ emailOptOut: data.supporter.emailOptOut, smsOptOut: data.supporter.smsOptOut });
  };
  useEffect(() => {
    if (!token) { void load().catch(() => {}); return; }
    let active = true;
    call(`/api/supporter-portal/exchange`, { method: "POST", body: JSON.stringify({ token }) })
      .then(() => { if (active) { setParams({}, { replace: true }); return load(); } })
      .catch((err) => { if (active) setError(err instanceof Error ? err.message : "This sign-in link is no longer valid."); });
    return () => { active = false; };
  // The one-time token is consumed once when the page loads.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const requestLink = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    try { const result = await call<{ message: string }>("/api/supporter-portal/request-link", { method: "POST", body: JSON.stringify({ email, name, organisationSlug }) }); setNotice(result.message); }
    catch (err) { setError(err instanceof Error ? err.message : "Could not request a sign-in link"); }
    finally { setBusy(false); }
  };
  const savePreferences = async () => {
    setBusy(true); setError(""); setNotice("");
    try { const result = await call<{ message: string }>("/api/supporter-portal/preferences", { method: "PUT", body: JSON.stringify(preferences) }); setNotice(result.message); }
    catch (err) { setError(err instanceof Error ? err.message : "Could not save preferences"); }
    finally { setBusy(false); }
  };
  const logout = async () => { await call("/api/supporter-portal/logout", { method: "POST" }).catch(() => {}); setProfile(null); };

  return <main className="min-h-screen bg-muted/20 px-4 py-10"><div className="mx-auto max-w-3xl space-y-5"><header className="flex items-center justify-between"><Link to="/" className="font-semibold">KutumbLink</Link><span className="flex items-center gap-2 text-sm text-muted-foreground"><HeartHandshake className="h-4 w-4" />Supporter activity</span></header>
    {(error || notice) && <p role="status" className={`rounded-md p-3 text-sm ${error ? "bg-destructive/10 text-destructive" : "bg-green-50 text-green-800"}`}>{error || notice}</p>}
    {!profile ? <Card><CardHeader><CardTitle className="flex items-center gap-2"><Mail className="h-5 w-5" />Open your supporter activity</CardTitle><p className="text-sm text-muted-foreground">We’ll email you a private sign-in link. Use the name and email you gave the organisation.</p></CardHeader><CardContent><form onSubmit={requestLink} className="space-y-4"><div className="space-y-2"><Label htmlFor="supporter-name">Your name</Label><Input id="supporter-name" required minLength={2} value={name} onChange={(e) => setName(e.target.value)} /></div><div className="space-y-2"><Label htmlFor="supporter-email">Email address</Label><Input id="supporter-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></div><div className="space-y-2"><Label htmlFor="supporter-org">Organisation profile name</Label><Input id="supporter-org" required placeholder="The link from your charity profile, e.g. kutumb" value={organisationSlug} onChange={(e) => setOrganisationSlug(e.target.value)} /></div><Button disabled={busy}>{busy ? "Sending…" : "Email me a sign-in link"}</Button></form></CardContent></Card> : <>
      <Card><CardHeader><div className="flex items-start justify-between gap-3"><div><CardTitle>Hello, {profile.supporter.name}</CardTitle><p className="mt-1 text-sm text-muted-foreground">Your activity with {profile.organisation}</p></div><Button variant="ghost" onClick={() => void logout()}><LogOut className="mr-2 h-4 w-4" />Sign out</Button></div></CardHeader><CardContent><h2 className="mb-3 font-semibold">Your activity</h2><div className="space-y-2">{profile.activity.map((item:any,index:number) => <div key={`${item.type}-${index}`} className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-background p-3 text-sm"><div><strong>{item.type}</strong><p className="text-muted-foreground">{item.event_name || item.activity_title || (item.amount != null ? `$${item.amount} · ${item.status}` : item.membership_number || "Activity recorded")}</p></div><time className="text-muted-foreground">{new Date(item.created_at).toLocaleDateString()}</time></div>)}{profile.activity.length === 0 && <p className="text-sm text-muted-foreground">There’s no activity to show yet.</p>}</div></CardContent></Card>
      <Card><CardHeader><CardTitle>Communication preferences</CardTitle><p className="text-sm text-muted-foreground">These settings apply to non-essential communication from this organisation.</p></CardHeader><CardContent className="space-y-4"><label className="flex items-center gap-3 text-sm"><input type="checkbox" checked={preferences.emailOptOut} onChange={(e) => setPreferences({ ...preferences, emailOptOut: e.target.checked })} />Don’t send me non-essential emails</label><label className="flex items-center gap-3 text-sm"><input type="checkbox" checked={preferences.smsOptOut} onChange={(e) => setPreferences({ ...preferences, smsOptOut: e.target.checked })} />Don’t send me non-essential text messages</label><p className="text-xs text-muted-foreground">You can change these choices at any time. Essential booking, payment and safety messages may still be sent.</p><Button disabled={busy} onClick={() => void savePreferences()}>Save preferences</Button></CardContent></Card>
    </>}
  </div></main>;
}
