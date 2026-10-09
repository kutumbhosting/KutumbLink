import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { Building2, CalendarPlus, Plus, RefreshCw, Users, HeartHandshake, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Organisation = {
  id: number;
  legal_name: string;
  slug: string;
  role: string;
  verification_status?: string;
  public_name?: string;
  [key: string]: any;
};
type Member = { admin_user_id: number; name: string; email: string; role: string; is_active: boolean };
type OrgEvent = { id: number; title: string; date_text: string; location: string; is_active: boolean; published: boolean };
type Campaign = { id: number; slug: string; title: string; description: string; fundraising_url: string; internal_giving_enabled: boolean; status: string; goal_amount: number | null };

const roles = [
  ["owner", "Owner"], ["admin", "Admin"], ["event_manager", "Event Manager"],
  ["finance_manager", "Finance Manager"], ["volunteer_manager", "Volunteer Manager"],
  ["checkin_staff", "Check-in Staff"], ["read_only", "Read Only"],
];

async function request<T>(url: string, init: RequestInit = {}, organisationId?: number): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (organisationId) headers.set("x-organisation-id", String(organisationId));
  const response = await fetch(url, { ...init, headers });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.message || "Something went wrong. Please try again.");
  return payload as T;
}

const emptyProfile = {
  publicName: "", legalName: "", abn: "", charityStatus: "unverified", dgrStatus: "unknown", acncRegistrationNumber: "",
  causes: "", description: "", contactEmail: "", contactPhone: "", logoUrl: "", website: "", addressLine1: "", addressLine2: "",
  suburb: "", state: "", postcode: "", country: "Australia",
};

