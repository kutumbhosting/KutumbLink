import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { useState } from "react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import UpcomingEvents, {
  EVENT_REGISTRATION_DRAFT_KEY,
} from "@/pages/events/UpcomingEvents";
import PastEvents from "@/pages/events/PastEvents";
import DonateDialog from "@/components/DonateDialog";
import EventRegistrationSuccessDialog, {
  EventRegistrationSuccessData,
} from "@/components/EventRegistrationSuccessDialog";
import { Button } from "@/components/ui/button";
import { HeartHandshake } from "lucide-react";

const Events = () => {
  const { toast } = useToast();
  const [upcomingEvents, setUpcomingEvents] = useState([]);
  const location = useLocation();
  const [submitMessage, setSubmitMessage] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [donateOpen, setDonateOpen] = useState(false);
  const [registrationOpen, setRegistrationOpen] = useState(false);
  const [successOpen, setSuccessOpen] = useState(false);
  const [successData, setSuccessData] = useState<EventRegistrationSuccessData | null>(null);
  const [formData, setFormData] = useState({
    eventName: "",
    eventDate: "",
    name: "",
    email: "",
    phone: "",
    comments: "",
    heardAboutSource: "",
    heardAboutOther: "",
    adults: 0,
    children: 0,
    childrenUnder5: 0,
    children5Plus: 0,
    // Positionally matched to the counts above — adultNames[0] is the
    // first additional adult's name, and so on. Kept in sync with the
    // counts by UpcomingEvents.tsx as the person changes the numbers.
    adultNames: [] as string[],
    childrenUnder5Names: [] as string[],
    children5PlusNames: [] as string[],
  });

  // ── Shared fetch function used on load and after registration ────────────
  const loadUpcomingEvents = () => {
    fetch("/api/upcoming-events")
      .then((res) => res.json())
      .then((data) => setUpcomingEvents(Array.isArray(data) ? data : []))
      .catch((err) => {
        console.error("Failed to fetch upcoming events:", err);
        setUpcomingEvents([]);
      });
  };

  // ── Initial load ─────────────────────────────────────────────────────────
  useEffect(() => {
    loadUpcomingEvents();
  }, []);

  // ── Open the registration popup when navigating from Home / Activities, ──
  //    or when returning from the Membership page mid-registration ─────────
  useEffect(() => {
    if (location.state?.scrollTo === "registration") {
      if (location.state?.restoreDraft) {
        // Coming back from the Membership page — restore the in-progress
        // registration (name, email, phone, event, headcount, comments)
        // exactly as the registrant left it.
        try {
          const draft = sessionStorage.getItem(EVENT_REGISTRATION_DRAFT_KEY);
          if (draft) {
            const parsed = JSON.parse(draft);
            setFormData((prev) => ({ ...prev, ...parsed }));
          }
        } catch {
          // ignore malformed/unavailable draft
        } finally {
          sessionStorage.removeItem(EVENT_REGISTRATION_DRAFT_KEY);
        }
      } else {
        setFormData((prev) => ({
          ...prev,
          eventName: location.state.eventName || "",
          eventDate: location.state.eventDate || "",
        }));
      }

      setRegistrationOpen(true);
    }
  }, [location.state]);

  // ── Submit handler ────────────────────────────────────────────────────────
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.name || !formData.email || !formData.phone) {
      toast({
        title: "Missing Information",
        description: "Please fill in all required fields.",
        variant: "destructive",
      });
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(formData.email)) {
      toast({
        title: "Invalid Email",
        description: "Please enter a valid email address.",
        variant: "destructive",
      });
      return;
    }

    if (!formData.heardAboutSource) {
      toast({
        title: "Missing Information",
        description: "Please tell us how you heard about this event.",
        variant: "destructive",
      });
      return;
    }

    if (formData.heardAboutSource === "Other" && !formData.heardAboutOther.trim()) {
      toast({
        title: "Missing Information",
        description: "Please provide details for \"Other\".",
        variant: "destructive",
      });
      return;
    }

    // Every additional adult and child gets their own ticket, so each one
    // needs an actual name — a blank slot here would otherwise fall back
    // to a generic "Additional Adult 1" / "Child 1" label on their ticket.
    const missingName =
      formData.adultNames.slice(0, formData.adults).some((n) => !n.trim()) ||
      formData.children5PlusNames.slice(0, formData.children5Plus).some((n) => !n.trim()) ||
      formData.childrenUnder5Names.slice(0, formData.childrenUnder5).some((n) => !n.trim());
    if (missingName) {
      toast({
        title: "Missing Names",
        description: "Please enter a name for every additional adult and child so we can issue their tickets correctly.",
        variant: "destructive",
      });
      return;
    }

    // Give the button an immediate, visible reaction to the click — it was
    // previously indistinguishable from doing nothing while the request
    // (membership lookup + fee calc) was in flight.
    setSubmitting(true);
    try {
      const res = await fetch("/api/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });

      const data = await res.json();

      if (res.status === 409) {
        const description =
          data?.message || "You're already registered for this event — check your email for your confirmation.";
        setSubmitMessage("You are already registered for this event.");
        setTimeout(() => setSubmitMessage(""), 5000);
        // The inline message alone is easy to miss (it renders below the
        // button, off-screen in a scrolled dialog), which is what made
        // this look like the click did nothing. Surface it as a toast too,
        // same as every other outcome here.
        toast({
          title: "Already Registered",
          description,
          variant: "destructive",
        });
        return;
      }

      if (!res.ok) throw new Error(data.message || "Server error");

      // A row now exists server-side, but for a paid event it's only a
      // hold — "pending_payment" — until the person actually pays. Don't
      // tell them the registration is done when it isn't: that's exactly
      // what led to the success dialog (which correctly asks for payment
      // first) being contradicted by a "Registration Successful!" toast
      // that had already popped up moments earlier.
      const feeOwed = typeof data.fee === "number" && data.fee > 0;

      setSubmitMessage(
        feeOwed ? "Registration received — payment required to confirm your spot." : "Registration successful!"
      );
      setTimeout(() => setSubmitMessage(""), 5000);

      toast(
        feeOwed
          ? {
              title: "Payment Required to Confirm",
              description: "We've reserved your spot — complete payment to finish registering.",
            }
          : {
              title: "Registration Successful!",
              description: "We've received your registration.",
            }
      );

      setSuccessData({
        id: data.id,
        eventName: data.eventName || formData.eventName,
        eventDate: data.eventDate || formData.eventDate,
        eventYear: data.eventYear,
        registrationNumber: data.registrationNumber,
        isMember: !!data.isMember,
        membershipNumber: data.membershipNumber,
        adults: data.adults ?? formData.adults,
        children: data.children ?? formData.children,
        fee: data.fee,
        perPersonFee: data.perPersonFee,
        email: data.email || formData.email,
        name: data.name || formData.name,
      });
      setRegistrationOpen(false);
      setSuccessOpen(true);

      // ✅ Refetch so available spots update immediately in the UI
      loadUpcomingEvents();

      // ✅ Reset form
      setFormData({
        eventName: location.state?.eventName || "",
        eventDate: location.state?.eventDate || "",
        name: "",
        email: "",
        phone: "",
        comments: "",
        heardAboutSource: "",
        heardAboutOther: "",
        adults: 0,
        children: 0,
        childrenUnder5: 0,
        children5Plus: 0,
        adultNames: [],
        childrenUnder5Names: [],
        children5PlusNames: [],
      });
    } catch (error: any) {
      console.error("API Error:", error);
      // Show the server's actual reason when we have one (e.g. "that event
      // couldn't be found, please refresh") instead of always blaming the
      // connection — a network failure is only one of several ways this
      // can fail, and the wrong message here just sends people chasing the
      // wrong fix.
      const description =
        error instanceof TypeError
          ? "Couldn't reach the server. Check your connection and try again."
          : error?.message || "Something went wrong. Please try again.";
      setSubmitMessage("Submission failed. Try again.");
      setTimeout(() => setSubmitMessage(""), 5000);
      toast({
        title: "Submission Failed",
        description,
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />

      <main className="flex-grow">
        <section className="gradient-warm text-white py-20">
          <div className="container mx-auto px-4 text-center">
            <h1 className="mb-6">Events</h1>
            <p className="text-xl max-w-3xl mx-auto opacity-95">
              Join us for upcoming community events or explore our past activities and impact.
            </p>
          </div>
        </section>

        <section className="py-20 bg-muted/30">
          <div className="container mx-auto px-4">
            <div className="max-w-7xl mx-auto flex justify-end mb-6">
              <Button
                onClick={() => setDonateOpen(true)}
                className="bg-accent hover:bg-accent/90 text-accent-foreground text-lg"
              >
                <HeartHandshake className="w-4 h-4 mr-2" />
                Donate
              </Button>
            </div>
            <Tabs defaultValue="upcoming" className="max-w-7xl mx-auto">
              <TabsList className="grid w-full max-w-md mx-auto grid-cols-2 mb-12">
                <TabsTrigger value="upcoming" className="text-lg">
                  Upcoming Events
                </TabsTrigger>
                <TabsTrigger value="past" className="text-lg">
                  Past Events
                </TabsTrigger>
              </TabsList>

              <UpcomingEvents
                upcomingEvents={upcomingEvents}
                formData={formData}
                setFormData={setFormData}
                submitMessage={submitMessage}
                handleSubmit={handleSubmit}
                submitting={submitting}
                registrationOpen={registrationOpen}
                setRegistrationOpen={setRegistrationOpen}
              />

              <PastEvents />
            </Tabs>
          </div>
        </section>
      </main>

      <Footer />

      <DonateDialog open={donateOpen} onOpenChange={setDonateOpen} />
      <EventRegistrationSuccessDialog
        open={successOpen}
        onOpenChange={setSuccessOpen}
        data={successData}
      />
    </div>
  );
};

export default Events;
