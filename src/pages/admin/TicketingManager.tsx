import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";

async function api(path: string, options: RequestInit = {}) {
  const res = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers as any) },
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.message || "Request failed");
  return data;
}

// Ticketing is keyed by a plain event id (slug) — any upcoming event's
// title, lowercased and hyphenated, works as this key.
const slugify = (t: string) => t?.toLowerCase().trim().replace(/\s+/g, "-").replace(/[^\w-]+/g, "");

interface TicketingManagerProps {
  groupedEvents: Record<string, any[]>;
}

export default function TicketingManager({ groupedEvents }: TicketingManagerProps) {
  const { toast } = useToast();
  const [eventId, setEventId] = useState("");
  const [ticketTypes, setTicketTypes] = useState<any[]>([]);
  const [capacity, setCapacity] = useState<number | null>(null);
  const [allocated, setAllocated] = useState(0);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [orders, setOrders] = useState<any[]>([]);
  const [waitlist, setWaitlist] = useState<any[]>([]);
  const [form, setForm] = useState({ name: "", price: "0", totalSeats: "", salesStartAt: "", salesEndAt: "", earlyBirdPrice: "", earlyBirdEndAt: "", maxPerOrder: "10", isPrivate: false, pricingMode: "fixed", minimumPrice: "0", maximumPrice: "", groupMinQuantity: "", groupPrice: "" });
  const [codes, setCodes] = useState<any[]>([]);
  const [codeForm, setCodeForm] = useState({ code: "", type: "discount", discountType: "percent", discountValue: "10", maxRedemptions: "" });

  const eventOptions = Array.from(
    new Set(Object.values(groupedEvents).map((rows: any) => rows[0]?.eventName).filter(Boolean))
  );

  const load = async (id: string) => {
    if (!id) return;
    const slug = slugify(id);
    const [ttResult, ord, wl, codeRows] = await Promise.all([
      api(`/api/ticketing/admin/${slug}/ticket-types`).catch(() => ({ ticketTypes: [], capacity: null, allocated: 0, remaining: null })),
      api(`/api/ticketing/admin/${slug}/orders`).catch(() => []),
      api(`/api/ticketing/admin/${slug}/waitlist`).catch(() => []),
      api(`/api/ticketing/admin/${slug}/codes`).catch(() => []),
    ]);
    setTicketTypes(ttResult.ticketTypes || []);
    setCapacity(ttResult.capacity);
    setAllocated(ttResult.allocated || 0);
    setRemaining(ttResult.remaining);
    setOrders(ord);
    setWaitlist(wl);
    setCodes(codeRows);
  };

  useEffect(() => { if (eventId) load(eventId); }, [eventId]);

  const addTicketType = async () => {
    if (!eventId || !form.name.trim()) return;
    const totalSeats = form.totalSeats.trim() === "" ? 0 : Number(form.totalSeats);
    try {
      await api(`/api/ticketing/admin/${slugify(eventId)}/ticket-types`, {
        method: "POST",
        body: JSON.stringify({
          name: form.name,
          priceCents: Math.round(Number(form.price) * 100),
          quantityTotal: totalSeats,
          salesStartAt: form.salesStartAt || null,
          salesEndAt: form.salesEndAt || null,
          earlyBirdPriceCents: form.earlyBirdPrice === "" ? null : Math.round(Number(form.earlyBirdPrice) * 100),
          earlyBirdEndAt: form.earlyBirdEndAt || null,
          maxPerOrder: Number(form.maxPerOrder) || 10,
          isPrivate: form.isPrivate,
          pricingMode: form.pricingMode,
          minimumPriceCents: Math.round(Number(form.minimumPrice || 0) * 100),
          maximumPriceCents: form.maximumPrice === "" ? null : Math.round(Number(form.maximumPrice) * 100),
          groupMinQuantity: form.groupMinQuantity || null,
          groupPriceCents: form.groupPrice === "" ? null : Math.round(Number(form.groupPrice) * 100),
        }),
      });
      toast({ title: "Ticket type added" });
      setForm({ name: "", price: "0", totalSeats: "", salesStartAt: "", salesEndAt: "", earlyBirdPrice: "", earlyBirdEndAt: "", maxPerOrder: "10", isPrivate: false, pricingMode: "fixed", minimumPrice: "0", maximumPrice: "", groupMinQuantity: "", groupPrice: "" });
      load(eventId);
    } catch (err: any) {
      toast({ title: "Couldn't add ticket type", description: err.message, variant: "destructive" });
    }
  };

  const deleteTicketType = async (id: number) => {
    if (!confirm("Delete this ticket type?")) return;
    await api(`/api/ticketing/admin/ticket-types/${id}`, { method: "DELETE" });
    load(eventId);
  };

  const createCode = async () => {
    try {
      await api(`/api/ticketing/admin/${slugify(eventId)}/codes`, { method: "POST", body: JSON.stringify({ ...codeForm, discountValue: Number(codeForm.discountValue), maxRedemptions: codeForm.maxRedemptions || null }) });
      setCodeForm({ ...codeForm, code: "" });
      await load(eventId);
      toast({ title: "Code created" });
    } catch (err: any) { toast({ title: "Couldn't create code", description: err.message, variant: "destructive" }); }
  };

  const refundOrder = async (order: any) => {
    if (!confirm(`Refund the full $${(Number(order.total_cents) / 100).toFixed(2)} order for ${order.buyer_name}?`)) return;
    try { await api(`/api/ticketing/admin/orders/${order.id}/refund`, { method: "POST", body: JSON.stringify({ reason: "Refund requested by organiser" }) }); await load(eventId); toast({ title: "Order refunded" }); }
    catch (err: any) { toast({ title: "Refund could not be completed", description: err.message, variant: "destructive" }); }
  };

  return (
    <div className="space-y-6">
      <div className="max-w-md">
        <Label>Event</Label>
        <select
          className="w-full mt-1 p-2 border rounded text-foreground bg-background"
          value={eventId}
          onChange={(e) => setEventId(e.target.value)}
        >
          <option value="">-- Choose an event to sell tickets for --</option>
          {eventOptions.map((name) => <option key={name} value={name}>{name}</option>)}
        </select>
        <p className="text-xs text-muted-foreground mt-1">
          Or type any event name/id manually below if it's not in the dropdown yet.
        </p>
        <Input className="mt-2" placeholder="Event id / name" value={eventId} onChange={(e) => setEventId(e.target.value)} />
      </div>

      {eventId && (
        <>
          <div className="border rounded-lg p-4 space-y-3 max-w-lg">
            <div className="flex items-baseline justify-between">
              <h3 className="font-bold">Ticket types</h3>
              {capacity !== null && (
                <p className="text-sm text-muted-foreground">
                  {allocated} / {capacity} seats allocated
                  {remaining !== null && remaining > 0 && <span className="text-amber-600"> · {remaining} not yet assigned to a ticket type</span>}
                </p>
              )}
            </div>
            {capacity === null && (
              <p className="text-xs text-muted-foreground">
                This event isn't in Upcoming Events yet, so there's no capacity to check ticket totals against.
              </p>
            )}

            {ticketTypes.map((tt) => (
              <div key={tt.id} className="flex items-center justify-between border-b pb-2">
                <div>
                  <p className="font-medium">{tt.name}</p>
                  <p className="text-sm text-muted-foreground">
                    ${(tt.price_cents / 100).toFixed(2)} · {tt.quantity_sold} sold / {tt.quantity_total || "∞"} total seats
                  </p>
                </div>
                <Button size="sm" variant="destructive" onClick={() => deleteTicketType(tt.id)}>Delete</Button>
              </div>
            ))}
            {ticketTypes.length === 0 && <p className="text-sm text-muted-foreground">No ticket types yet.</p>}

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-2">
              <div>
                <Label className="text-xs">Name</Label>
                <Input placeholder="e.g. General" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div>
                <Label className="text-xs">Price ($)</Label>
                <Input type="number" min="0" step="0.01" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} />
              </div>
              <div>
                <Label className="text-xs">Total seats{remaining !== null ? ` (${remaining} left)` : ""}</Label>
                <Input
                  type="number" min="0" max={remaining ?? undefined}
                  placeholder={remaining !== null ? String(remaining) : "0 = unlimited"}
                  value={form.totalSeats}
                  onChange={(e) => setForm({ ...form, totalSeats: e.target.value })}
                />
              </div>
            </div>
            <details className="rounded border p-3"><summary className="cursor-pointer text-sm font-medium">More options: sales dates and early bird</summary><div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2"><div><Label className="text-xs">Sales open</Label><Input type="datetime-local" value={form.salesStartAt} onChange={(e) => setForm({ ...form, salesStartAt: e.target.value })} /></div><div><Label className="text-xs">Sales close</Label><Input type="datetime-local" value={form.salesEndAt} onChange={(e) => setForm({ ...form, salesEndAt: e.target.value })} /></div><div><Label className="text-xs">Early bird price ($)</Label><Input type="number" min="0" step="0.01" value={form.earlyBirdPrice} onChange={(e) => setForm({ ...form, earlyBirdPrice: e.target.value })} /></div><div><Label className="text-xs">Early bird ends</Label><Input type="datetime-local" value={form.earlyBirdEndAt} onChange={(e) => setForm({ ...form, earlyBirdEndAt: e.target.value })} /></div><div><Label className="text-xs">Maximum per booking</Label><Input type="number" min="1" max="99" value={form.maxPerOrder} onChange={(e) => setForm({ ...form, maxPerOrder: e.target.value })} /></div><label className="flex items-center gap-2 self-end text-sm"><input type="checkbox" checked={form.isPrivate} onChange={(e) => setForm({ ...form, isPrivate: e.target.checked })} />Require access code</label></div></details>
            <details className="rounded border p-3"><summary className="cursor-pointer text-sm font-medium">More options: flexible and group prices</summary><div className="mt-3 grid gap-3 sm:grid-cols-2"><div><Label className="text-xs">Price style</Label><select className="w-full rounded border bg-background p-2" value={form.pricingMode} onChange={(e) => setForm({ ...form, pricingMode: e.target.value })}><option value="fixed">Set price</option><option value="pay_what_you_feel">Pay what you feel</option></select></div>{form.pricingMode === "pay_what_you_feel" ? <><div><Label className="text-xs">Minimum amount ($)</Label><Input type="number" min="0" step="0.01" value={form.minimumPrice} onChange={(e) => setForm({ ...form, minimumPrice: e.target.value })} /></div><div><Label className="text-xs">Maximum amount ($, optional)</Label><Input type="number" min="0" step="0.01" value={form.maximumPrice} onChange={(e) => setForm({ ...form, maximumPrice: e.target.value })} /></div></> : <><div><Label className="text-xs">Group size from (optional)</Label><Input type="number" min="2" value={form.groupMinQuantity} onChange={(e) => setForm({ ...form, groupMinQuantity: e.target.value })} /></div><div><Label className="text-xs">Group price per ticket ($)</Label><Input type="number" min="0" step="0.01" value={form.groupPrice} onChange={(e) => setForm({ ...form, groupPrice: e.target.value })} /></div></>}</div></details>
            <Button onClick={addTicketType}>Add ticket type</Button>
          </div>

          <div className="border rounded-lg p-4 max-w-2xl">
            <h3 className="font-bold mb-3">Orders ({orders.length})</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-left border-b"><th className="py-1">Buyer</th><th>Status</th><th>Total</th><th>Action</th></tr></thead>
                <tbody>
                  {orders.map((o) => (
                    <tr key={o.id} className="border-b">
                      <td className="py-1">{o.buyer_name} ({o.buyer_email})</td>
                      <td>{o.status}</td>
                      <td>${(o.total_cents / 100).toFixed(2)}</td>
                      <td>{o.status === "paid" && <Button size="sm" variant="outline" onClick={() => refundOrder(o)}>Refund</Button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="border rounded-lg p-4 max-w-2xl space-y-3">
            <h3 className="font-bold">Discount and access codes</h3><p className="text-xs text-muted-foreground">Codes can be limited by date or total uses. Access codes are currently valid for private ticket types configured by the event team.</p>
            <div className="grid gap-2 sm:grid-cols-4"><Input placeholder="Code" value={codeForm.code} onChange={(e) => setCodeForm({ ...codeForm, code: e.target.value })} /><select className="rounded border bg-background p-2" value={codeForm.type} onChange={(e) => setCodeForm({ ...codeForm, type: e.target.value })}><option value="discount">Discount</option><option value="access">Access</option></select>{codeForm.type === "discount" && <><select className="rounded border bg-background p-2" value={codeForm.discountType} onChange={(e) => setCodeForm({ ...codeForm, discountType: e.target.value })}><option value="percent">Percent</option><option value="fixed">Amount ($)</option></select><Input type="number" min="0" step="0.01" aria-label="Discount value" value={codeForm.discountValue} onChange={(e) => setCodeForm({ ...codeForm, discountValue: e.target.value })} /></>}</div>
            <div className="flex flex-wrap items-end gap-2"><div><Label className="text-xs">Maximum uses (optional)</Label><Input type="number" min="1" value={codeForm.maxRedemptions} onChange={(e) => setCodeForm({ ...codeForm, maxRedemptions: e.target.value })} /></div><Button onClick={createCode} disabled={!codeForm.code.trim()}>Create code</Button></div>
            {codes.map((code) => <div key={code.id} className="flex items-center justify-between border-t pt-2 text-sm"><span><strong>{code.code}</strong> · {code.code_type === "access" ? "Access" : `${code.discount_value}${code.discount_type === "percent" ? "% off" : " AUD off"}`} · {code.redemption_count}{code.max_redemptions ? `/${code.max_redemptions}` : ""} uses</span><Button size="sm" variant="outline" disabled={!code.active} onClick={async () => { await api(`/api/ticketing/admin/codes/${code.id}`, { method: "DELETE" }); load(eventId); }}>Disable</Button></div>)}
          </div>

          <div className="border rounded-lg p-4 max-w-2xl">
            <h3 className="font-bold mb-3">Waitlist ({waitlist.length})</h3>
            {waitlist.map((w) => (
              <p key={w.id} className="text-sm border-b py-1">{w.name} ({w.email}) — {w.requested_qty} spot(s)</p>
            ))}
            {waitlist.length === 0 && <p className="text-sm text-muted-foreground">No one on the waitlist.</p>}
          </div>
        </>
      )}
    </div>
  );
}
