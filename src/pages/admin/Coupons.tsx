import { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { safeFetch } from "./safeFetch";

interface CouponsProps {
  groupedEvents: Record<string, any[]>;
}

// Generates, lists, searches, edits, voids and deletes event-specific
// coupons. Coupons are single-use (see server/lib/coupons.js) — once
// redeemed against a registration they can never be applied again, but the
// record itself is kept (used or unused) unless an admin explicitly
// deletes it here.
const Coupons = ({ groupedEvents }: CouponsProps) => {
  const { toast } = useToast();

  const eventOptions = Object.entries(groupedEvents)
    .map(([key, rows]: any) => ({ key, eventName: rows[0]?.eventName, eventYear: rows[0]?.eventYear }))
    .filter((e) => e.eventName);

  const [selectedKey, setSelectedKey] = useState("");
  const selected = eventOptions.find((e) => e.key === selectedKey) || null;

  const [coupons, setCoupons] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const [amount, setAmount] = useState("0");
  const [count, setCount] = useState("1");
  const [recipientName, setRecipientName] = useState("");
  const [recipientEmail, setRecipientEmail] = useState("");
  const [notes, setNotes] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [generating, setGenerating] = useState(false);

  // ─── search (by recipient name or email) ───────────────────────────────
  const [search, setSearch] = useState("");
  const filteredCoupons = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return coupons;
    return coupons.filter((c) =>
      [c.recipient_name, c.recipient_email, c.code].some((field) => String(field || "").toLowerCase().includes(q))
    );
  }, [coupons, search]);

  // ─── row selection ──────────────────────────────────────────────────────
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const allFilteredSelected = filteredCoupons.length > 0 && filteredCoupons.every((c) => selectedIds.has(c.id));
  const someFilteredSelected = filteredCoupons.some((c) => selectedIds.has(c.id));

  const toggleRow = (id: number, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const toggleAllFiltered = (checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const c of filteredCoupons) {
        if (checked) next.add(c.id);
        else next.delete(c.id);
      }
      return next;
    });
  };

  // ─── edit dialog ────────────────────────────────────────────────────────
  const [editingCoupon, setEditingCoupon] = useState<any | null>(null);
  const [editAmount, setEditAmount] = useState("0");
  const [editRecipientName, setEditRecipientName] = useState("");
  const [editRecipientEmail, setEditRecipientEmail] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editValidUntil, setEditValidUntil] = useState("");
  const [saving, setSaving] = useState(false);

  const openEdit = (c: any) => {
    setEditingCoupon(c);
    setEditAmount(String(c.amount ?? "0"));
    setEditRecipientName(c.recipient_name || "");
    setEditRecipientEmail(c.recipient_email || "");
    setEditNotes(c.notes || "");
    setEditValidUntil(c.valid_until ? String(c.valid_until).slice(0, 10) : "");
  };

  const [deleting, setDeleting] = useState(false);

  const loadCoupons = async (eventName: string, eventYear: string) => {
    setLoading(true);
    try {
      const data = await safeFetch(
        `/api/coupons/admin?eventName=${encodeURIComponent(eventName)}&eventYear=${encodeURIComponent(eventYear)}`
      );
      setCoupons(Array.isArray(data) ? data : []);
      setSelectedIds(new Set());
      setSearch("");
    } finally {
      setLoading(false);
    }
  };

  const onSelectEvent = (key: string) => {
    setSelectedKey(key);
    const ev = eventOptions.find((e) => e.key === key);
    if (ev) loadCoupons(ev.eventName, ev.eventYear);
    else setCoupons([]);
  };

  const generateCoupons = async () => {
    if (!selected) return;
    if (!(Number(amount) > 0)) {
      toast({ title: "Enter a coupon amount", variant: "destructive" });
      return;
    }
    setGenerating(true);
    try {
      const res = await fetch("/api/coupons/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventName: selected.eventName,
          eventYear: selected.eventYear,
          amount: Number(amount),
          count: Number(count) || 1,
          recipientName: recipientName || undefined,
          recipientEmail: recipientEmail || undefined,
          notes: notes || undefined,
          validUntil: validUntil || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Failed to generate coupon(s)");
      const email = data[0]?.email;
      if (email?.attempted && email.sent) {
        toast({ title: "Success 🎟️", description: `Generated ${data.length} coupon(s) and emailed the details to ${email.to}.` });
      } else if (email?.attempted) {
        toast({
          title: `Generated ${data.length} coupon(s) — email NOT sent`,
          description: `${email.error || "Email failed"}. Use the "Email" button on the coupon to try again.`,
          variant: "destructive",
        });
      } else {
        toast({ title: "Success 🎟️", description: `Generated ${data.length} coupon(s).` });
      }
      setRecipientName("");
      setRecipientEmail("");
      setNotes("");
      loadCoupons(selected.eventName, selected.eventYear);
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setGenerating(false);
    }
  };

  const [emailingId, setEmailingId] = useState<number | null>(null);
  const emailCoupon = async (c: any) => {
    if (!c.recipient_email) {
      toast({ title: "No recipient email", description: "Edit the coupon to add an email address first.", variant: "destructive" });
      return;
    }
    setEmailingId(c.id);
    try {
      const res = await fetch(`/api/coupons/admin/${c.id}/email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || "Email failed");
      toast({ title: "Coupon emailed ✉️", description: `Sent ${c.code} to ${data.to}.` });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setEmailingId(null);
    }
  };

  const voidCoupon = async (id: number) => {
    try {
      const res = await fetch(`/api/coupons/admin/${id}/void`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Could not void this coupon");
      toast({ title: "Coupon voided" });
      if (selected) loadCoupons(selected.eventName, selected.eventYear);
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

  const saveEdit = async () => {
    if (!editingCoupon) return;
    if (editingCoupon.status === "active" && !(Number(editAmount) > 0)) {
      toast({ title: "Enter a coupon amount", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/coupons/admin/${editingCoupon.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // Only send amount for an active coupon — the server rejects an
          // amount change on an already-used/void coupon anyway, but this
          // keeps the request honest about what's actually changing.
          amount: editingCoupon.status === "active" ? Number(editAmount) : undefined,
          recipientName: editRecipientName || undefined,
          recipientEmail: editRecipientEmail || undefined,
          notes: editNotes || undefined,
          validUntil: editValidUntil || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Could not update this coupon");
      toast({ title: "Coupon updated" });
      setEditingCoupon(null);
      if (selected) loadCoupons(selected.eventName, selected.eventYear);
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const deleteCoupon = async (id: number) => {
    const res = await fetch(`/api/coupons/admin/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.message || `Could not delete coupon ${id}`);
    }
  };

  const deleteOne = async (c: any) => {
    if (!window.confirm(`Permanently delete coupon ${c.code}? This can't be undone.`)) return;
    try {
      await deleteCoupon(c.id);
      toast({ title: "Coupon deleted" });
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(c.id);
        return next;
      });
      if (selected) loadCoupons(selected.eventName, selected.eventYear);
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

  const deleteSelected = async () => {
    if (selectedIds.size === 0) return;
    if (
      !window.confirm(
        `Permanently delete ${selectedIds.size} coupon(s)? This can't be undone.`
      )
    ) {
      return;
    }
    setDeleting(true);
    try {
      const ids = Array.from(selectedIds);
      const results = await Promise.allSettled(ids.map((id) => deleteCoupon(id)));
      const failed = results.filter((r) => r.status === "rejected").length;
      if (failed > 0) {
        toast({
          title: "Some coupons couldn't be deleted",
          description: `${ids.length - failed} of ${ids.length} deleted.`,
          variant: "destructive",
        });
      } else {
        toast({ title: `${ids.length} coupon(s) deleted` });
      }
      setSelectedIds(new Set());
      if (selected) loadCoupons(selected.eventName, selected.eventYear);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div>
      <div className="mb-6 max-w-md">
        <Label>Select Event</Label>
        <select
          className="w-full mt-2 p-2 border rounded text-foreground bg-background"
          value={selectedKey}
          onChange={(e) => onSelectEvent(e.target.value)}
        >
          <option value="">-- Choose Event --</option>
          {eventOptions.map((e) => (
            <option key={e.key} value={e.key}>
              {e.eventName} {e.eventYear}
            </option>
          ))}
        </select>
      </div>

      {selected && (
        <>
          <Card className="mb-6">
            <CardContent className="p-6 space-y-4">
              <h2 className="text-xl font-bold">
                Generate Coupons — {selected.eventName} {selected.eventYear}
              </h2>
              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <Label>Coupon Amount ($) *</Label>
                  <Input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className="mt-2" />
                </div>
                <div>
                  <Label>How many coupons?</Label>
                  <Input type="number" min="1" max="100" value={count} onChange={(e) => setCount(e.target.value)} className="mt-2" />
                </div>
                <div>
                  <Label>Recipient Name (optional)</Label>
                  <Input value={recipientName} onChange={(e) => setRecipientName(e.target.value)} className="mt-2" placeholder="Who this coupon is for" />
                </div>
                <div>
                  <Label>Recipient Email (optional)</Label>
                  <Input type="email" value={recipientEmail} onChange={(e) => setRecipientEmail(e.target.value)} className="mt-2" placeholder="Coupon code & details are emailed here" />
                </div>
                <div>
                  <Label>Valid Until (optional)</Label>
                  <Input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} className="mt-2" />
                </div>
                <div>
                  <Label>Notes / Conditions (optional)</Label>
                  <Input value={notes} onChange={(e) => setNotes(e.target.value)} className="mt-2" placeholder="e.g. Volunteer thank-you coupon" />
                </div>
              </div>
              <Button onClick={generateCoupons} disabled={generating}>
                {generating ? "Generating..." : "🎟️ Generate Coupon(s)"}
              </Button>
              <p className="text-xs text-muted-foreground">
                Each coupon is single-use — once it's applied to a registration it can never be redeemed again.
                If a recipient email is entered, the coupon code(s), value, validity and QR code are emailed there
                automatically; otherwise share the code (or the QR code below) with the person it's intended for.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6">
              <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                <h3 className="font-bold">
                  Coupons for {selected.eventName} {selected.eventYear} {loading && "(loading...)"}
                </h3>
                <div className="flex items-center gap-2">
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search by name or email..."
                    className="w-64"
                  />
                  {selectedIds.size > 0 && (
                    <Button size="sm" variant="destructive" onClick={deleteSelected} disabled={deleting}>
                      {deleting ? "Deleting..." : `🗑️ Delete Selected (${selectedIds.size})`}
                    </Button>
                  )}
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left">
                      <th className="p-2 w-8">
                        <Checkbox
                          // Radix's checked prop accepts "indeterminate" as
                          // a third state, for exactly this "some but not
                          // all visible rows are selected" case — distinct
                          // from a plain unchecked/checked toggle.
                          checked={allFilteredSelected ? true : someFilteredSelected ? "indeterminate" : false}
                          onCheckedChange={(checked) => toggleAllFiltered(checked === true)}
                          aria-label="Select all"
                        />
                      </th>
                      <th className="p-2">QR</th>
                      <th className="p-2">Code</th>
                      <th className="p-2">Amount</th>
                      <th className="p-2">Recipient</th>
                      <th className="p-2">Status</th>
                      <th className="p-2">Valid Until</th>
                      <th className="p-2">Notes</th>
                      <th className="p-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredCoupons.map((c) => (
                      <tr key={c.id} className="border-b">
                        <td className="p-2">
                          <Checkbox
                            checked={selectedIds.has(c.id)}
                            onCheckedChange={(checked) => toggleRow(c.id, checked === true)}
                            aria-label={`Select coupon ${c.code}`}
                          />
                        </td>
                        <td className="p-2">
                          {c.qr_code && <img src={c.qr_code} alt={c.code} className="w-12 h-12 border rounded bg-white" />}
                        </td>
                        <td className="p-2 font-mono font-medium">{c.code}</td>
                        <td className="p-2">
                          ${Number(c.amount).toFixed(2)}
                          {/* A partially-redeemed coupon keeps its leftover balance
                              usable, so show what it originally covered too. */}
                          {c.original_amount != null && Number(c.original_amount) !== Number(c.amount) && (
                            <div className="text-xs text-muted-foreground">
                              of ${Number(c.original_amount).toFixed(2)} original
                            </div>
                          )}
                        </td>
                        <td className="p-2">
                          {c.recipient_name || c.recipient_email ? (
                            <>
                              {c.recipient_name}
                              {c.recipient_email && <div className="text-xs text-muted-foreground">{c.recipient_email}</div>}
                            </>
                          ) : (
                            "-"
                          )}
                        </td>
                        <td className="p-2">
                          {c.status === "active" ? (
                            <span className="text-green-700 font-medium">
                              Active
                              {c.redeemed_at && (
                                <div className="text-xs text-muted-foreground font-normal">
                                  Partly used — {new Date(c.redeemed_at).toLocaleDateString("en-AU")}
                                </div>
                              )}
                            </span>
                          ) : c.status === "used" ? (
                            <span className="text-muted-foreground">Used{c.redeemed_at ? ` — ${new Date(c.redeemed_at).toLocaleDateString("en-AU")}` : ""}</span>
                          ) : (
                            <span className="text-red-600">Void</span>
                          )}
                        </td>
                        <td className="p-2 whitespace-nowrap">
                          {c.valid_until ? new Date(c.valid_until).toLocaleDateString("en-AU") : "No expiry"}
                        </td>
                        <td className="p-2 max-w-[200px] truncate" title={c.notes || ""}>{c.notes || "-"}</td>
                        <td className="p-2">
                          <div className="flex items-center gap-1 whitespace-nowrap">
                            <Button size="sm" variant="outline" onClick={() => openEdit(c)}>
                              Edit
                            </Button>
                            {c.recipient_email && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => emailCoupon(c)}
                                disabled={emailingId === c.id}
                                title={`Email this coupon to ${c.recipient_email}`}
                              >
                                {emailingId === c.id ? "Sending..." : "✉️ Email"}
                              </Button>
                            )}
                            {c.status === "active" && (
                              <Button size="sm" variant="destructive" onClick={() => voidCoupon(c.id)}>
                                Void
                              </Button>
                            )}
                            <Button size="sm" variant="destructive" onClick={() => deleteOne(c)}>
                              Delete
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {filteredCoupons.length === 0 && !loading && (
                      <tr>
                        <td colSpan={9} className="p-4 text-center text-muted-foreground">
                          {coupons.length === 0
                            ? "No coupons generated yet for this event."
                            : "No coupons match your search."}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {/* ─── Edit coupon dialog ─────────────────────────────────────────── */}
      <Dialog open={!!editingCoupon} onOpenChange={(open) => !open && setEditingCoupon(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Coupon {editingCoupon?.code}</DialogTitle>
          </DialogHeader>
          {editingCoupon && (
            <div className="space-y-4">
              <div>
                <Label>Coupon Amount ($) *</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={editAmount}
                  onChange={(e) => setEditAmount(e.target.value)}
                  disabled={editingCoupon.status !== "active"}
                  className="mt-2"
                />
                {editingCoupon.status !== "active" && (
                  <p className="text-xs text-muted-foreground mt-1">
                    This coupon has already been {editingCoupon.status} — its amount can no longer be changed.
                  </p>
                )}
              </div>
              <div>
                <Label>Recipient Name</Label>
                <Input value={editRecipientName} onChange={(e) => setEditRecipientName(e.target.value)} className="mt-2" />
              </div>
              <div>
                <Label>Recipient Email</Label>
                <Input value={editRecipientEmail} onChange={(e) => setEditRecipientEmail(e.target.value)} className="mt-2" />
              </div>
              <div>
                <Label>Valid Until</Label>
                <Input type="date" value={editValidUntil} onChange={(e) => setEditValidUntil(e.target.value)} className="mt-2" />
              </div>
              <div>
                <Label>Notes / Conditions</Label>
                <Input value={editNotes} onChange={(e) => setEditNotes(e.target.value)} className="mt-2" />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingCoupon(null)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={saveEdit} disabled={saving}>
              {saving ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Coupons;
