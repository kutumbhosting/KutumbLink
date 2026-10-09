import { Link, useNavigate } from "react-router-dom";
import { HeartHandshake } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import CharitySignupForm from "@/components/CharitySignupForm";

export default function CharityJoin() {
  const navigate = useNavigate();
  return (
    <main className="min-h-screen bg-muted/20 px-4 py-10">
      <div className="mx-auto max-w-2xl">
        <Link to="/" className="mb-6 inline-block font-semibold">KutumbLink</Link>
        <Card>
          <CardHeader>
            <div className="mb-2 inline-flex w-fit rounded-xl bg-primary/10 p-3 text-primary"><HeartHandshake /></div>
            <CardTitle className="text-2xl">Start your charity profile</CardTitle>
            <p className="text-sm text-muted-foreground">
              Create a secure organisation workspace. You can save a draft and complete the guided profile at your own pace.
              Fields marked <span className="text-destructive">*</span> are required.
            </p>
          </CardHeader>
          <CardContent>
            <CharitySignupForm onSuccess={() => navigate("/Admin", { replace: true })} />
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
