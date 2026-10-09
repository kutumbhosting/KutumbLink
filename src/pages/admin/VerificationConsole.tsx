import { useCallback, useEffect, useState } from "react";
import { BadgeCheck, ClipboardCheck, ExternalLink, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";

type Application = { id: number; legal_name: string; slug: string; abn: string; contact_email: string; state: string; verification_status: string; document_count: number };
const statusLabels: Record<string,string> = { submitted: "Submitted", under_review: "Under review", needs_information: "Needs information", verified: "Verified", approved: "Approved", rejected: "Rejected", suspended: "Suspended" };

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers || {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message || "Could not complete this action");
  return body as T;
}

export default function VerificationConsole() {
  const [queue, setQueue] = useState<Application[]>([]);
  const [selected, setSelected] = useState<any>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => {
    try { setQueue(await api<Application[]>("/api/organisations/verification/queue")); setError(""); }
    catch (err) { setError(err instanceof Error ? err.message : "Could not load the queue"); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const inspect = async (application: Application) => {
    try { setSelected(await api(`/api/organisations/verification/${application.id}/details`)); setNote(""); }
    catch (err) { setError(err instanceof Error ? err.message : "Could not load application"); }
  };
  const decide = async (status: string) => {
    if (!selected?.organisation?.id || note.trim().length < 3) { setError("Add a short note before saving a review decision."); return; }
    setBusy(true); setError(""); setMessage("");
    try {
      await api(`/api/organisations/verification/${selected.organisation.id}/decision`, { method: "POST", body: JSON.stringify({ status, note }) });
      setMessage(`Application updated: ${statusLabels[status]}.`); setSelected(null); await refresh();
    } catch (err) { setError(err instanceof Error ? err.message : "Could not save this decision"); }
    finally { setBusy(false); }
  };

  return <div className="space-y-4">
    <Card><CardHeader><CardTitle className="flex items-center justify-between gap-3"><span className="flex items-center gap-2"><ClipboardCheck className="h-5 w-5" />Charity verification</span><Button variant="outline" onClick={() => void refresh()}><RefreshCw className="mr-2 h-4 w-4" />Refresh</Button></CardTitle><p className="text-sm text-muted-foreground">Review charity-submitted details, evidence and history. Platform approval is separate from ACNC registration and DGR endorsement.</p></CardHeader><CardContent>
      {(error || message) && <p role="status" className={`mb-3 rounded-md p-3 text-sm ${error ? "bg-destructive/10 text-destructive" : "bg-green-50 text-green-800"}`}>{error || message}</p>}
      {queue.length === 0 ? <p className="py-6 text-sm text-muted-foreground">No charity applications need review.</p> : <div className="divide-y">{queue.map((application) => <div key={application.id} className="flex flex-wrap items-center justify-between gap-3 py-3"><div><strong>{application.legal_name}</strong><p className="text-sm text-muted-foreground">ABN {application.abn || "not supplied"} · {application.state || "Location not supplied"} · {statusLabels[application.verification_status] || application.verification_status}</p><p className="text-xs text-muted-foreground">{application.contact_email} · {application.document_count} document link(s)</p></div><Button variant="outline" onClick={() => void inspect(application)}>Review</Button></div>)}</div>}
    </CardContent></Card>
    {selected?.organisation && <Card><CardHeader><CardTitle>{selected.organisation.public_name || selected.organisation.legal_name}</CardTitle><p className="text-sm">Platform review: <strong>{statusLabels[selected.organisation.verification_status] || selected.organisation.verification_status}</strong> · ACNC / charity: {selected.organisation.charity_status} · DGR: {selected.organisation.dgr_status}</p></CardHeader><CardContent className="space-y-5">
      <div className="grid gap-3 rounded-md bg-muted/40 p-4 text-sm md:grid-cols-2"><span>Legal name: {selected.organisation.legal_name}</span><span>ABN: {selected.organisation.abn || "Not supplied"}</span><span>ACNC number: {selected.organisation.acnc_registration_number || "Not supplied"}</span><span>Contact: {selected.organisation.contact_email || "Not supplied"}</span><span>Website: {selected.organisation.website || "Not supplied"}</span><span>Causes: {(selected.organisation.causes || []).join(", ") || "Not supplied"}</span><p className="md:col-span-2">Mission: {selected.organisation.description || "Not supplied"}</p></div>
      <div><h3 className="mb-2 font-medium">Evidence</h3>{selected.documents.map((doc:any) => <a key={doc.id} href={doc.document_url} target="_blank" rel="noreferrer" className="mr-3 inline-flex items-center gap-1 text-sm underline">{doc.label}<ExternalLink className="h-3 w-3" /></a>)}{selected.documents.length === 0 && <p className="text-sm text-muted-foreground">No supporting links supplied.</p>}</div>
      <div><h3 className="mb-2 font-medium">History</h3>{selected.history.map((item:any) => <div key={item.id} className="border-l-2 py-1 pl-3 text-sm"><strong>{statusLabels[item.to_status] || item.to_status}</strong> · {item.actor_email || "System"}<p className="text-muted-foreground">{item.note} · {new Date(item.created_at).toLocaleString()}</p></div>)}</div>
      <div className="space-y-3"><label htmlFor="verification-note" className="text-sm font-medium">Review note</label><Textarea id="verification-note" rows={3} maxLength={2000} placeholder="Explain the decision or information needed. This is recorded in the audit history." value={note} onChange={(e) => setNote(e.target.value)} /><div className="flex flex-wrap gap-2"><Button disabled={busy} variant="outline" onClick={() => void decide("under_review")}>Mark under review</Button><Button disabled={busy} variant="outline" onClick={() => void decide("needs_information")}>Request information</Button><Button disabled={busy} variant="outline" onClick={() => void decide("verified")}><BadgeCheck className="mr-2 h-4 w-4" />Mark verified</Button><Button disabled={busy} onClick={() => void decide("approved")}>Approve and publish</Button><Button disabled={busy} variant="destructive" onClick={() => void decide("rejected")}>Reject</Button><Button disabled={busy} variant="destructive" onClick={() => void decide("suspended")}>Suspend</Button><Button type="button" variant="ghost" onClick={() => setSelected(null)}>Close</Button></div></div>
    </CardContent></Card>}
  </div>;
}
