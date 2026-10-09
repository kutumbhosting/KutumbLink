import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowUpRight, BadgeCheck, CalendarDays, HeartHandshake } from "lucide-react";
import { Button } from "@/components/ui/button";
import { setPageMetadata } from "@/lib/seo";
import { Card, CardContent } from "@/components/ui/card";
import DonateDialog from "@/components/DonateDialog";

type ProfileData = { organisation: any; events: any[]; campaigns: any[]; fundraisingTools?: { store: boolean; memberships: boolean }; actions: { donate: string | null; fundraise: string; volunteer: string | null } };

export default function PublicCharityProfile() {
  const { slug } = useParams();
  const [data, setData] = useState<ProfileData | null>(null);
  const [error, setError] = useState("");
  const [donating, setDonating] = useState(false);
  useEffect(() => {
    let active = true;
    fetch(`/api/organisations/public/${encodeURIComponent(slug || "")}`).then(async (response) => {
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.message || "This charity profile is unavailable.");
      return body as ProfileData;
    }).then((body) => { if (active) setData(body); }).catch((err) => { if (active) setError(err.message); });
    return () => { active = false; };
  }, [slug]);
  useEffect(() => { if (data) setPageMetadata((data.organisation.public_name || data.organisation.legal_name) + " | KutumbLink", data.organisation.description || "Learn about this approved charity on KutumbLink."); }, [data]);

  if (error) return <main className="mx-auto max-w-3xl px-5 py-20 text-center"><h1 className="text-3xl font-semibold">Charity profile unavailable</h1><p className="my-4 text-muted-foreground">{error}</p><Button asChild><Link to="/">Back to KutumbLink</Link></Button></main>;
  if (!data) return <main className="mx-auto max-w-3xl px-5 py-20 text-center text-muted-foreground">Loading charity profile…</main>;

  const org = data.organisation;
  const charityWebsite = org.website && /^https:\/\//i.test(org.website) ? org.website : null;
  const emailLink = org.contact_email ? `mailto:${org.contact_email}` : null;
  const actionTarget = data.campaigns[0]?.fundraising_url || charityWebsite;

  return <main className="min-h-screen bg-background">
    <header className="border-b"><div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4"><Link className="font-semibold" to="/">KutumbLink</Link><Link to="/events" className="text-sm text-muted-foreground hover:text-foreground">Explore events</Link></div></header>
    <section className="bg-muted/30"><div className="mx-auto max-w-6xl px-5 py-12 md:py-16"><div className="flex flex-col gap-6 md:flex-row md:items-center">{org.logo_url && <img src={org.logo_url} alt={`${org.public_name || org.legal_name} logo`} className="h-24 w-24 rounded-2xl border bg-white object-contain p-2" />}<div><div className="mb-3 inline-flex items-center gap-2 rounded-full bg-green-100 px-3 py-1 text-sm font-medium text-green-900"><BadgeCheck className="h-4 w-4" />KutumbLink approved charity</div><h1 className="text-3xl font-bold md:text-5xl">{org.public_name || org.legal_name}</h1><p className="mt-2 text-muted-foreground">{[org.suburb, org.state, org.postcode].filter(Boolean).join(", ")}</p><div className="mt-4 flex flex-wrap gap-2">{(org.causes || []).map((cause:string) => <span key={cause} className="rounded-full border bg-background px-3 py-1 text-sm">{cause}</span>)}</div>{(org.charity_status !== "unverified" || org.dgr_status !== "unknown") && <p className="mt-3 text-sm text-muted-foreground">Government status as provided by the charity: {org.charity_status !== "unverified" ? `Charity: ${String(org.charity_status).replace(/_/g, " ")}` : ""}{org.charity_status !== "unverified" && org.dgr_status !== "unknown" ? " · " : ""}{org.dgr_status !== "unknown" ? `DGR: ${String(org.dgr_status).replace(/_/g, " ")}` : ""}. KutumbLink platform approval does not confirm government registration.</p>}</div></div></div></section>
    <div className="mx-auto grid max-w-6xl gap-10 px-5 py-10 lg:grid-cols-[1.5fr_0.8fr]">
      <section className="space-y-8"><div><h2 className="mb-3 text-2xl font-semibold">Our mission</h2><p className="whitespace-pre-wrap leading-7 text-muted-foreground">{org.description || "Learn more about this organisation on its website."}</p></div>
        {data.campaigns.length > 0 && <div><h2 className="mb-4 text-2xl font-semibold">Current campaigns</h2><div className="grid gap-4 sm:grid-cols-2">{data.campaigns.map((campaign:any) => <Card key={campaign.id}><CardContent className="p-5"><h3 className="font-semibold">{campaign.title}</h3><p className="mt-2 text-sm text-muted-foreground">{campaign.description}</p>{campaign.goal_amount != null && <p className="mt-2 text-sm font-medium">Goal: ${Number(campaign.goal_amount).toLocaleString()} AUD</p>}<Button className="mt-4" asChild><Link to={`/fundraising/campaigns/${campaign.slug}`}>{campaign.internal_giving_enabled ? "Donate or fundraise" : "View campaign"}<ArrowUpRight className="ml-2 h-4 w-4" /></Link></Button>{campaign.fundraising_url&&<a className="mt-2 block text-sm underline" href={campaign.fundraising_url} target="_blank" rel="noreferrer">External giving page</a>}</CardContent></Card>)}</div></div>}
        <div>
          <h2 className="mb-4 flex items-center gap-2 text-2xl font-semibold"><CalendarDays className="h-5 w-5" />Upcoming events</h2>
          {data.events.length ? <div className="grid gap-4 sm:grid-cols-2">{data.events.map((event) => <Card key={event.id}><CardContent className="p-5"><h3 className="font-semibold">{event.title}</h3><p className="mt-1 text-sm text-muted-foreground">{event.date_text || "Date to be announced"}{event.time_text ? ` � ${event.time_text}` : ""}</p>{event.location && <p className="mt-1 text-sm text-muted-foreground">{event.location}</p>}{event.description && <p className="mt-3 text-sm">{event.description}</p>}<Button className="mt-4" variant="outline" asChild><Link to={`/events/${event.event_slug}`}>View event</Link></Button></CardContent></Card>)}</div> : <p className="text-muted-foreground">No upcoming events at the moment.</p>}
        </div>
      </section>
      <aside className="space-y-5"><Card><CardContent className="space-y-3 p-5"><h2 className="text-lg font-semibold">Get involved</h2>{data.campaigns.some((campaign:any)=>campaign.internal_giving_enabled) && <Button className="w-full" onClick={()=>setDonating(true)}>Donate to this charity</Button>}{data.campaigns[0] && <Button className="w-full" variant="outline" asChild><Link to={`/fundraising/campaigns/${data.campaigns[0].slug}`}>Fundraise for this charity<HeartHandshake className="ml-2 h-4 w-4" /></Link></Button>}{data.fundraisingTools?.memberships&&<Button className="w-full" variant="outline" asChild><Link to={`/memberships/${org.slug}`}>Become a member</Link></Button>}{data.fundraisingTools?.store&&<Button className="w-full" variant="outline" asChild><Link to={`/stores/${org.slug}`}>Shop the community store</Link></Button>}{!data.campaigns.some((campaign:any)=>campaign.internal_giving_enabled) && actionTarget && <Button className="w-full" asChild><a href={actionTarget} target="_blank" rel="noreferrer">Donate<ArrowUpRight className="ml-2 h-4 w-4" /></a></Button>}<p className="text-xs text-muted-foreground">Platform approval is a KutumbLink profile review and does not confirm ACNC registration or DGR endorsement.</p></CardContent></Card><Link className="block text-sm underline" to={`/supporter/access?organisation=${encodeURIComponent(org.slug)}`}>View your activity with this organisation</Link>{charityWebsite && <a className="block break-all text-sm underline" href={charityWebsite} target="_blank" rel="noreferrer">Visit organisation website</a>}{emailLink && <a className="block text-sm underline" href={emailLink}>Contact {org.public_name || org.legal_name}</a>}</aside>
    </div>
    <DonateDialog open={donating} onOpenChange={setDonating} organisationId={Number(org.id)} />
  </main>;
}
