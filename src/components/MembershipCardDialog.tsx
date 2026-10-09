import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Download, Mail, MessageCircle } from "lucide-react";

// Kutumb's community WhatsApp group — shown after a fresh membership
// signup (not on the "membership on file" card shown mid-event-registration,
// since that person already has a chance to join at signup time).
const WHATSAPP_GROUP_INVITE = "https://chat.whatsapp.com/Etit0vlcVj18n3WNvrcEFR?s=cl&p=i&ilr=4";

export interface MembershipCardData {
  membershipNumber: string;
  qrCode: string; // base64 data URL
  name: string;
  email: string;
  phone: string;
  eventName?: string;
  eventDate?: string;
}

interface MembershipCardDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  card: MembershipCardData | null;
  /** Optional CTA (e.g. "Continue to Event Registration") shown above the other actions. */
  onContinue?: () => void;
  continueLabel?: string;
}

const MembershipCardDialog = ({
  open,
  onOpenChange,
  card,
  onContinue,
  continueLabel,
}: MembershipCardDialogProps) => {
  if (!card) return null;

  const cardPdfUrl = `/api/members/${card.membershipNumber}/card.pdf`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {card.eventName ? "Registration Confirmed" : "Welcome to Kutumb!"}
          </DialogTitle>
          <DialogDescription>
            {card.eventName
              ? `You're registered for ${card.eventName}${card.eventDate ? ` — ${card.eventDate}` : ""}.`
              : "Your membership card is ready."}
          </DialogDescription>
        </DialogHeader>

        {/* Card visual */}
        <div className="relative border-2 rounded-xl p-5 bg-gradient-to-br from-orange-50 to-white">
          {/* QR code - top right corner */}
          <img
            src={card.qrCode}
            alt="Membership QR code"
            className="absolute top-4 right-4 w-20 h-20 rounded"
          />

          <p className="mb-2 pr-24 text-lg font-bold tracking-tight text-primary">KutumbLink</p>
          <p className="text-xs uppercase tracking-wide text-primary font-semibold mb-1">
            {card.eventName ? "Membership on file" : "Membership Card"}
          </p>
          <p className="text-lg font-bold mb-3 pr-24">
            No: {card.membershipNumber}
          </p>

          <div className="space-y-1 text-sm pr-24">
            <p>
              <span className="font-medium">Name:</span> {card.name}
            </p>
            <p>
              <span className="font-medium">Email:</span> {card.email}
            </p>
            <p>
              <span className="font-medium">Phone:</span> {card.phone}
            </p>
          </div>
        </div>

        <DialogFooter className="pt-2 flex-col items-stretch gap-2 sm:flex-col">
          {onContinue && (
            <Button className="w-full btn-hero" onClick={onContinue}>
              {continueLabel || "Continue"}
            </Button>
          )}
          {/* Only shown right after a fresh membership signup, not on the
              "membership on file" card shown mid-event-registration. */}
          {!card.eventName && (
            <a href={WHATSAPP_GROUP_INVITE} target="_blank" rel="noopener noreferrer" className="w-full">
              <Button className="w-full bg-[#25D366] hover:bg-[#1ebe5b] text-white">
                <MessageCircle className="w-4 h-4 mr-2" />
                Join the Kutumb WhatsApp Group
              </Button>
            </a>
          )}
          <a href={cardPdfUrl} target="_blank" rel="noopener noreferrer" className="w-full">
            <Button variant="outline" className="w-full">
              <Download className="w-4 h-4 mr-2" />
              Download PDF Card
            </Button>
          </a>
          <p className="text-xs text-muted-foreground text-center flex items-center justify-center gap-1.5">
            <Mail className="w-3.5 h-3.5 shrink-0" />
            A copy of this card has also been emailed to {card.email}
          </p>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default MembershipCardDialog;