export default function OrganisationDashboard() {
  const [organisations, setOrganisations] = useState<Organisation[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [organisation, setOrganisation] = useState<Organisation | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [events, setEvents] = useState<OrgEvent[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [fundraiserReviews, setFundraiserReviews] = useState<any[]>([]);
  const [impactSummary, setImpactSummary] = useState<any | null>(null);
  const [settlement, setSettlement] = useState<any | null>(null);
  const [opsEventId, setOpsEventId] = useState<number | null>(null);
  const [opsVolunteers, setOpsVolunteers] = useState<any[]>([]);
  const [opsChecklist, setOpsChecklist] = useState<any[]>([]);
  const [newChecklistItem, setNewChecklistItem] = useState("");
  const [profile, setProfile] = useState(emptyProfile);
  const [onboarding, setOnboarding] = useState({ status: "draft", completedSteps: 0, totalSteps: 11, history: [] as any[], documents: [] as any[] });
  const [onboardingStep, setOnboardingStep] = useState(0);
  const [documentDraft, setDocumentDraft] = useState({ label: "", documentUrl: "" });
  const [supporters, setSupporters] = useState<any[]>([]);
  const [supporterSearch, setSupporterSearch] = useState("");
  const [selectedSupporter, setSelectedSupporter] = useState<any | null>(null);
  const [supporterTimeline, setSupporterTimeline] = useState<any[]>([]);
  const [mergeTargetId, setMergeTargetId] = useState("");
  const [newOrganisationName, setNewOrganisationName] = useState("");
  const [newMember, setNewMember] = useState({ name: "", email: "", password: "", role: "read_only" });
  const [passwordChange, setPasswordChange] = useState({ currentPassword: "", newPassword: "" });
  const [newEvent, setNewEvent] = useState({ title: "", date: "", time: "", location: "", capacity: "", description: "" });
  const [eventBrief, setEventBrief] = useState("");
  const [draftingEvent, setDraftingEvent] = useState(false);
  const [newCampaign, setNewCampaign] = useState({ title: "", description: "", story: "", imageUrl: "", goalAmount: "", fundraisingUrl: "", internalGivingEnabled: false, status: "draft" });
  const [newTeam, setNewTeam] = useState({ campaignId: "", name: "", goalAmount: "" });
  const [showNewOrganisation, setShowNewOrganisation] = useState(false);
  const [activeWorkspaceTab, setActiveWorkspaceTab] = useState<"workspace" | "volunteers">("workspace");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const isManager = organisation && ["owner", "admin", "platform_admin"].includes(organisation.role);
  const canManageEvents = organisation && ["owner", "admin", "platform_admin", "event_manager"].includes(organisation.role);
  const canManageVolunteerOps = Boolean(organisation && ["owner", "admin", "platform_admin", "event_manager", "volunteer_manager"].includes(organisation.role));
  const canViewMembers = organisation && ["owner", "admin", "platform_admin", "read_only"].includes(organisation.role);
  const canManageMembers = Boolean(isManager);
  const canEditProfile = Boolean(isManager);
  const canViewSupporters = Boolean(organisation && ["owner", "admin", "platform_admin", "event_manager", "finance_manager"].includes(organisation.role));

  const loadOrganisation = useCallback(async (id: number) => {
    setError("");
    const selected = await request<Organisation>(`/api/organisations/${id}`, {}, id);
    setOrganisation(selected);
    setNewCampaign((current) => ({ ...current, internalGivingEnabled: false }));
    setProfile({
      publicName: selected.public_name || "", legalName: selected.legal_name || "", abn: selected.abn || "", charityStatus: selected.charity_status || "unverified",
      dgrStatus: selected.dgr_status || "unknown", acncRegistrationNumber: selected.acnc_registration_number || "",
      causes: Array.isArray(selected.causes) ? selected.causes.join(", ") : "", description: selected.description || "", contactEmail: selected.contact_email || "",
      contactPhone: selected.contact_phone || "", logoUrl: selected.logo_url || "", website: selected.website || "", addressLine1: selected.address_line1 || "",
      addressLine2: selected.address_line2 || "", suburb: selected.suburb || "", state: selected.state || "",
      postcode: selected.postcode || "", country: selected.country || "Australia",
    });
    const onboardingResult = await request<typeof onboarding>(`/api/organisations/${id}/onboarding`, {}, id).catch(() => null);
    if (onboardingResult) setOnboarding(onboardingResult);
    const results = await Promise.allSettled([
      request<Member[]>(`/api/organisations/${id}/members`, {}, id),
      request<OrgEvent[]>(`/api/organisations/${id}/events`, {}, id),
      request<any[]>(`/api/organisations/${id}/supporters`, {}, id),
      request<Campaign[]>(`/api/organisations/${id}/campaigns`, {}, id),
      request<any>(`/api/organisations/${id}/impact-summary`, {}, id),
      request<any[]>(`/api/organisations/${id}/fundraiser-review`, {}, id),
      request<any>(`/api/organisations/${id}/settlement`, {}, id),
    ]);
    setMembers(results[0].status === "fulfilled" ? results[0].value : []);
    setEvents(results[1].status === "fulfilled" ? results[1].value : []);
    setSupporters(results[2].status === "fulfilled" ? results[2].value : []);
    setCampaigns(results[3].status === "fulfilled" ? results[3].value : []);
    setImpactSummary(results[4].status === "fulfilled" ? results[4].value : null);
    setFundraiserReviews(results[5].status === "fulfilled" ? results[5].value : []);
    setSettlement(results[6].status === "fulfilled" ? results[6].value : null);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const list = await request<Organisation[]>("/api/organisations/mine");
      setOrganisations(list);
      if (list.length === 0) {
        setOrganisation(null);
        setSelectedId(null);
        setShowNewOrganisation(true);
        return;
      }
      const savedId = Number(window.localStorage.getItem("kutumblink.organisationId"));
      const active = list.find((item) => item.id === savedId) || list[0];
      setSelectedId(active.id);
      window.localStorage.setItem("kutumblink.organisationId", String(active.id));
      await loadOrganisation(active.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load organisations");
    } finally {
      setLoading(false);
    }
  }, [loadOrganisation]);

  async function openOperations(event: OrgEvent) {
    if (!selectedId) return;
    const id = Number(event.id); setOpsEventId(id);
    const results = await Promise.allSettled([
      request<any[]>(`/api/organisations/${selectedId}/events/${id}/volunteers`, {}, selectedId),
      request<any[]>(`/api/organisations/${selectedId}/events/${id}/checklist`, {}, selectedId),
    ]);
    setOpsVolunteers(results[0].status === "fulfilled" ? results[0].value : []);
    setOpsChecklist(results[1].status === "fulfilled" ? results[1].value : []);
  }
  async function changeVolunteer(id: number, status: string) {
    if (!selectedId || !opsEventId) return;
    await request(`/api/organisations/${selectedId}/events/${opsEventId}/volunteers/${id}`, { method:"PATCH", body:JSON.stringify({status}) }, selectedId);
    await openOperations(events.find(e=>Number(e.id)===opsEventId)!);
  }
  async function toggleChecklist(item: any) {
    if (!selectedId || !opsEventId) return;
    await request(`/api/organisations/${selectedId}/events/${opsEventId}/checklist/${item.id}`, { method:"PATCH", body:JSON.stringify({isDone:!item.is_done}) }, selectedId);
    await openOperations(events.find(e=>Number(e.id)===opsEventId)!);
  }
  async function addChecklist(e: FormEvent) {
    e.preventDefault(); if(!selectedId||!opsEventId||!newChecklistItem.trim())return;
    await request(`/api/organisations/${selectedId}/events/${opsEventId}/checklist`,{method:"POST",body:JSON.stringify({label:newChecklistItem})},selectedId);
    setNewChecklistItem(""); await openOperations(events.find(e=>Number(e.id)===opsEventId)!);
  }
  async function draftEventWithAI() {
    if(!selectedId||eventBrief.trim().length<10)return;
    setDraftingEvent(true);setError("");setMessage("");
    try{const result=await request<{draft:any;message:string}>(`/api/organisations/${selectedId}/event-draft-assist`,{method:"POST",body:JSON.stringify({brief:eventBrief})},selectedId);setNewEvent(prev=>({...prev,title:result.draft.title||prev.title,date:result.draft.date||prev.date,time:result.draft.time||prev.time,location:result.draft.location||prev.location,description:result.draft.description||prev.description}));setMessage(result.message);}
    catch(err){setError(err instanceof Error?err.message:"Could not draft the event");}
    finally{setDraftingEvent(false);}
  }

  useEffect(() => { void load(); }, [load]);

  const chooseOrganisation = async (id: number) => {
    setSelectedId(id);
    window.localStorage.setItem("kutumblink.organisationId", String(id));
    setLoading(true);
    try { await loadOrganisation(id); }
    catch (err) { setError(err instanceof Error ? err.message : "Could not open this organisation"); }
    finally { setLoading(false); }
  };

  const createOrganisation = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true); setError(""); setMessage("");
    try {
      const created = await request<Organisation>("/api/organisations", { method: "POST", body: JSON.stringify({ legalName: newOrganisationName }) });
      setNewOrganisationName(""); setShowNewOrganisation(false);
      const list = await request<Organisation[]>("/api/organisations/mine");
      setOrganisations(list); setSelectedId(created.id);
      window.localStorage.setItem("kutumblink.organisationId", String(created.id));
      await loadOrganisation(created.id);
      setMessage("Your organisation is ready. Add its details and team when you’re ready.");
    } catch (err) { setError(err instanceof Error ? err.message : "Could not create the organisation"); }
    finally { setSaving(false); }
  };

  const saveProfile = async (event: FormEvent) => {
    event.preventDefault(); if (!selectedId) return;
    setSaving(true); setError(""); setMessage("");
    try {
      await request(`/api/organisations/${selectedId}`, { method: "PUT", body: JSON.stringify({ ...profile, causes: profile.causes.split(",").map((cause) => cause.trim()).filter(Boolean) }) }, selectedId);
      await loadOrganisation(selectedId);
      if (onboardingStep < 2) { setOnboardingStep((step) => step + 1); setMessage("Saved. Continue with the next step when ready."); }
      else setMessage("Organisation details saved.");
    } catch (err) { setError(err instanceof Error ? err.message : "Could not save details"); }
    finally { setSaving(false); }
  };

  const submitOnboarding = async () => {
    if (!selectedId) return;
    setSaving(true); setError(""); setMessage("");
    try {
      await request(`/api/organisations/${selectedId}/onboarding/submit`, { method: "POST", body: "{}" }, selectedId);
      await loadOrganisation(selectedId); setMessage("Your application is submitted for platform review.");
    } catch (err) { setError(err instanceof Error ? err.message : "Complete the required details before submitting"); }
    finally { setSaving(false); }
  };

  const addVerificationDocument = async (event: FormEvent) => {
    event.preventDefault(); if (!selectedId) return;
    try {
      await request(`/api/organisations/${selectedId}/onboarding/documents`, { method: "POST", body: JSON.stringify(documentDraft) }, selectedId);
      setDocumentDraft({ label: "", documentUrl: "" }); await loadOrganisation(selectedId); setMessage("Document link saved for platform review.");
    } catch (err) { setError(err instanceof Error ? err.message : "Could not save this document link"); }
  };

  const loadSupporter = async (supporter: any) => {
    if (!selectedId) return;
    try {
      const data = await request<{ supporter: any; timeline: any[] }>(`/api/organisations/${selectedId}/supporters/${supporter.id}`, {}, selectedId);
      setSelectedSupporter(data.supporter); setSupporterTimeline(data.timeline);
    } catch (err) { setError(err instanceof Error ? err.message : "Could not load supporter activity"); }
  };

  const mergeSupporters = async () => {
    if (!selectedId || !selectedSupporter || !mergeTargetId) return;
    if (!window.confirm("Merge these profiles? Their donation, ticket and attendance records will stay linked.")) return;
    try {
      await request(`/api/organisations/${selectedId}/supporters/${selectedSupporter.id}/merge`, { method: "POST", body: JSON.stringify({ targetSupporterId: Number(mergeTargetId) }) }, selectedId);
      setSelectedSupporter(null); setMergeTargetId(""); await loadOrganisation(selectedId); setMessage("Supporter profiles merged safely.");
    } catch (err) { setError(err instanceof Error ? err.message : "Could not merge supporter profiles"); }
  };

  const addMember = async (event: FormEvent) => {
    event.preventDefault(); if (!selectedId) return;
    setSaving(true); setError(""); setMessage("");
    try {
      await request(`/api/organisations/${selectedId}/members`, { method: "POST", body: JSON.stringify(newMember) }, selectedId);
      setNewMember({ name: "", email: "", password: "", role: "read_only" });
      await loadOrganisation(selectedId); setMessage("Team access updated.");
    } catch (err) { setError(err instanceof Error ? err.message : "Could not update team access"); }
    finally { setSaving(false); }
  };

  const removeMember = async (member: Member) => {
    if (!selectedId || !window.confirm(`Remove ${member.name}'s access to this organisation?`)) return;
    setError(""); setMessage("");
    try {
      await request(`/api/organisations/${selectedId}/members/${member.admin_user_id}`, { method: "DELETE" }, selectedId);
      await loadOrganisation(selectedId); setMessage("Organisation access removed.");
    } catch (err) { setError(err instanceof Error ? err.message : "Could not remove access"); }
  };

  const createEvent = async (event: FormEvent) => {
    event.preventDefault(); if (!selectedId) return;
    setSaving(true); setError(""); setMessage("");
    try {
      await request(`/api/organisations/${selectedId}/events`, {
        method: "POST", body: JSON.stringify({ ...newEvent, capacity: Number(newEvent.capacity) || 0, price: 0 }),
      }, selectedId);
      setNewEvent({ title: "", date: "", time: "", location: "", capacity: "", description: "" });
      await loadOrganisation(selectedId); setMessage("Event published. You can find it in Explore events.");
    } catch (err) { setError(err instanceof Error ? err.message : "Could not publish the event"); }
    finally { setSaving(false); }
  };

  const saveCampaign = async (event: FormEvent) => {
    event.preventDefault(); if (!selectedId) return;
    setSaving(true); setError(""); setMessage("");
    try {
      await request(`/api/organisations/${selectedId}/campaigns`, { method: "POST", body: JSON.stringify({ ...newCampaign, goalAmount: newCampaign.goalAmount || null }) }, selectedId);
      setNewCampaign({ title: "", description: "", story: "", imageUrl: "", goalAmount: "", fundraisingUrl: "", internalGivingEnabled: false, status: "draft" });
      await loadOrganisation(selectedId); setMessage("Campaign saved.");
    } catch (err) { setError(err instanceof Error ? err.message : "Could not save the campaign"); }
    finally { setSaving(false); }
  };

  const saveTeam = async (event: FormEvent) => {
    event.preventDefault(); if(!selectedId||!newTeam.campaignId)return;
    setSaving(true);setError("");setMessage("");
    try{await request(`/api/organisations/${selectedId}/campaigns/${newTeam.campaignId}/teams`,{method:"POST",body:JSON.stringify({name:newTeam.name,goalAmount:newTeam.goalAmount||null})},selectedId);setNewTeam({campaignId:"",name:"",goalAmount:""});setMessage("Team created. Supporters can select it when they start a fundraiser.");}
    catch(err){setError(err instanceof Error?err.message:"Could not create the team");}
    finally{setSaving(false);}
  };

  async function reviewFundraiser(pageId:number,status:"published"|"rejected") {
    if(!selectedId)return;
    try{await request(`/api/organisations/${selectedId}/fundraiser-review/${pageId}`,{method:"PATCH",body:JSON.stringify({status})},selectedId);setFundraiserReviews(current=>current.filter(p=>p.id!==pageId));setMessage(status==="published"?"Fundraiser approved and published.":"Fundraiser declined.");}
    catch(err){setError(err instanceof Error?err.message:"Could not update fundraiser review");}
  }

  const changePassword = async (event: FormEvent) => {
    event.preventDefault(); setSaving(true); setError(""); setMessage("");
    try {
      await request("/api/admin-auth/change-password", { method: "POST", body: JSON.stringify(passwordChange) });
      setPasswordChange({ currentPassword: "", newPassword: "" });
      setMessage("Your password has been updated.");
    } catch (err) { setError(err instanceof Error ? err.message : "Could not update password"); }
    finally { setSaving(false); }
  };

  const activeRoleName = useMemo(() => roles.find(([value]) => value === organisation?.role)?.[1] || (organisation?.role === "platform_admin" ? "Platform Admin" : organisation?.role), [organisation?.role]);
  const field = (label: string, key: keyof typeof profile, type = "text") => (
    <div className="space-y-2" key={key}><Label htmlFor={`org-${key}`}>{label}</Label><Input id={`org-${key}`} type={type} value={profile[key]} disabled={!canEditProfile} onChange={(e) => setProfile((current) => ({ ...current, [key]: e.target.value }))} /></div>
  );

  if (loading && !organisation) return <Card><CardContent className="p-8 text-muted-foreground">Loading your organisation workspace…</CardContent></Card>;

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-4 p-5">
          <div className="flex items-center gap-3"><span className="rounded-xl bg-primary/10 p-3 text-primary"><Building2 /></span><div><h2 className="text-xl font-semibold">Organisation workspace</h2><p className="text-sm text-muted-foreground">Manage your charity’s details, team and events.</p></div></div>
          <div className="flex flex-wrap items-center gap-2">
            {organisations.length > 1 && <select aria-label="Switch organisation" className="h-10 rounded-md border bg-background px-3" value={selectedId ?? ""} onChange={(e) => void chooseOrganisation(Number(e.target.value))}>{organisations.map((item) => <option key={item.id} value={item.id}>{item.legal_name}</option>)}</select>}
            {organisation && <span className="rounded-full bg-muted px-3 py-2 text-sm">{activeRoleName}</span>}
            <Button type="button" variant="outline" onClick={() => setShowNewOrganisation((show) => !show)}><Plus className="mr-2 h-4 w-4" />Add organisation</Button>
            <Button type="button" variant="ghost" size="icon" aria-label="Refresh organisation" onClick={() => void load()}><RefreshCw className="h-4 w-4" /></Button>
          </div>
        </CardContent>
      </Card>

      {(error || message) && <div role="status" className={`rounded-lg p-3 text-sm ${error ? "bg-destructive/10 text-destructive" : "bg-green-50 text-green-800"}`}>{error || message}</div>}

      {showNewOrganisation && <Card><CardHeader><CardTitle>Set up an organisation</CardTitle></CardHeader><CardContent><p className="mb-4 text-sm text-muted-foreground">Start with the organisation’s legal name. You can add verification and contact details later.</p><form onSubmit={createOrganisation} className="flex flex-wrap gap-3"><Input className="max-w-md" required minLength={2} maxLength={180} placeholder="Legal organisation name" value={newOrganisationName} onChange={(e) => setNewOrganisationName(e.target.value)} /><Button disabled={saving}>{saving ? "Creating…" : "Create organisation"}</Button></form></CardContent></Card>}

      {!organisation && !showNewOrganisation && <Card><CardContent className="p-8 text-center text-muted-foreground">No organisation workspace is available for this account.</CardContent></Card>}

      {organisation && <>
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Organisation workspace sections">
          <button type="button" role="tab" aria-selected={activeWorkspaceTab === "workspace"} className={`rounded-full px-4 py-2 text-sm font-medium ${activeWorkspaceTab === "workspace" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`} onClick={() => setActiveWorkspaceTab("workspace")}>Workspace</button>
          {canManageVolunteerOps && <button type="button" role="tab" aria-selected={activeWorkspaceTab === "volunteers"} className={`rounded-full px-4 py-2 text-sm font-medium ${activeWorkspaceTab === "volunteers" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`} onClick={() => setActiveWorkspaceTab("volunteers")}>Volunteers</button>}
        </div>
        {activeWorkspaceTab === "volunteers" && canManageVolunteerOps ? <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Users className="h-5 w-5" />Volunteer team</CardTitle><p className="text-sm text-muted-foreground">Review volunteer requests for your organisation�s events. Volunteer details are visible only to authorised charity team members.</p></CardHeader>
          <CardContent className="space-y-4">
            <div className="max-w-lg space-y-2"><Label htmlFor="volunteer-event">Choose an event</Label><select id="volunteer-event" className="h-10 w-full rounded-md border bg-background px-3" value={opsEventId ?? ""} onChange={(e) => { const event = events.find((item) => Number(item.id) === Number(e.target.value)); if (event) void openOperations(event); }}><option value="">Select an event</option>{events.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></div>
            {!events.length && <p className="rounded-lg bg-muted/40 p-4 text-sm text-muted-foreground">Publish an event first. Volunteer requests will appear here when people offer to help.</p>}
            {opsEventId && <div className="divide-y rounded-lg border">{opsVolunteers.map((volunteer: any) => <div key={volunteer.id} className="flex flex-wrap items-start justify-between gap-3 p-4"><div><strong>{volunteer.name}</strong><p className="text-sm text-muted-foreground">{volunteer.email}{volunteer.phone ? ` � ${volunteer.phone}` : ""}</p>{volunteer.availability && <p className="mt-1 text-sm">Availability: {volunteer.availability}</p>}{volunteer.accessibility_notes && <p className="mt-2 rounded bg-muted p-2 text-xs">Private access note: {volunteer.accessibility_notes}</p>}</div><select aria-label={`Volunteer status for ${volunteer.name}`} value={volunteer.status} onChange={(e) => void changeVolunteer(volunteer.id, e.target.value)} className="h-9 rounded border bg-background px-2 text-sm"><option value="pending">Pending</option><option value="approved">Approved</option><option value="declined">Declined</option></select></div>)}{opsVolunteers.length === 0 && <p className="p-4 text-sm text-muted-foreground">No volunteer requests for this event yet.</p>}</div>}
          </CardContent>
        </Card> : <>
        {settlement && <Card><CardHeader><CardTitle>Funds held for your charity</CardTitle><p className="text-sm text-muted-foreground">Payments are collected into Kutumb�s central account. This summary tracks your charity�s share and transfers recorded by Kutumb.</p></CardHeader><CardContent className="grid grid-cols-2 gap-4 sm:grid-cols-4">{[["Ticket and donation receipts",settlement.gross_receipts],["Refunds",settlement.refunds],["Transferred to your charity",settlement.transferred],["Available for transfer",settlement.outstanding]].map(([label,value])=><div key={String(label)} className="rounded-lg bg-muted/40 p-3"><p className="text-xs text-muted-foreground">{label}</p><strong className="mt-1 block text-lg">${Number(value||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})} AUD</strong></div>)}</CardContent></Card>}
        {impactSummary && <Card><CardHeader><CardTitle>Activity and impact</CardTitle><p className="text-sm text-muted-foreground">A quick summary from your KutumbLink records. Ticket sales and donations are kept separate.</p></CardHeader><CardContent className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">{[["Events",impactSummary.events],["Attendees",impactSummary.attendees],["Donations",`$${Number(impactSummary.donations?.raised||0).toLocaleString()} AUD`],["Donors",impactSummary.donations?.donors],["Volunteers",impactSummary.volunteers],["Sponsors",`$${Number(impactSummary.sponsorships||0).toLocaleString()} AUD`]].map(([label,value])=><div key={String(label)} className="rounded-lg bg-muted/40 p-3"><p className="text-xs text-muted-foreground">{label}</p><strong className="mt-1 block text-lg">{value ?? 0}</strong></div>)}</CardContent></Card>}
        <Card><CardHeader><CardTitle>Account security</CardTitle></CardHeader><CardContent><form onSubmit={changePassword} className="grid gap-3 md:grid-cols-[1fr_1fr_auto] md:items-end"><div className="space-y-2"><Label htmlFor="current-password">Current password</Label><Input id="current-password" type="password" autoComplete="current-password" required value={passwordChange.currentPassword} onChange={(e) => setPasswordChange({ ...passwordChange, currentPassword: e.target.value })} /></div><div className="space-y-2"><Label htmlFor="new-password">New password</Label><Input id="new-password" type="password" autoComplete="new-password" minLength={10} required value={passwordChange.newPassword} onChange={(e) => setPasswordChange({ ...passwordChange, newPassword: e.target.value })} /></div><Button disabled={saving}>{saving ? "Updating…" : "Update password"}</Button></form></CardContent></Card>
        {canEditProfile && <Card><CardHeader><CardTitle>Charity onboarding</CardTitle><p className="text-sm text-muted-foreground">A few short steps create your public profile and prepare your application for review.</p></CardHeader><CardContent className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-muted/40 p-4"><div><strong>Progress: {onboarding.completedSteps} of {onboarding.totalSteps} details</strong><p className="text-sm text-muted-foreground">Platform review: {String(onboarding.status).replace(/_/g, " ")}</p></div><div className="h-2 w-40 overflow-hidden rounded-full bg-muted"><div className="h-full bg-primary" style={{ width: `${Math.min(100, (onboarding.completedSteps / Math.max(1, onboarding.totalSteps)) * 100)}%` }} /></div></div>
          <p className="rounded-md border p-3 text-sm">Platform review is separate from government status. ACNC registration and DGR endorsement are self-reported here; platform approval does not change either government status.</p>
          <div className="flex gap-2" role="tablist" aria-label="Onboarding steps">{["Organisation", "Contact and status", "Public profile"].map((title, index) => <button key={title} type="button" role="tab" aria-selected={onboardingStep === index} className={`rounded-full px-3 py-2 text-sm ${onboardingStep === index ? "bg-primary text-primary-foreground" : "bg-muted"}`} onClick={() => setOnboardingStep(index)}>{index + 1}. {title}</button>)}</div>
          <form onSubmit={saveProfile} className="space-y-5">
            {onboardingStep === 0 && <div className="grid gap-4 md:grid-cols-2">{field("Organisation name shown publicly", "publicName")} {field("Legal name", "legalName")} {field("ABN (11 digits)", "abn")} {field("Cause areas (separate with commas)", "causes")}</div>}
            {onboardingStep === 1 && <div className="space-y-4"><div className="grid gap-4 md:grid-cols-2">{field("Contact email", "contactEmail", "email")} {field("Contact phone", "contactPhone", "tel")} {field("Website", "website", "url")} {field("ACNC registration number", "acncRegistrationNumber")}</div><div className="grid gap-4 md:grid-cols-2"><div className="space-y-2"><Label htmlFor="charity-status">ACNC / charity status</Label><select id="charity-status" value={profile.charityStatus} onChange={(e) => setProfile({ ...profile, charityStatus: e.target.value })} className="h-10 w-full rounded-md border bg-background px-3"><option value="unverified">Not verified</option><option value="registered">Registered charity</option><option value="not_registered">Not registered</option><option value="pending">Verification pending</option></select></div><div className="space-y-2"><Label htmlFor="dgr-status">DGR status</Label><select id="dgr-status" value={profile.dgrStatus} onChange={(e) => setProfile({ ...profile, dgrStatus: e.target.value })} className="h-10 w-full rounded-md border bg-background px-3"><option value="unknown">Not specified</option><option value="endorsed">DGR endorsed</option><option value="not_endorsed">Not DGR endorsed</option><option value="pending">Verification pending</option></select></div></div></div>}
            {onboardingStep === 2 && <div className="space-y-4"><div className="grid gap-4 md:grid-cols-2">{field("Address", "addressLine1")} {field("Address line 2", "addressLine2")} {field("Suburb", "suburb")} {field("State or territory", "state")} {field("Postcode", "postcode")} {field("Logo image URL", "logoUrl", "url")}</div><div className="space-y-2"><Label htmlFor="org-description">Your mission and what you do</Label><textarea id="org-description" maxLength={4000} rows={5} value={profile.description} onChange={(e) => setProfile({ ...profile, description: e.target.value })} className="w-full rounded-md border bg-background p-3" placeholder="Tell people what your organisation does and who it supports." /></div></div>}
            <div className="flex flex-wrap gap-2"><Button disabled={saving}>{saving ? "Saving…" : onboardingStep < 2 ? "Save and continue" : "Save details"}</Button>{onboardingStep > 0 && <Button type="button" variant="outline" onClick={() => setOnboardingStep((step) => step - 1)}>Back</Button>}{onboardingStep === 2 && <Button type="button" variant="outline" disabled={saving || !["draft", "needs_information", "rejected"].includes(onboarding.status)} onClick={() => void submitOnboarding()}>{saving ? "Submitting…" : "Submit for review"}</Button>}</div>
          </form>
          {onboarding.status === "approved" && <p className="text-sm text-green-700">Your public profile is live: <a className="underline" href={`/charities/${organisation.slug}`} target="_blank" rel="noreferrer">View charity profile</a></p>}
          <div className="grid gap-5 border-t pt-5 md:grid-cols-2"><form onSubmit={addVerificationDocument} className="space-y-3"><h3 className="font-medium">Supporting documents</h3><p className="text-xs text-muted-foreground">Add a secure private link for platform reviewers. Don’t use a public link to sensitive identity documents.</p><Input required placeholder="Document label" value={documentDraft.label} onChange={(e) => setDocumentDraft({ ...documentDraft, label: e.target.value })} /><Input required type="url" placeholder="https:// secure document link" value={documentDraft.documentUrl} onChange={(e) => setDocumentDraft({ ...documentDraft, documentUrl: e.target.value })} /><Button type="submit" variant="outline">Add document link</Button></form><div><h3 className="mb-2 font-medium">Review history</h3>{onboarding.history.slice(0,5).map((item:any) => <div key={item.id} className="border-l-2 py-1 pl-3 text-sm"><strong>{String(item.to_status).replace(/_/g, " ")}</strong><p className="text-muted-foreground">{item.note} · {new Date(item.created_at).toLocaleDateString()}</p></div>)}{onboarding.documents.map((item:any) => <a key={item.id} className="mt-2 block text-sm underline" href={item.document_url} target="_blank" rel="noreferrer">{item.label}</a>)}</div></div>
        </CardContent></Card>}

        <div className="grid gap-6 xl:grid-cols-2">
          {canViewMembers && <Card><CardHeader><CardTitle className="flex items-center gap-2"><Users className="h-5 w-5" />Team access</CardTitle></CardHeader><CardContent className="space-y-5">
            <div className="divide-y">{members.map((member) => <div key={member.admin_user_id} className="flex flex-wrap items-center justify-between gap-3 py-3"><div><strong>{member.name}</strong><p className="text-sm text-muted-foreground">{member.email} · {roles.find(([role]) => role === member.role)?.[1] || member.role}</p></div>{canManageMembers && member.role !== "owner" && <Button variant="ghost" size="sm" onClick={() => void removeMember(member)}>Remove access</Button>}</div>)}{members.length === 0 && <p className="py-4 text-sm text-muted-foreground">No team members have been added yet.</p>}</div>
            {canManageMembers && <form onSubmit={addMember} className="space-y-3 rounded-lg bg-muted/40 p-4"><h3 className="font-medium">Add a team member</h3><div className="grid gap-3 sm:grid-cols-2"><Input required placeholder="Full name" value={newMember.name} onChange={(e) => setNewMember({ ...newMember, name: e.target.value })} /><Input required type="email" placeholder="Email address" value={newMember.email} onChange={(e) => setNewMember({ ...newMember, email: e.target.value })} /><Input required type="password" minLength={10} placeholder="Initial password (10+ characters)" value={newMember.password} onChange={(e) => setNewMember({ ...newMember, password: e.target.value })} /><select aria-label="Team role" value={newMember.role} onChange={(e) => setNewMember({ ...newMember, role: e.target.value })} className="h-10 rounded-md border bg-background px-3">{roles.filter(([role]) => role !== "owner" || ["owner", "platform_admin"].includes(organisation.role)).map(([role, label]) => <option key={role} value={role}>{label}</option>)}</select></div><p className="text-xs text-muted-foreground">This creates a separate login limited to this organisation. Share the initial password through a secure channel.</p><Button disabled={saving}>{saving ? "Saving…" : "Add team member"}</Button></form>}
          </CardContent></Card>}

          <Card><CardHeader><CardTitle className="flex items-center gap-2"><CalendarPlus className="h-5 w-5" />Events</CardTitle></CardHeader><CardContent className="space-y-5">
            {canManageEvents && <form onSubmit={createEvent} className="space-y-3 rounded-lg bg-muted/40 p-4"><h3 className="font-medium">Publish an event</h3><details className="rounded border bg-background p-3"><summary className="cursor-pointer text-sm font-medium">Help me draft an event (optional)</summary><p className="mt-2 text-xs text-muted-foreground">Describe your idea. KutumbLink suggests wording and details for you to review; it never publishes automatically.</p><textarea rows={2} maxLength={3000} className="mt-2 w-full rounded border bg-background p-3" placeholder="e.g. A community walk in Parramatta to raise funds for youth mental health" value={eventBrief} onChange={e=>setEventBrief(e.target.value)}/><Button type="button" variant="outline" className="mt-2" disabled={draftingEvent||eventBrief.trim().length<10} onClick={()=>void draftEventWithAI()}>{draftingEvent?"Preparing draft…":"Suggest event details"}</Button></details><div className="grid gap-3 sm:grid-cols-2"><Input required placeholder="Event name" value={newEvent.title} onChange={(e) => setNewEvent({ ...newEvent, title: e.target.value })} /><Input required type="date" value={newEvent.date} onChange={(e) => setNewEvent({ ...newEvent, date: e.target.value })} /><Input type="time" aria-label="Start time" value={newEvent.time} onChange={(e) => setNewEvent({ ...newEvent, time: e.target.value })} /><Input placeholder="Venue or online" value={newEvent.location} onChange={(e) => setNewEvent({ ...newEvent, location: e.target.value })} /><Input type="number" min="0" placeholder="Capacity (0 means unlimited)" value={newEvent.capacity} onChange={(e) => setNewEvent({ ...newEvent, capacity: e.target.value })} /><Input className="sm:col-span-2" placeholder="Short event description" value={newEvent.description} onChange={(e) => setNewEvent({ ...newEvent, description: e.target.value })} /></div><p className="text-xs text-muted-foreground">Ticket and donation payments use the central Kutumb account. Your finance summary shows receipts attributed to this charity; Kutumb records any manual transfer.</p><Button disabled={saving}><Plus className="mr-2 h-4 w-4" />{saving ? "Publishing…" : "Publish event"}</Button></form>}
            <div className="divide-y">{events.map((item) => <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 py-3"><div><strong>{item.title}</strong><p className="text-sm text-muted-foreground">{item.date_text || "Date to be announced"}{item.location ? ` · ${item.location}` : ""}</p></div><div className="flex items-center gap-2"><span className="rounded-full bg-muted px-2.5 py-1 text-xs">{item.published ? "Published" : "Draft"}</span>{(canManageEvents || organisation?.role === "volunteer_manager") && <Button type="button" size="sm" variant="outline" onClick={()=>void openOperations(item)}>Event day</Button>}</div></div>)}{events.length === 0 && <p className="py-3 text-sm text-muted-foreground">No events yet. Publish one here to make it available in Explore events.</p>}</div>
            {opsEventId && <div className="mt-5 grid gap-5 border-t pt-5 lg:grid-cols-2"><section><h3 className="font-semibold">Event checklist</h3><div className="my-3 space-y-2">{opsChecklist.map((item:any)=><label key={item.id} className="flex items-start gap-2 rounded border p-3 text-sm"><input type="checkbox" checked={item.is_done} onChange={()=>void toggleChecklist(item)} className="mt-1"/><span className={item.is_done?"line-through text-muted-foreground":""}>{item.label}</span></label>)}{opsChecklist.length===0&&<p className="text-sm text-muted-foreground">Add a few practical reminders for your team.</p>}</div><form onSubmit={addChecklist} className="flex gap-2"><Input aria-label="New checklist item" placeholder="e.g. Confirm venue access" value={newChecklistItem} onChange={e=>setNewChecklistItem(e.target.value)}/><Button disabled={!newChecklistItem.trim()}>Add</Button></form></section></div>}
          </CardContent></Card>
        </div>
        <Card><CardHeader><CardTitle>Campaigns</CardTitle><p className="text-sm text-muted-foreground">Create a simple campaign page. Supporters can donate here or use your external fundraising link.</p></CardHeader><CardContent className="grid gap-5 lg:grid-cols-2"><div className="divide-y">{campaigns.map((campaign) => <div key={campaign.id} className="py-3"><div className="flex items-start justify-between gap-3"><div><strong>{campaign.title}</strong><p className="text-sm text-muted-foreground">{campaign.description}</p>{campaign.goal_amount != null && <p className="text-xs text-muted-foreground">Goal: ${Number(campaign.goal_amount).toLocaleString()} AUD</p>}</div><span className="rounded-full bg-muted px-2 py-1 text-xs">{campaign.status}</span></div>{campaign.status === "published" && <a className="mt-1 block text-xs underline" href={`/fundraising/campaigns/${campaign.slug}`} target="_blank" rel="noreferrer">View KutumbLink campaign</a>}{campaign.fundraising_url && <a className="mt-1 block break-all text-xs underline" href={campaign.fundraising_url} target="_blank" rel="noreferrer">External fundraising page</a>}</div>)}{campaigns.length === 0 && <p className="py-4 text-sm text-muted-foreground">No campaigns yet.</p>}</div>{canEditProfile && <form onSubmit={saveCampaign} className="space-y-3 rounded-lg bg-muted/40 p-4"><h3 className="font-medium">Add a campaign</h3><Input required minLength={3} placeholder="Campaign name" value={newCampaign.title} onChange={(e) => setNewCampaign({ ...newCampaign, title: e.target.value })} /><textarea rows={2} maxLength={3000} placeholder="Short summary" value={newCampaign.description} onChange={(e) => setNewCampaign({ ...newCampaign, description: e.target.value })} className="w-full rounded-md border bg-background p-3" /><textarea rows={4} maxLength={8000} placeholder="Campaign story (optional)" value={newCampaign.story} onChange={(e) => setNewCampaign({ ...newCampaign, story: e.target.value })} className="w-full rounded-md border bg-background p-3" /><Input type="url" placeholder="Campaign image URL (https://…)" value={newCampaign.imageUrl} onChange={(e) => setNewCampaign({ ...newCampaign, imageUrl: e.target.value })} /><Input type="number" min="0" step="0.01" placeholder="Optional fundraising goal (AUD)" value={newCampaign.goalAmount} onChange={(e) => setNewCampaign({ ...newCampaign, goalAmount: e.target.value })} /><Input type="url" placeholder="Secure external fundraising link (optional)" value={newCampaign.fundraisingUrl} onChange={(e) => setNewCampaign({ ...newCampaign, fundraisingUrl: e.target.value })} /><label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={newCampaign.internalGivingEnabled} onChange={(e) => setNewCampaign({ ...newCampaign, internalGivingEnabled: e.target.checked })} /><span>Accept donations through KutumbLink <span className="block text-xs text-muted-foreground">Donations use Kutumb's central payment account and are attributed to your charity for manual settlement. You can also link an external giving page.</span></span></label><select className="h-10 w-full rounded-md border bg-background px-3" value={newCampaign.status} onChange={(e) => setNewCampaign({ ...newCampaign, status: e.target.value })}><option value="draft">Save as draft</option><option value="published">Publish campaign</option></select><Button disabled={saving}>{saving ? "Saving…" : "Save campaign"}</Button></form>}</CardContent></Card>
        {canManageEvents && <Card><CardHeader><CardTitle>Fundraising teams</CardTitle><p className="text-sm text-muted-foreground">Create a team under a published campaign. Fundraisers can join the team from its campaign page.</p></CardHeader><CardContent><form onSubmit={saveTeam} className="grid gap-3 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end"><div className="space-y-2"><Label htmlFor="fundraise-campaign">Campaign</Label><select id="fundraise-campaign" required className="h-10 w-full rounded-md border bg-background px-3" value={newTeam.campaignId} onChange={e=>setNewTeam({...newTeam,campaignId:e.target.value})}><option value="">Choose a published campaign</option>{campaigns.filter(c=>c.status==="published").map(c=><option key={c.id} value={c.id}>{c.title}</option>)}</select></div><Input required minLength={2} placeholder="Team name" value={newTeam.name} onChange={e=>setNewTeam({...newTeam,name:e.target.value})}/><Input type="number" min="0" step="1" placeholder="Optional goal (AUD)" value={newTeam.goalAmount} onChange={e=>setNewTeam({...newTeam,goalAmount:e.target.value})}/><Button disabled={saving||!campaigns.some(c=>c.id===Number(newTeam.campaignId)&&c.status==="published")}>{saving?"Creating…":"Create team"}</Button></form></CardContent></Card>}
        {canManageEvents && fundraiserReviews.length>0 && <Card><CardHeader><CardTitle>Fundraiser requests to review</CardTitle><p className="text-sm text-muted-foreground">A charity team member checks each request before the page becomes public.</p></CardHeader><CardContent className="space-y-3">{fundraiserReviews.map((page:any)=><div key={page.id} className="flex flex-wrap items-start justify-between gap-3 rounded border p-3"><div><strong>{page.title}</strong><p className="text-sm text-muted-foreground">{page.display_name} · {page.contact_email} · {page.campaign_title||"Campaign"}</p>{page.story&&<p className="mt-2 max-w-2xl whitespace-pre-wrap text-sm">{page.story}</p>}</div><div className="flex gap-2"><Button size="sm" onClick={()=>void reviewFundraiser(page.id,"published")}>Approve</Button><Button size="sm" variant="outline" onClick={()=>void reviewFundraiser(page.id,"rejected")}>Decline</Button></div></div>)}</CardContent></Card>}{canViewSupporters && <Card><CardHeader><CardTitle className="flex items-center gap-2"><HeartHandshake className="h-5 w-5" />Supporters</CardTitle><p className="text-sm text-muted-foreground">One organisation-scoped profile connects a person’s event, ticket, attendance and donation activity.</p></CardHeader><CardContent className="grid gap-6 lg:grid-cols-[minmax(260px,0.8fr)_1.2fr]">
          <section><div className="relative mb-3"><Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" /><Input className="pl-9" placeholder="Search name or email" value={supporterSearch} onChange={(e) => setSupporterSearch(e.target.value)} /></div><div className="max-h-[28rem] divide-y overflow-auto">{supporters.filter((person) => `${person.display_name} ${person.email}`.toLowerCase().includes(supporterSearch.toLowerCase())).map((person) => <button type="button" key={person.id} onClick={() => void loadSupporter(person)} className={`w-full py-3 text-left ${selectedSupporter?.id === person.id ? "bg-muted" : ""}`}><strong>{person.display_name}</strong><span className="block text-sm text-muted-foreground">{person.email} · {person.donation_count} donations · {person.ticket_count} tickets</span></button>)}{supporters.length === 0 && <p className="py-4 text-sm text-muted-foreground">Supporter profiles appear as people register, buy tickets, join or donate.</p>}</div></section>
          <section>{selectedSupporter ? <><div className="mb-4"><h3 className="text-lg font-semibold">{selectedSupporter.display_name}</h3><p className="text-sm text-muted-foreground">{selectedSupporter.email}{selectedSupporter.phone ? ` · ${selectedSupporter.phone}` : ""}</p></div><h4 className="mb-2 font-medium">Activity timeline</h4><div className="max-h-80 space-y-2 overflow-auto">{supporterTimeline.map((item, index) => <div key={`${item.type}-${item.id}-${index}`} className="rounded-md border p-3 text-sm"><strong>{String(item.type).replace(/_/g, " ")}</strong><span className="float-right text-muted-foreground">{new Date(item.created_at).toLocaleDateString()}</span><p>{item.event_name || item.event_id || item.activity_title || (item.type === "donation" ? `$${item.amount} · ${item.payment_status}` : item.membership_number || "Recorded activity")}</p>{item.checked_in_at && <p className="text-muted-foreground">Checked in {new Date(item.checked_in_at).toLocaleString()}</p>}</div>)}{supporterTimeline.length === 0 && <p className="text-sm text-muted-foreground">No activity to show yet.</p>}</div>{isManager && <div className="mt-5 rounded-md bg-muted/40 p-3"><Label htmlFor="merge-supporter">Merge duplicate into another profile</Label><div className="mt-2 flex flex-wrap gap-2"><select id="merge-supporter" className="h-10 min-w-48 flex-1 rounded-md border bg-background px-3" value={mergeTargetId} onChange={(e) => setMergeTargetId(e.target.value)}><option value="">Choose the profile to keep…</option>{supporters.filter((person) => person.id !== selectedSupporter.id).map((person) => <option key={person.id} value={person.id}>{person.display_name} · {person.email}</option>)}</select><Button type="button" variant="outline" disabled={!mergeTargetId} onClick={() => void mergeSupporters()}>Merge and keep records</Button></div><p className="mt-2 text-xs text-muted-foreground">The selected profile remains; financial and attendance history is reassigned and the merge is audited.</p></div>}</> : <div className="flex h-full min-h-48 items-center justify-center text-sm text-muted-foreground">Choose a supporter to see their summary and history.</div>}</section>
        </CardContent></Card>}
        </>}
      </>}
    </div>
  );
}
