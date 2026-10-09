import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { BankFileDropBoxPanel, OpenfeedPanel, RegistrationEmailsPanel, MediaDropBoxPanel } from "./BankSetupPanels";
import SettlementPanel from "./SettlementPanel";

type SettingRow = {
  group: string;
  key: string;
  label: string;
  secret?: boolean;
  type?: "boolean";
  default?: string;
  value: string;
  hasValue: boolean;
};

async function api(path: string, options: RequestInit = {}) {
  const res = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers as any) },
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.message || "Request failed");
  return data;
}

// Groups shown on the "Settings" tab; every other group (and the database
// connection) stays on the "API Keys" tab.
const SETTINGS_TAB_GROUPS = [
  "Payment Methods",
  "Payment Reconciliation",
  "Automatic Registration Emails",
  "Bank File Drop Box (Google Drive)",
  "Event Media Drop Box",
];

function SettingsTab({ mode }: { mode: "keys" | "settings" }) {
  const { toast } = useToast();
  const [settings, setSettings] = useState<SettingRow[]>([]);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [groqModels, setGroqModels] = useState<string[]>([]);
  const [loadingGroqModels, setLoadingGroqModels] = useState(false);

  // Bumped after every save so the bank setup panels re-read their status.
  const [savedCount, setSavedCount] = useState(0);
  const load = () =>
    api("/api/admin-console/settings")
      .then((rows) => {
        setSettings(rows);
        setSavedCount((n) => n + 1);
      })
      .catch(() => {});
  useEffect(() => { load(); }, []);

  const save = async (key: string) => {
    const value = edits[key];
    if (value === undefined) return;
    try {
      await api(`/api/admin-console/settings/${key}`, { method: "PUT", body: JSON.stringify({ value }) });
      toast({ title: "Saved" });
      setEdits({ ...edits, [key]: undefined as any });
      load();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

  // Fetches the live list of models this Groq account has access to, so
  // the admin picks a real, currently-working model id instead of typing
  // one that might already be renamed or retired.
  const loadGroqModels = async () => {
    setLoadingGroqModels(true);
    try {
      const result = await api("/api/admin-console/groq-models");
      setGroqModels(result.models || []);
      if (!result.models?.length) {
        toast({ title: "No models found", description: "That Groq account doesn't appear to have any models available." });
      }
    } catch (err: any) {
      toast({ title: "Couldn't load models", description: err.message, variant: "destructive" });
    } finally {
      setLoadingGroqModels(false);
    }
  };

  // Payment method toggles save immediately on click — no separate Save
  // button needed for a checkbox, and it's exactly what should drive
  // whether that option shows up on the registration success page.
  const togglePaymentMethod = async (key: string, nextChecked: boolean) => {
    setSavingKey(key);
    try {
      await api(`/api/admin-console/settings/${key}`, {
        method: "PUT",
        body: JSON.stringify({ value: nextChecked ? "true" : "false" }),
      });
      load();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setSavingKey(null);
    }
  };

  const clear = async (key: string) => {
    if (!confirm("Clear this key?")) return;
    await api(`/api/admin-console/settings/${key}`, { method: "DELETE" });
    toast({ title: "Cleared" });
    load();
  };

  const groups = Array.from(new Set(settings.map((s) => s.group)))
    .filter((g) => (mode === "settings") === SETTINGS_TAB_GROUPS.includes(g))
    .sort((a, b) =>
      mode === "settings" ? SETTINGS_TAB_GROUPS.indexOf(a) - SETTINGS_TAB_GROUPS.indexOf(b) : 0
    );

  return (
    <div className="space-y-8">
      {/* Database connection settings live here, just before Stripe, rather
          than as their own top-level tab. */}
      {mode === "keys" && (
        <div>
          <h3 className="font-bold text-lg mb-3">Database</h3>
          <DatabaseTab />
        </div>
      )}

      {groups.map((group) => {
        const groupSettings = settings.filter((s) => s.group === group);
        const isPaymentMethods = group === "Payment Methods";

        return (
          <div key={group}>
            <h3 className="font-bold text-lg mb-3">{group}</h3>

            {isPaymentMethods ? (
              <>
                <p className="text-sm text-muted-foreground mb-3">
                  Tick a payment method to offer it on the event registration success page. Untick
                  it to hide that option from registrants immediately.
                </p>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm max-w-md">
                    <thead>
                      <tr className="text-left border-b">
                        <th className="py-2">Payment Method</th>
                        <th className="py-2 text-center">Enabled</th>
                      </tr>
                    </thead>
                    <tbody>
                      {groupSettings.map((s) => (
                        <tr key={s.key} className="border-b">
                          <td className="py-3">{s.label}</td>
                          <td className="py-3 text-center">
                            <input
                              type="checkbox"
                              className="w-4 h-4"
                              checked={s.value === "true"}
                              disabled={savingKey === s.key}
                              onChange={(e) => togglePaymentMethod(s.key, e.target.checked)}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <div className="space-y-3">
                {groupSettings.map((s) => {
                  // The Groq model picker gets a dropdown of live-fetched
                  // model ids instead of a free-text box, so the admin
                  // can't accidentally type a model that no longer exists.
                  if (s.key === "groq_model") {
                    const currentValue = edits[s.key] ?? s.value;
                    const options = groqModels.includes(currentValue) || !currentValue
                      ? groqModels
                      : [currentValue, ...groqModels]; // keep the saved value visible even before a refresh
                    return (
                      <div key={s.key} className="flex items-end gap-3 flex-wrap">
                        <div className="flex-1 min-w-[220px]">
                          <Label>{s.label}</Label>
                          <select
                            className="w-full mt-1 p-2 border rounded text-foreground bg-background text-sm"
                            value={currentValue}
                            onChange={(e) => setEdits({ ...edits, [s.key]: e.target.value })}
                          >
                            <option value="">-- Choose a model --</option>
                            {options.map((id) => (
                              <option key={id} value={id}>{id}</option>
                            ))}
                          </select>
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={loadGroqModels}
                          disabled={loadingGroqModels}
                        >
                          {loadingGroqModels ? "Loading..." : "Load models"}
                        </Button>
                        <Button size="sm" onClick={() => save(s.key)}>Save</Button>
                      </div>
                    );
                  }

                  if (s.type === "boolean") {
                    return (
                      <label key={s.key} className="flex items-center gap-2 text-sm cursor-pointer">
                        <input
                          type="checkbox"
                          className="w-4 h-4"
                          checked={s.value === "true"}
                          disabled={savingKey === s.key}
                          onChange={(e) => togglePaymentMethod(s.key, e.target.checked)}
                        />
                        {s.label}
                      </label>
                    );
                  }

                  return (
                    <div key={s.key} className="flex items-end gap-3 flex-wrap">
                      <div className="flex-1 min-w-[220px]">
                        <Label>{s.label}{s.secret && s.hasValue && " (set — hidden)"}</Label>
                        {s.secret ? (
                          <PasswordInput
                            placeholder="••••••••"
                            autoComplete="new-password"
                            value={edits[s.key] ?? ""}
                            onChange={(e) => setEdits({ ...edits, [s.key]: e.target.value })}
                          />
                        ) : (
                          <Input
                            type="text"
                            placeholder={s.default ? `Default: ${s.default}` : ""}
                            value={edits[s.key] ?? s.value}
                            onChange={(e) => setEdits({ ...edits, [s.key]: e.target.value })}
                          />
                        )}
                      </div>
                      <Button size="sm" onClick={() => save(s.key)}>Save</Button>
                      {s.hasValue && <Button size="sm" variant="outline" onClick={() => clear(s.key)}>Clear</Button>}
                    </div>
                  );
                })}
                {group === "Automatic Registration Emails" && <RegistrationEmailsPanel refreshKey={savedCount} />}
                {group.startsWith("Bank File Drop Box") && <BankFileDropBoxPanel refreshKey={savedCount} />}
                {group === "Event Media Drop Box" && <MediaDropBoxPanel refreshKey={savedCount} />}
                {group.startsWith("Live Bank Feed") && <OpenfeedPanel refreshKey={savedCount} />}
                {group === "AI Email Draft" && (
                  <p className="text-xs text-muted-foreground">
                    Save your Groq API key first, then click "Load models" to see which models your
                    account can actually use, and pick one.
                  </p>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function AdminUsersTab() {
  const { toast } = useToast();
  const [users, setUsers] = useState<any[]>([]);
  const [form, setForm] = useState({ name: "", email: "", password: "", role: "admin" });
  const load = () => api("/api/admin-console/admin-users").then(setUsers).catch(() => {});
  useEffect(() => { load(); }, []);

  const create = async () => {
    if (!form.name.trim() || !form.email.trim() || !form.password) return;
    try {
      await api("/api/admin-console/admin-users", { method: "POST", body: JSON.stringify(form) });
      toast({ title: "Admin user created" });
      setForm({ name: "", email: "", password: "", role: "admin" });
      load();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

  const del = async (id: number) => {
    if (!confirm("Delete this admin user?")) return;
    try {
      await api(`/api/admin-console/admin-users/${id}`, { method: "DELETE" });
      load();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex gap-2 flex-wrap items-end">
        <div><Label>Name</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
        <div><Label>Email</Label><Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
        <div><Label>Password</Label><PasswordInput autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></div>
        <div>
          <Label>Role</Label>
          <select
            className="h-10 mt-0 px-3 border rounded text-sm bg-background text-foreground"
            value={form.role}
            onChange={(e) => setForm({ ...form, role: e.target.value })}
          >
            <option value="admin">Admin (limited access)</option>
            <option value="platform_admin">Platform Admin (platform-wide access)</option>
            <option value="superadmin">Super Admin (full access)</option>
          </select>
        </div>
        <Button onClick={create}>Add admin</Button>
      </div>
      <p className="text-xs text-muted-foreground">
        <strong>Admin (limited access)</strong> can manage Events Settings, Events Management and File
        Management only — no access to Members, Database Tables, API Keys or Settings.
        <strong className="ml-1">Super Admin</strong> has full access to everything in this console.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="text-left border-b"><th className="py-2">Name</th><th>Email</th><th>Role</th><th></th></tr></thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-b">
                <td className="py-2">{u.name}</td>
                <td>{u.email}</td>
                <td>{u.role}</td>
                <td><Button size="sm" variant="destructive" onClick={() => del(u.id)}>Delete</Button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AuditLogTab() {
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => { api("/api/admin-console/audit-log").then(setRows).catch(() => {}); }, []);
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead><tr className="text-left border-b"><th className="py-2">When</th><th>Admin</th><th>Action</th><th>Entity</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b">
              <td className="py-2">{new Date(r.created_at).toLocaleString()}</td>
              <td>{r.admin_email}</td>
              <td>{r.action}</td>
              <td>{r.entity || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DatabaseTab() {
  const { toast } = useToast();
  const [status, setStatus] = useState<{ current: string | null; connected: boolean } | null>(null);
  const [newConnStr, setNewConnStr] = useState("");
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [saveResult, setSaveResult] = useState<string | null>(null);

  const load = () => api("/api/admin-console/database").then(setStatus).catch(() => {});
  useEffect(() => { load(); }, []);

  const test = async () => {
    if (!newConnStr.trim()) return;
    setTesting(true);
    setTestResult(null);
    try {
      const result = await api("/api/admin-console/database/test", { method: "POST", body: JSON.stringify({ connectionString: newConnStr }) });
      setTestResult(result);
    } catch (err: any) {
      setTestResult({ ok: false, message: err.message });
    } finally {
      setTesting(false);
    }
  };

  const save = async () => {
    if (!newConnStr.trim()) return;
    setSaving(true);
    setSaveResult(null);
    try {
      const result = await api("/api/admin-console/database", { method: "PUT", body: JSON.stringify({ connectionString: newConnStr }) });
      setSaveResult(result.message);
      toast({ title: "Saved", description: "Restart the server for this to take effect." });
      setNewConnStr("");
      setTestResult(null);
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h3 className="font-bold text-lg mb-2">Current connection</h3>
        {status ? (
          <div className="flex items-center gap-2">
            <span className={`inline-block w-2.5 h-2.5 rounded-full ${status.connected ? "bg-green-500" : "bg-red-500"}`} />
            <span className="text-sm">{status.connected ? "Connected" : "Not connected"}</span>
            <span className="text-sm text-muted-foreground font-mono">{status.current || "(not set)"}</span>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Loading...</p>
        )}
      </div>

      <div className="border-t pt-6">
        <h3 className="font-bold text-lg mb-2">Rotate / change connection string</h3>
        <p className="text-sm text-muted-foreground mb-3">
          Paste a new Neon (or any Postgres) connection string. It's tested against a throwaway connection
          first — nothing is saved unless the test succeeds, and the live app keeps using the current
          connection until you restart the server after saving.
        </p>
        <Label>New connection string</Label>
        <PasswordInput
          placeholder="postgresql://user:password@host/db?sslmode=require"
          value={newConnStr}
          onChange={(e) => { setNewConnStr(e.target.value); setTestResult(null); }}
          className="font-mono text-sm"
        />

        {testResult && (
          <p className={`text-sm mt-2 ${testResult.ok ? "text-green-600" : "text-destructive"}`}>
            {testResult.ok ? "✅ " : "❌ "}{testResult.message}
          </p>
        )}
        {saveResult && <p className="text-sm mt-2 text-amber-600">⚠️ {saveResult}</p>}

        <div className="flex gap-2 mt-3">
          <Button variant="outline" onClick={test} disabled={testing || !newConnStr.trim()}>
            {testing ? "Testing..." : "Test connection"}
          </Button>
          <Button onClick={save} disabled={saving || !newConnStr.trim() || !testResult?.ok}>
            {saving ? "Saving..." : "Save to .env"}
          </Button>
        </div>
        {!testResult?.ok && newConnStr.trim() && (
          <p className="text-xs text-muted-foreground mt-1">Test the connection successfully before saving.</p>
        )}
      </div>
    </div>
  );
}

export default function PlatformConsole({ currentAdminEmail }: { currentAdminEmail?: string }) {
  return (
    <div>
      <Tabs defaultValue="keys">
        <TabsList className="flex flex-wrap h-auto w-full gap-1">
          <TabsTrigger value="keys">API Keys</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
          <TabsTrigger value="users">Admin Users</TabsTrigger>
          <TabsTrigger value="settlements">Charity Settlements</TabsTrigger>
          <TabsTrigger value="audit">Audit Log</TabsTrigger>
        </TabsList>
        <TabsContent value="keys"><SettingsTab mode="keys" /></TabsContent>
        <TabsContent value="settings"><SettingsTab mode="settings" /></TabsContent>
        <TabsContent value="users"><AdminUsersTab /></TabsContent>
        <TabsContent value="settlements"><SettlementPanel /></TabsContent>
        <TabsContent value="audit"><AuditLogTab /></TabsContent>
      </Tabs>
    </div>
  );
}
