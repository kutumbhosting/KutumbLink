import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { BookOpen, Download, ExternalLink, RefreshCw, Globe, Copy } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

// Admin → Manuals: read the user manuals right in the console, open them in
// a new tab, or download them. The PDFs are served by /api/manuals from
// <DATA_ROOT>/manuals (server/runtime-data/manuals by default), so an updated manual can be
// uploaded via Data Management → File Management → folder "manuals"
// (keep the same file name to replace one; any other PDF placed there is
// listed here too).

type Manual = {
  id: string;
  file: string;
  title: string;
  description: string;
  audience: string;
  sizeBytes: number;
  updatedAt: string;
  url: string;
  /** Set when anyone can open it without logging in (footer "User Manual"). */
  publicUrl: string | null;
};

const formatSize = (b: number) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.round(b / 1024)} KB`);

const Manuals = () => {
  const { toast } = useToast();
  const copyPublicLink = async (path: string) => {
    const full = `${window.location.origin}${path}`;
    try {
      await navigator.clipboard.writeText(full);
      toast({ title: "Link copied", description: full });
    } catch {
      toast({ title: "Public link", description: full });
    }
  };
  const [manuals, setManuals] = useState<Manual[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [readingId, setReadingId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/manuals", { credentials: "same-origin" });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.message || "Could not load manuals");
      setManuals(data);
      setReadingId((cur) => cur ?? data[0]?.id ?? null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const reading = manuals.find((m) => m.id === readingId) || null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold">User Manuals</h2>
          <p className="text-sm text-muted-foreground">
            Read the guides here, open them in a new tab, or download the PDF to print or share.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className="h-4 w-4 mr-2" /> Refresh
        </Button>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {loading && !manuals.length && <p className="text-sm text-muted-foreground">Loading manuals…</p>}
      {!loading && !error && manuals.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No manuals found. Upload PDF files to the <strong>manuals</strong> folder in Data Management → File Management.
        </p>
      )}

      <div className="grid md:grid-cols-2 gap-4">
        {manuals.map((m) => (
          <Card key={m.id} className={readingId === m.id ? "border-2 border-orange-400" : "border-2"}>
            <CardContent className="p-5 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <h3 className="text-lg font-bold flex items-center gap-2">
                  <BookOpen className="h-5 w-5 text-orange-600 shrink-0" />
                  {m.title}
                </h3>
                {m.audience && <Badge variant="secondary">{m.audience}</Badge>}
              </div>
              {m.description && <p className="text-sm text-muted-foreground">{m.description}</p>}
              {m.publicUrl ? (
                <div className="flex flex-wrap items-center gap-2 text-xs rounded-md bg-green-50 border border-green-200 px-3 py-2">
                  <Globe className="h-4 w-4 text-green-700" />
                  <span className="text-green-900">
                    Public — anyone can open it (footer “User Manual”):{" "}
                    <a href={m.publicUrl} target="_blank" rel="noopener noreferrer" className="underline font-medium">
                      {window.location.host}{m.publicUrl}
                    </a>
                  </span>
                  <Button size="sm" variant="ghost" className="h-6 px-2" onClick={() => copyPublicLink(m.publicUrl!)}>
                    <Copy className="h-3 w-3 mr-1" /> Copy link
                  </Button>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">🔒 Admins only — requires admin login.</p>
              )}
              <p className="text-xs text-muted-foreground">
                PDF · {formatSize(m.sizeBytes)} · updated {new Date(m.updatedAt).toLocaleDateString("en-AU")}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={() => setReadingId(m.id)} variant={readingId === m.id ? "default" : "outline"}>
                  <BookOpen className="h-4 w-4 mr-2" /> {readingId === m.id ? "Reading below" : "Read here"}
                </Button>
                <Button size="sm" variant="outline" asChild>
                  <a href={m.url} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="h-4 w-4 mr-2" /> Open in new tab
                  </a>
                </Button>
                <Button size="sm" variant="outline" asChild>
                  <a href={`${m.url}?download=1`} download={m.file}>
                    <Download className="h-4 w-4 mr-2" /> Download PDF
                  </a>
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {reading && (
        <Card>
          <CardContent className="p-0">
            <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b">
              <span className="font-semibold">{reading.title}</span>
              <span className="text-xs text-muted-foreground">
                Phone or tablet? If the manual doesn't display below, use “Open in new tab” or “Download PDF”.
              </span>
            </div>
            <iframe
              key={reading.id}
              src={`${reading.url}#view=FitH`}
              title={reading.title}
              className="w-full bg-white rounded-b-lg"
              style={{ height: "80vh", minHeight: 500, border: 0 }}
            />
          </CardContent>
        </Card>
      )}

      <p className="text-xs text-muted-foreground">
        To update a manual, upload the new PDF with the same file name to the <strong>manuals</strong> folder in
        Data Management → File Management.
      </p>
    </div>
  );
};

export default Manuals;
