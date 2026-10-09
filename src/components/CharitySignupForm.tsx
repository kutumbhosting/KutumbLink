import { useState } from "react";
import type { FormEvent } from "react";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import LegalDialog from "@/components/LegalDialog";
import type { LegalKind } from "@/lib/legalContent";

const REGIONS = ["Metropolitan", "Regional", "Rural", "Remote"];
const STATES = ["ACT", "NSW", "NT", "QLD", "SA", "TAS", "VIC", "WA"];

type FormState = {
  firstName: string; lastName: string; email: string; mobile: string; password: string;
  region: string; state: string; organisationName: string; legalName: string; abn: string;
  acceptedTerms: boolean;
};
const EMPTY: FormState = {
  firstName: "", lastName: "", email: "", mobile: "", password: "", region: "", state: "",
  organisationName: "", legalName: "", abn: "", acceptedTerms: false,
};

const selectClass =
  "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export type SignupResult = { name: string; email: string };

export default function CharitySignupForm({ onSuccess }: { onSuccess: (result: SignupResult) => void }) {
  const [form, setForm] = useState<FormState>(EMPTY);
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [legal, setLegal] = useState<LegalKind | null>(null);

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((previous) => ({ ...previous, [key]: value }));
    setErrors((previous) => ({ ...previous, [key]: undefined }));
  };

  const validate = () => {
    const next: Partial<Record<keyof FormState, string>> = {};
    if (!form.firstName.trim()) next.firstName = "First name is required";
    if (!form.lastName.trim()) next.lastName = "Last name is required";
    if (!form.email.trim()) next.email = "Email address is required";
    else if (!/^\S+@\S+\.\S+$/.test(form.email.trim())) next.email = "Enter a valid email address";
    if (!form.mobile.trim()) next.mobile = "Mobile is required";
    else if (!/^\+?[0-9 ()-]{8,20}$/.test(form.mobile.trim())) next.mobile = "Enter a valid mobile number";
    if (!form.region) next.region = "Region is required";
    if (!form.state) next.state = "State is required";
    if (form.organisationName.trim().length < 2) next.organisationName = "Company / organisation name is required";
    if (form.legalName.trim().length < 2) next.legalName = "Legal name is required";
    if (!/^\d{11}$/.test(form.abn.replace(/\s/g, ""))) next.abn = "Enter a valid 11-digit ABN";
    if (form.password.length < 12) next.password = "Password must be at least 12 characters";
    if (!form.acceptedTerms) next.acceptedTerms = "You must accept the terms and conditions and privacy policy";
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    if (!validate()) return;
    setBusy(true);
    try {
      const response = await fetch("/api/organisations/onboarding/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          firstName: form.firstName.trim(), lastName: form.lastName.trim(),
          email: form.email.trim(), mobile: form.mobile.trim(),
          organisationName: form.organisationName.trim(), legalName: form.legalName.trim(),
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.message || "Could not start your application");
      onSuccess({ name: `${form.firstName.trim()} ${form.lastName.trim()}`, email: form.email.trim() });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start onboarding");
    } finally {
      setBusy(false);
    }
  };

  const Err = ({ k }: { k: keyof FormState }) =>
    errors[k] ? <p role="alert" className="text-xs text-destructive">{errors[k]}</p> : null;
  const Req = () => <span className="text-destructive" aria-hidden="true"> *</span>;

  return (
    <>
    <form onSubmit={submit} noValidate className="space-y-4">
      {error && <p role="alert" className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="join-first">First name<Req /></Label>
          <Input id="join-first" required autoComplete="given-name" value={form.firstName} onChange={(e) => update("firstName", e.target.value)} />
          <Err k="firstName" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="join-last">Last name<Req /></Label>
          <Input id="join-last" required autoComplete="family-name" value={form.lastName} onChange={(e) => update("lastName", e.target.value)} />
          <Err k="lastName" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="join-email">Email address<Req /></Label>
          <Input id="join-email" required type="email" autoComplete="email" value={form.email} onChange={(e) => update("email", e.target.value)} />
          <Err k="email" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="join-mobile">Mobile<Req /></Label>
          <Input id="join-mobile" required type="tel" inputMode="tel" autoComplete="tel" placeholder="04xx xxx xxx" value={form.mobile} onChange={(e) => update("mobile", e.target.value)} />
          <Err k="mobile" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="join-region">Region<Req /></Label>
          <select id="join-region" required className={selectClass} value={form.region} onChange={(e) => update("region", e.target.value)}>
            <option value="">Select region</option>
            {REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          <Err k="region" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="join-state">State<Req /></Label>
          <select id="join-state" required className={selectClass} value={form.state} onChange={(e) => update("state", e.target.value)}>
            <option value="">Select state</option>
            {STATES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <Err k="state" />
        </div>
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="join-password">Password<Req /></Label>
          <Input id="join-password" required type="password" autoComplete="new-password" value={form.password} onChange={(e) => update("password", e.target.value)} />
          <p className="text-xs text-muted-foreground">Use at least 12 characters. Your organisation workspace is separate from other charities.</p>
          <Err k="password" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="join-org">Company / organisation name<Req /></Label>
          <Input id="join-org" required autoComplete="organization" value={form.organisationName} onChange={(e) => update("organisationName", e.target.value)} />
          <Err k="organisationName" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="join-legal">Legal name<Req /></Label>
          <Input id="join-legal" required value={form.legalName} onChange={(e) => update("legalName", e.target.value)} />
          <Err k="legalName" />
        </div>
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="join-abn">ABN<Req /></Label>
          <Input id="join-abn" required inputMode="numeric" placeholder="11 digits" value={form.abn} onChange={(e) => update("abn", e.target.value)} />
          <p className="text-xs text-muted-foreground">Platform review is separate from ACNC and DGR government status.</p>
          <Err k="abn" />
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-start gap-2">
          <Checkbox id="join-terms" checked={form.acceptedTerms} onCheckedChange={(v) => update("acceptedTerms", v === true)} aria-required="true" />
          <Label htmlFor="join-terms" className="text-sm font-normal leading-snug">
            By signing up, I agree to the{" "}
            <button type="button" className="underline" onClick={() => setLegal("terms")}>terms and conditions</button>{" "}
            and have read the{" "}
            <button type="button" className="underline" onClick={() => setLegal("privacy")}>privacy policy</button>.<Req />
          </Label>
        </div>
        <Err k="acceptedTerms" />
      </div>

      <Button type="submit" disabled={busy} className="w-full sm:w-auto">
        {busy ? "Creating your draft…" : <>Create draft and continue <ArrowRight className="ml-2 h-4 w-4" /></>}
      </Button>
    </form>
    <LegalDialog kind={legal} onOpenChange={(o) => !o && setLegal(null)} onSwitch={setLegal} onAgree={() => { update("acceptedTerms", true); setLegal(null); }} />
    </>
  );
}
