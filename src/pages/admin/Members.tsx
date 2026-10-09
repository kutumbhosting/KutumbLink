import { useState, useRef, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { safeFetch, normalizeInterests, downloadCSV } from "./safeFetch";
import { useToast } from "@/hooks/use-toast";
import { ColumnFilterHeader } from "@/components/admin/ColumnFilterHeader";

type MemberColumnKey = "membershipNumber" | "name" | "email" | "phone" | "address" | "interests";

interface MembersProps {
  memberData: any[];
  onReload: () => void;
}

const Members = ({ memberData, onReload }: MembersProps) => {
  const { toast } = useToast();
  const [selectedMemberRows, setSelectedMemberRows] = useState<string[]>([]);
  const [editingMember, setEditingMember] = useState<any | null>(null);
  const [importing, setImporting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [justOpened, setJustOpened] = useState(false);
  const editPanelRef = useRef<HTMLDivElement | null>(null);

  // ── Search / filter / sort ──────────────────────────────────────────────
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<"membershipNumber" | "name" | "email" | "phone" | "address">("membershipNumber");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  // Per-column dropdown filters (Excel-style: pick one or more values from
  // that column). Empty array for a column = no filter applied on it.
  const [columnFilters, setColumnFilters] = useState<Record<MemberColumnKey, string[]>>({
    membershipNumber: [],
    name: [],
    email: [],
    phone: [],
    address: [],
    interests: [],
  });
  const setColumnFilter = (key: MemberColumnKey, values: string[]) =>
    setColumnFilters((prev) => ({ ...prev, [key]: values }));
  const anyColumnFilterActive = Object.values(columnFilters).some((v) => v.length > 0);

  // Handles the three shapes `interests` shows up in across the app
  // (array, {label: true} object, or a plain string) and always returns a
  // clean array — used for both the filter dropdown's options and for
  // matching a member against the selected filter.
  const interestsArray = (interests: any): string[] => {
    if (Array.isArray(interests)) return interests;
    if (typeof interests === "object" && interests !== null)
      return Object.keys(interests).filter((k) => interests[k]);
    if (typeof interests === "string" && interests.trim())
      return interests.split(/[|,]/).map((s) => s.trim()).filter(Boolean);
    return [];
  };

  // Distinct values per column, used to populate each dropdown's checklist.
  const columnOptions = useMemo<Record<MemberColumnKey, string[]>>(() => {
    const uniq = (values: (string | undefined | null)[]) =>
      Array.from(new Set(values.map((v) => String(v ?? "").trim()).filter((v) => v !== "")));
    return {
      membershipNumber: uniq(memberData.map((m) => m.membershipNumber)),
      name: uniq(memberData.map((m) => m.name)),
      email: uniq(memberData.map((m) => m.email)),
      phone: uniq(memberData.map((m) => m.phone)),
      address: uniq(memberData.map((m) => m.address)),
      interests: uniq(memberData.flatMap((m) => interestsArray(m.interests))),
    };
  }, [memberData]);

  const toggleSort = (key: typeof sortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const visibleMembers = memberData
    .filter((m) => {
      if (
        columnFilters.membershipNumber.length &&
        !columnFilters.membershipNumber.includes(String(m.membershipNumber ?? ""))
      ) return false;
      if (columnFilters.name.length && !columnFilters.name.includes(String(m.name ?? ""))) return false;
      if (columnFilters.email.length && !columnFilters.email.includes(String(m.email ?? ""))) return false;
      if (columnFilters.phone.length && !columnFilters.phone.includes(String(m.phone ?? ""))) return false;
      if (columnFilters.address.length && !columnFilters.address.includes(String(m.address ?? ""))) return false;
      if (
        columnFilters.interests.length &&
        !interestsArray(m.interests).some((i) => columnFilters.interests.includes(i))
      ) return false;

      if (!search.trim()) return true;
      const q = search.trim().toLowerCase();
      return [m.membershipNumber, m.name, m.email, m.phone, m.address]
        .some((field) => String(field || "").toLowerCase().includes(q));
    })
    .sort((a, b) => {
      const av = String(a[sortKey] || "").toLowerCase();
      const bv = String(b[sortKey] || "").toLowerCase();
      const cmp = av.localeCompare(bv, undefined, { numeric: true });
      return sortDir === "asc" ? cmp : -cmp;
    });

  // ── Bulk email ────────────────────────────────────────────────────────
  const [emailDialogOpen, setEmailDialogOpen] = useState(false);
  const [emailAudience, setEmailAudience] = useState<"selected" | "all">("selected");
  const [emailTopic, setEmailTopic] = useState("");
  const [emailSubject, setEmailSubject] = useState("");
  const [emailMessage, setEmailMessage] = useState("");
  const [sendingEmail, setSendingEmail] = useState(false);
  const [generatingDraft, setGeneratingDraft] = useState(false);

  // Selection is keyed by membership number, not email — email is
  // intentionally not unique (family members can share one household
  // email), so keying by email meant checking one row also silently
  // selected every other row sharing that email, including for deletion.
  // Falls back to email+name for the rare legacy row missing a membership
  // number, which is still unique in practice even if not DB-enforced.
  const rowKey = (m: any) => m.membershipNumber || `${m.email}::${m.name}`;

  const toggleMemberRow = (key: string) =>
    setSelectedMemberRows((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );

  const allSelected = visibleMembers.length > 0 && visibleMembers.every((m) => selectedMemberRows.includes(rowKey(m)));
  const toggleSelectAll = () =>
    setSelectedMemberRows(allSelected
      ? selectedMemberRows.filter((k) => !visibleMembers.some((m) => rowKey(m) === k))
      : Array.from(new Set([...selectedMemberRows, ...visibleMembers.map(rowKey)]))
    );

  const openEmailDialog = () => {
    // Default to "All members" if nothing is currently checked, since
    // "selected" with zero recipients would just be a dead end.
    setEmailAudience(selectedMemberRows.length > 0 ? "selected" : "all");
    setEmailTopic("");
    setEmailSubject("");
    setEmailMessage("");
    setEmailDialogOpen(true);
  };

  // Asks the server to draft a subject + message from a short topic/brief.
  // The result lands in the same editable fields as manual entry, so the
  // admin reviews and can change anything before it's ever sent.
  const generateDraft = async () => {
    if (!emailTopic.trim()) {
      toast({
        title: "Describe the email first",
        description: "Type a quick topic or brief, e.g. \"reminder about Diwali event, free for members\".",
        variant: "destructive",
      });
      return;
    }

    setGeneratingDraft(true);
    try {
      const res = await fetch("/api/members/generate-email-draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: emailTopic }),
      });

      if (!res.ok) {
        await handleAuthOrServerError(res, "Couldn't generate a draft.");
        return;
      }

      const draft = await res.json();
      setEmailSubject(draft.subject || "");
      setEmailMessage(draft.message || "");
      toast({ title: "Draft ready", description: "Review it below and edit anything before sending." });
    } catch (err) {
      console.error("[generateDraft] network error", err);
      toast({
        title: "Network error",
        description: "Couldn't reach the server. Check your connection and try again.",
        variant: "destructive",
      });
    } finally {
      setGeneratingDraft(false);
    }
  };

  const sendBulkEmail = async () => {
    if (!emailSubject.trim() || !emailMessage.trim()) {
      toast({
        title: "Subject and message required",
        description: "Please fill in both the subject and message before sending.",
        variant: "destructive",
      });
      return;
    }
    if (emailAudience === "selected" && selectedMemberRows.length === 0) {
      toast({
        title: "No members selected",
        description: "Select at least one member, or choose \"All members\" instead.",
        variant: "destructive",
      });
      return;
    }

    setSendingEmail(true);
    try {
      const res = await fetch("/api/members/send-bulk-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject: emailSubject,
          message: emailMessage,
          sendToAll: emailAudience === "all",
          recipients: emailAudience === "selected"
            ? memberData
                .filter((m) => selectedMemberRows.includes(rowKey(m)))
                .map((m) => ({ email: m.email, name: m.name, membershipNumber: m.membershipNumber }))
            : undefined,
        }),
      });

      if (!res.ok) {
        await handleAuthOrServerError(res, "Couldn't send the email.");
        return;
      }

      const result = await res.json();
      // Surface the actual SMTP error, not just a count, so a failure is
      // self-diagnosing from the toast alone instead of requiring a trip
      // to the server console logs.
      const firstError = result.failures?.[0]?.error;
      const description = result.failed && firstError
        ? `${result.message} Reason: ${firstError}`
        : result.message;
      toast({
        title: result.failed ? "Sent with some failures" : "Email sent",
        description,
        variant: result.failed ? "destructive" : "default",
      });
      if (!result.failed) setEmailDialogOpen(false);
    } catch (err) {
      console.error("[sendBulkEmail] network error", err);
      toast({
        title: "Network error",
        description: "Couldn't reach the server. Check your connection and try again.",
        variant: "destructive",
      });
    } finally {
      setSendingEmail(false);
    }
  };

  // Shows a clear message instead of failing silently — in particular, if
  // the admin session cookie has expired, every request below 401s and the
  // page would otherwise look like nothing happened at all.
  const handleAuthOrServerError = async (res: Response, fallbackMessage: string) => {
    let message = fallbackMessage;
    try {
      const data = await res.json();
      if (data?.message) message = data.message;
    } catch {
      // response wasn't JSON — stick with fallbackMessage
    }
    if (res.status === 401) {
      toast({
        title: "Session expired",
        description: "Your admin session has expired. Please log out and log back in, then try again.",
        variant: "destructive",
      });
    } else {
      toast({ title: "Something went wrong", description: message, variant: "destructive" });
    }
  };

  const deleteMemberRows = async () => {
    setDeleting(true);
    try {
      const res = await fetch("/api/members/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ membershipNumbers: selectedMemberRows }),
      });

      if (!res.ok) {
        await handleAuthOrServerError(res, "Couldn't delete the selected member(s).");
        return;
      }

      toast({ title: "Deleted", description: "Selected member(s) removed." });
      setSelectedMemberRows([]);
      setEditingMember(null);
      onReload();
    } catch (err) {
      console.error("[deleteMemberRows] network error", err);
      toast({
        title: "Network error",
        description: "Couldn't reach the server. Check your connection and try again.",
        variant: "destructive",
      });
    } finally {
      setDeleting(false);
    }
  };

  // Picks up DATA_ROOT/members/members.json if one has been dropped there —
  // adds any members not already present (matched by email), then removes
  // the file/folder so it can't be imported twice by accident.
  const importFromDropIn = async () => {
    setImporting(true);
    try {
      const result = await safeFetch("/api/admin-console/import-members", { method: "POST" });
      if (!result?.found) {
        toast({ title: "No file found", description: "Place a members.json file in the configured upload storage under members/ first." });
      } else if (result.error) {
        toast({ title: "Import failed", description: result.error, variant: "destructive" });
      } else {
        toast({
          title: "Import complete",
          description: `${result.imported} member(s) added, ${result.skipped} skipped (already existed).`,
        });
        onReload();
      }
    } catch (err: any) {
      toast({ title: "Import failed", description: err.message, variant: "destructive" });
    } finally {
      setImporting(false);
    }
  };

  const openEditor = () => {
    const member = memberData.find((m) => rowKey(m) === selectedMemberRows[0]);
    if (!member) {
      toast({
        title: "Couldn't find that member",
        description: "The member list may be out of date — try refreshing the page and selecting again.",
        variant: "destructive",
      });
      return;
    }
    setEditingMember({
      ...member,
      interests: Array.isArray(member.interests)
        ? member.interests.join(", ")
        : typeof member.interests === "object" && member.interests !== null
        ? Object.keys(member.interests).filter((k) => member.interests[k]).join(", ")
        : member.interests || "",
    });

    // Make it unmistakable that the panel just opened: scroll it into view
    // and flash a highlight ring around it for a moment.
    setJustOpened(true);
    setTimeout(() => {
      editPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
    setTimeout(() => setJustOpened(false), 1200);
  };

  const saveEditingMember = async () => {
    if (!editingMember) return;

    const newEmail = (editingMember.email || "").trim();
    if (!newEmail) {
      toast({ title: "Email required", description: "Email address can't be empty.", variant: "destructive" });
      return;
    }
    const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail);
    if (!emailValid) {
      toast({ title: "Invalid email", description: "Please enter a valid email address.", variant: "destructive" });
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/members/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          membershipNumber: editingMember.membershipNumber,
          updatedData: { ...editingMember, email: newEmail },
        }),
      });

      if (!res.ok) {
        // Keep the panel open with their edits intact so nothing is lost.
        await handleAuthOrServerError(res, "Couldn't save changes to this member.");
        return;
      }

      toast({ title: "Saved", description: `${editingMember.name || "Member"} was updated.` });
      setEditingMember(null);
      setSelectedMemberRows([]);
      onReload();
    } catch (err) {
      console.error("[saveEditingMember] network error", err);
      toast({
        title: "Network error",
        description: "Couldn't reach the server. Check your connection and try again.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardContent className="p-6">
        <div className="flex justify-between mb-6 flex-wrap gap-2">
          <h2 className="text-xl font-bold">Kutumb Members</h2>
          <div className="flex gap-2">
            <Button variant="outline" onClick={importFromDropIn} disabled={importing}>
              {importing ? "Importing..." : "📥 Import from members.json"}
            </Button>
            <Button variant="outline" onClick={openEmailDialog} disabled={memberData.length === 0}>
              ✉️ Send Email
            </Button>
            <Button onClick={() => downloadCSV(memberData, "members.csv")}>
              Download CSV
            </Button>
          </div>
        </div>

        <p className="text-sm text-muted-foreground mb-4">
          {search.trim() || anyColumnFilterActive ? (
            <>
              Showing <span className="font-semibold text-foreground">{visibleMembers.length}</span> of{" "}
              <span className="font-semibold text-foreground">{memberData.length}</span> members
            </>
          ) : (
            <>
              Total Registered Members: <span className="font-semibold text-foreground">{memberData.length}</span>
            </>
          )}
        </p>

        <div className="flex flex-wrap gap-2 mb-4">
          <Input
            placeholder="Search by name, email, phone, address, or membership no..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-sm"
          />
          {(search.trim() || anyColumnFilterActive) && (
            <Button
              variant="ghost"
              onClick={() => {
                setSearch("");
                setColumnFilters({
                  membershipNumber: [], name: [], email: [], phone: [], address: [], interests: [],
                });
              }}
            >
              Clear filters
            </Button>
          )}
        </div>

        {selectedMemberRows.length > 0 && (
          <Button variant="destructive" className="mb-3" onClick={deleteMemberRows} disabled={deleting}>
            {deleting ? "Deleting..." : "Delete Selected"}
          </Button>
        )}

        <Button
          className="mb-4 ml-2"
          onClick={openEditor}
          disabled={selectedMemberRows.length !== 1}
        >
          Modify Selected
        </Button>

        {editingMember && (
          <Card
            ref={editPanelRef}
            className={`mb-6 transition-shadow duration-300 ${
              justOpened ? "ring-4 ring-primary ring-offset-2 shadow-lg" : ""
            }`}
          >
            <CardContent className="p-4 space-y-3">
              <h3 className="font-bold">Edit Member — #{editingMember.membershipNumber} ({editingMember.email})</h3>

              <div>
                <label className="text-xs font-medium text-muted-foreground">Full Name</label>
                <Input
                  value={editingMember.name}
                  onChange={(e) => setEditingMember({ ...editingMember, name: e.target.value })}
                />
              </div>

              <div>
                <label className="text-xs font-medium text-muted-foreground">Email Address</label>
                <Input
                  type="email"
                  value={editingMember.email}
                  onChange={(e) => setEditingMember({ ...editingMember, email: e.target.value })}
                />
              </div>

              <div>
                <label className="text-xs font-medium text-muted-foreground">Phone</label>
                <Input
                  value={editingMember.phone}
                  onChange={(e) => setEditingMember({ ...editingMember, phone: e.target.value })}
                />
              </div>

              <div>
                <label className="text-xs font-medium text-muted-foreground">Address</label>
                <Input
                  value={editingMember.address}
                  onChange={(e) => setEditingMember({ ...editingMember, address: e.target.value })}
                />
              </div>

              <div>
                <label className="text-xs font-medium text-muted-foreground">
                  Interests (comma-separated)
                </label>
                <Input
                  value={editingMember.interests || ""}
                  onChange={(e) => setEditingMember({ ...editingMember, interests: e.target.value })}
                />
              </div>

              <div className="flex gap-2 pt-2">
                <Button onClick={saveEditingMember} disabled={saving}>
                  {saving ? "Saving..." : "Save Changes"}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setEditingMember(null)}
                  disabled={saving}
                >
                  Cancel
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="p-2">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleSelectAll}
                    aria-label="Select all visible members"
                  />
                </th>
                {[
                  { key: "membershipNumber" as const, label: "Membership No" },
                  { key: "name" as const, label: "Name" },
                  { key: "email" as const, label: "Email" },
                  { key: "phone" as const, label: "Phone" },
                  { key: "address" as const, label: "Address" },
                ].map(({ key, label }) => (
                  <th key={key} className="p-2 text-left">
                    <ColumnFilterHeader
                      label={label}
                      filterable={false}
                      sortDir={sortKey === key ? sortDir : null}
                      onSortClick={() => toggleSort(key)}
                    />
                  </th>
                ))}
                <th className="p-2 text-left">
                  <ColumnFilterHeader
                    label="Interests"
                    options={columnOptions.interests}
                    selected={columnFilters.interests}
                    onChange={(values) => setColumnFilter("interests", values)}
                  />
                </th>
              </tr>
            </thead>
            <tbody>
              {visibleMembers.map((item, i) => (
                <tr key={i} className="border-b">
                  <td className="p-2">
                    <input
                      type="checkbox"
                      checked={selectedMemberRows.includes(rowKey(item))}
                      onChange={() => toggleMemberRow(rowKey(item))}
                    />
                  </td>
                  <td className="p-2 font-mono">{item.membershipNumber || "-"}</td>
                  <td className="p-2">{item.name}</td>
                  <td className="p-2">{item.email}</td>
                  <td className="p-2">{item.phone}</td>
                  <td className="p-2">{item.address}</td>
                  <td className="p-2">{normalizeInterests(item.interests)}</td>
                </tr>
              ))}
              {visibleMembers.length === 0 && (
                <tr>
                  <td colSpan={7} className="p-4 text-center text-muted-foreground">
                    No members match your search/filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </CardContent>

      <Dialog open={emailDialogOpen} onOpenChange={setEmailDialogOpen}>
        <DialogContent className="sm:max-w-lg max-h-[85vh] flex flex-col gap-0 p-0 overflow-hidden">
          <DialogHeader className="p-6 pb-4 shrink-0">
            <DialogTitle>Send Bulk Email</DialogTitle>
            <DialogDescription>
              Compose a message to send to Kutumb members.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 overflow-y-auto px-6 py-1 min-h-0">
            <div>
              <Label className="text-xs font-medium text-muted-foreground">Recipients</Label>
              <RadioGroup
                value={emailAudience}
                onValueChange={(value) => setEmailAudience(value as "selected" | "all")}
                className="mt-2 space-y-2"
              >
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="selected" id="audience-selected" disabled={selectedMemberRows.length === 0} />
                  <Label htmlFor="audience-selected" className="font-normal cursor-pointer">
                    Selected members ({selectedMemberRows.length} selected)
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="all" id="audience-all" />
                  <Label htmlFor="audience-all" className="font-normal cursor-pointer">
                    All members ({memberData.length} total)
                  </Label>
                </div>
              </RadioGroup>
            </div>

            <div>
              <Label className="text-xs font-medium text-muted-foreground">
                What's this email about? <span className="font-normal">(optional — for AI drafting)</span>
              </Label>
              <div className="flex gap-2 mt-1">
                <Input
                  value={emailTopic}
                  onChange={(e) => setEmailTopic(e.target.value)}
                  placeholder="e.g. Reminder about Diwali event on Nov 1, free for members"
                />
                <Button type="button" variant="secondary" onClick={generateDraft} disabled={generatingDraft}>
                  {generatingDraft ? "Writing..." : "✨ Generate"}
                </Button>
              </div>
            </div>

            <div>
              <Label className="text-xs font-medium text-muted-foreground">Subject</Label>
              <Input
                value={emailSubject}
                onChange={(e) => setEmailSubject(e.target.value)}
                placeholder="e.g. Upcoming Kutumb Event"
              />
            </div>

            <div>
              <Label className="text-xs font-medium text-muted-foreground">Message</Label>
              <Textarea
                value={emailMessage}
                onChange={(e) => setEmailMessage(e.target.value)}
                placeholder="Write your message here, or generate a draft above..."
                rows={6}
                className="min-h-[100px] resize-y"
              />
            </div>
          </div>

          <DialogFooter className="p-6 pt-4 shrink-0 border-t">
            <Button variant="outline" onClick={() => setEmailDialogOpen(false)} disabled={sendingEmail}>
              Cancel
            </Button>
            <Button onClick={sendBulkEmail} disabled={sendingEmail}>
              {sendingEmail
                ? "Sending..."
                : `Send to ${emailAudience === "all" ? memberData.length : selectedMemberRows.length}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
};

export default Members;
