import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import LegalDocument from "@/components/LegalDocument";
import { LEGAL_DOCS } from "@/lib/legalContent";
import type { LegalKind } from "@/lib/legalContent";

type Props = {
  kind: LegalKind | null;
  onOpenChange: (open: boolean) => void;
  onSwitch: (kind: LegalKind) => void;
  onAgree?: () => void;
};

/** Shows the Terms of use / Privacy policy in a popup (used during sign-up). */
export default function LegalDialog({ kind, onOpenChange, onSwitch, onAgree }: Props) {
  const doc = kind ? LEGAL_DOCS[kind] : null;
  const other: LegalKind = kind === "terms" ? "privacy" : "terms";
  return (
    <Dialog open={!!kind} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] max-w-2xl flex-col gap-0 p-0">
        <DialogHeader className="border-b px-6 py-4 text-left">
          <DialogTitle>{doc?.title}</DialogTitle>
          <DialogDescription>Please read before creating your KutumbLink account.</DialogDescription>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto px-6 py-4">{doc && <LegalDocument doc={doc} showTitle={false} />}</div>
        <DialogFooter className="gap-2 border-t px-6 py-4 sm:justify-between">
          <Button type="button" variant="ghost" onClick={() => onSwitch(other)}>
            Read {LEGAL_DOCS[other].title.toLowerCase()}
          </Button>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
            {onAgree && <Button type="button" onClick={onAgree}>I agree</Button>}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
