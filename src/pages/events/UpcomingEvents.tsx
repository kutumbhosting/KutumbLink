import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { TabsContent } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Calendar, MapPin, Users, Clock, Sparkles } from "lucide-react";

// Fixed set of options for "How did you hear about this event?" — shared
// between the dropdown here and the reset/draft-restore defaults below.
export const HEARD_ABOUT_OPTIONS = [
  "Kutumb WhatsApp communication",
  "Kutumb Yoga Group",
  "Kutumb Facebook",
  "Kutumb Instagram",
  "Other",
] as const;

// Key used to stash the in-progress registration form while the registrant
// pops over to the Membership page, so we can restore it on return.
export const EVENT_REGISTRATION_DRAFT_KEY = "kutumb_event_registration_draft";

interface FormData {
  eventName: string;
  eventDate: string;
  name: string;
  email: string;
  phone: string;
  comments: string;
  heardAboutSource: string;
  heardAboutOther: string;
  adults: number;
  children: number;
  childrenUnder5: number;
  children5Plus: number;
  adultNames: string[];
  childrenUnder5Names: string[];
  children5PlusNames: string[];
}

// Resizes a names array to match a new count, keeping any names already
// typed in and padding new slots with "" — used every time an adult/child
// count field changes, so the name inputs rendered below always match.
const resizeNames = (names: string[], count: number): string[] => {
  const next = names.slice(0, count);
  while (next.length < count) next.push("");
  return next;
};

interface UpcomingEventsProps {
  upcomingEvents: any[];
  formData: FormData;
  setFormData: React.Dispatch<React.SetStateAction<FormData>>;
  submitMessage: string;
  handleSubmit: (e: React.FormEvent) => Promise<void>;
  /** True from the moment "Continue to Payment"/"Submit Registration" is
   *  clicked until the request resolves — lets the button react instantly
   *  instead of sitting there looking unclicked while the server round-trip
   *  (membership lookup + fee calc) is in flight. */
  submitting?: boolean;
  /** Controls the "Register for This Event" popup, lifted up to Events.tsx
      so it can also be opened from "Register Now" links elsewhere on the
      site and reopened automatically after returning from Membership. */
  registrationOpen: boolean;
  setRegistrationOpen: (open: boolean) => void;
}

const UpcomingEvents = ({
  upcomingEvents,
  formData,
  setFormData,
  submitMessage,
  handleSubmit,
  submitting = false,
  registrationOpen,
  setRegistrationOpen,
}: UpcomingEventsProps) => {
  const navigate = useNavigate();

  // ── Live membership lookup as the registrant fills in name + email ───────
  const [membershipNumber, setMembershipNumber] = useState<string | null>(null);
  const [checkingMembership, setCheckingMembership] = useState(false);

  useEffect(() => {
    const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email);
    if (!formData.name.trim() || !emailValid) {
      setMembershipNumber(null);
      return;
    }

    const timer = setTimeout(async () => {
      setCheckingMembership(true);
      try {
        const res = await fetch(
          `/api/members/lookup?name=${encodeURIComponent(formData.name)}&email=${encodeURIComponent(formData.email)}`
        );
        const data = await res.json();
        setMembershipNumber(data.found ? data.membershipNumber : null);
      } catch {
        setMembershipNumber(null);
      } finally {
        setCheckingMembership(false);
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [formData.name, formData.email]);

  // ── Applicable fee for the currently selected event ───────────────────────
  const selectedEvent = (Array.isArray(upcomingEvents) ? upcomingEvents : []).find(
    (e) => e.title === formData.eventName
  );
  const isMember = !!membershipNumber;
  const perPersonFee = selectedEvent
    ? Number(isMember ? selectedEvent.memberFee : selectedEvent.nonMemberFee) || 0
    : null;
  const under5Free = selectedEvent ? selectedEvent.under5Free !== false : true;
  const childFee = selectedEvent
    ? Number(
        isMember
          ? selectedEvent.childMemberFee ?? selectedEvent.memberFee
          : selectedEvent.childNonMemberFee ?? selectedEvent.nonMemberFee
      ) || 0
    : null;
  const childrenUnder5 = Number(formData.childrenUnder5) || 0;
  const children5Plus = Number(formData.children5Plus) || 0;
  const totalAttendees = 1 + (Number(formData.adults) || 0) + childrenUnder5 + children5Plus;
  const chargeableChildren = under5Free ? children5Plus : childrenUnder5 + children5Plus;
  const totalFee =
    perPersonFee !== null
      ? perPersonFee * (1 + (Number(formData.adults) || 0)) + (childFee || 0) * chargeableChildren
      : null;

  // ── Member pricing preview, shown to non-members to encourage sign-up ────
  const memberPerPersonFee = selectedEvent ? Number(selectedEvent.memberFee) || 0 : null;
  const memberChildFee = selectedEvent ? Number(selectedEvent.childMemberFee ?? selectedEvent.memberFee) || 0 : null;
  const memberTotalFee =
    memberPerPersonFee !== null
      ? memberPerPersonFee * (1 + (Number(formData.adults) || 0)) + (memberChildFee || 0) * chargeableChildren
      : null;
  const memberSavesMoney =
    !isMember &&
    memberPerPersonFee !== null &&
    perPersonFee !== null &&
    memberPerPersonFee < perPersonFee;

  // ── Send the registrant to the Membership page, preserving this form ─────
  const handleBecomeMember = () => {
    try {
      sessionStorage.setItem(EVENT_REGISTRATION_DRAFT_KEY, JSON.stringify(formData));
    } catch {
      // sessionStorage unavailable — worst case the form just won't restore
    }

    navigate("/membership", {
      state: {
        scrollTo: "membership",
        returnTo: "/events",
        prefill: {
          name: formData.name,
          email: formData.email,
          phone: formData.phone,
        },
      },
    });
  };

  const activeEvents = (Array.isArray(upcomingEvents) ? upcomingEvents : []).filter(
    (event) => event.isActive
  );

  return (
    <TabsContent value="upcoming" className="space-y-12">
      <div
        className={
          activeEvents.length === 1
            ? "max-w-xl mx-auto"
            : "grid md:grid-cols-2 gap-8"
        }
      >
        {activeEvents
          .map((event, index) => {
            const hasFlyer = !!event.flyerImage;

            return (
              <Card key={index} className="card-hover border border-border">
                <CardContent className="p-6">
                  <div className={`grid gap-6 ${hasFlyer ? "md:grid-cols-2" : ""}`}>

                    {/* LEFT */}
                    <div>
                      <h3 className="text-xl font-bold mb-4">{event.title}</h3>

                      <div className="space-y-3 mb-6">
                        <div className="flex items-center gap-2 text-muted-foreground">
                          <Calendar size={18} className="text-primary" />
                          <span>{event.date}</span>
                        </div>

                        <div className="flex items-center gap-2 text-muted-foreground">
                          <Clock size={18} className="text-primary" />
                          <span>{event.time}</span>
                        </div>

                        <div className="flex items-center gap-2 text-muted-foreground">
                          <MapPin size={18} className="text-primary" />
                          <span>{event.location}</span>
                        </div>

                        <div className="flex items-center gap-2 text-muted-foreground">
                          <Users size={18} className="text-primary" />
                          <span> {event.availableSpots} / {event.capacity} spots available</span>
                        </div>
                      </div>

                      <p className="text-muted-foreground">
                        {event.description}
                      </p>
                    </div>

                    {/* RIGHT (IMAGE) */}
                    {hasFlyer && (
                      <div className="flex justify-center items-start">
                        <img
                          src={`/api/media/${event.flyerImage}`}
                          alt={event.title}
                          className="rounded-lg shadow-md max-h-[350px] object-contain"
                        />
                      </div>
                    )}

                    {/* ✅ BUTTON → FULL WIDTH (SPANS BOTH COLUMNS) */}
                    <div className={hasFlyer ? "md:col-span-2" : ""}>
                      <Button
                        className="w-full btn-hero mt-4"
                        onClick={() => {
                          setFormData({
                            eventName: event.title,
                            eventDate: event.date,
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
                          setRegistrationOpen(true);
                        }}
                      >
                        Register for This Event
                      </Button>
                    </div>

                  </div>
                </CardContent>
              </Card>
            );
          })}
      </div>

      <Dialog open={registrationOpen} onOpenChange={setRegistrationOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle asChild>
              <h2 className="text-center text-[#0a1f5c] text-[2.109375rem] md:text-[2.53125rem]">Event Registration</h2>
            </DialogTitle>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-6">
              <div>
                <Label htmlFor="event">Event Name *</Label>
                <Input
                  id="event"
                  value={formData.eventName}
                  placeholder="Enter event name"
                  readOnly
                  disabled
                  className="mt-2 bg-muted disabled:opacity-100 disabled:cursor-not-allowed"
                />
              </div>

              <div>
                <Label htmlFor="date">Event Date *</Label>
                <Input
                  id="date"
                  value={formData.eventDate}
                  placeholder="Enter event date"
                  readOnly
                  disabled
                  className="mt-2 bg-muted disabled:opacity-100 disabled:cursor-not-allowed"
                />
              </div>

              <div>
                <Label htmlFor="name">Full Name *</Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) =>
                    setFormData({ ...formData, name: e.target.value })
                  }
                  placeholder="Enter your full name"
                  className="mt-2"
                />
              </div>

              <div>
                <Label htmlFor="email">Email Address *</Label>
                <Input
                  id="email"
                  type="email"
                  value={formData.email}
                  onChange={(e) =>
                    setFormData({ ...formData, email: e.target.value })
                  }
                  placeholder="your.email@example.com"
                  className="mt-2"
                />
              </div>

              <div>
                <Label htmlFor="phone">Phone Number *</Label>
                <Input
                  id="phone"
                  type="tel"
                  value={formData.phone}
                  onChange={(e) =>
                    setFormData({ ...formData, phone: e.target.value })
                  }
                  placeholder="+61 XXX XXX XXX"
                  className="mt-2"
                />
              </div>

              {/* Live membership lookup */}
              <div className="rounded-lg bg-muted/50 px-4 py-3 text-sm">
                {checkingMembership ? (
                  <span className="text-muted-foreground">Checking membership…</span>
                ) : membershipNumber ? (
                  <span>
                    Kutumb Membership Number: <strong>{membershipNumber}</strong>
                  </span>
                ) : (
                  <span className="text-muted-foreground">
                    Enter your name and email above to check your Kutumb membership status.
                  </span>
                )}
              </div>

              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="adults">No of Adults (including you) *</Label>
                  <Input
                    id="adults"
                    type="number"
                    min="1"
                    value={Number(formData.adults) + 1}
                    onChange={(e) => {
                      // Shown/entered value includes the registrant; stored
                      // `adults` stays "additional adults beyond the
                      // registrant" so fee calculations and ticket
                      // generation elsewhere don't need to change.
                      const totalIncludingYou = Math.max(1, Number(e.target.value) || 1);
                      const additionalAdults = totalIncludingYou - 1;
                      setFormData({
                        ...formData,
                        adults: additionalAdults,
                        adultNames: resizeNames(formData.adultNames, additionalAdults),
                      });
                    }}
                    className="mt-2"
                  />
                </div>

                <div>
                  <Label htmlFor="children5plus">Children (5 and over)</Label>
                  <Input
                    id="children5plus"
                    type="number"
                    min="0"
                    value={formData.children5Plus}
                    onChange={(e) => {
                      const count = Math.max(0, Number(e.target.value) || 0);
                      setFormData({
                        ...formData,
                        children5Plus: count,
                        children: count + (Number(formData.childrenUnder5) || 0),
                        children5PlusNames: resizeNames(formData.children5PlusNames, count),
                      });
                    }}
                    className="mt-2"
                  />
                </div>
              </div>

              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="childrenunder5">
                    Children Under 5{selectedEvent && under5Free ? " (Free)" : ""}
                  </Label>
                  <Input
                    id="childrenunder5"
                    type="number"
                    min="0"
                    value={formData.childrenUnder5}
                    onChange={(e) => {
                      const count = Math.max(0, Number(e.target.value) || 0);
                      setFormData({
                        ...formData,
                        childrenUnder5: count,
                        children: count + (Number(formData.children5Plus) || 0),
                        childrenUnder5Names: resizeNames(formData.childrenUnder5Names, count),
                      });
                    }}
                    className="mt-2"
                  />
                </div>
              </div>

              {/* Names of each additional adult / child, so tickets can be
                  issued in each individual's own name. Only shown once the
                  relevant count is above zero. */}
              {Number(formData.adults) > 0 && (
                <div className="space-y-2">
                  <Label>Additional Adult Name{Number(formData.adults) > 1 ? "s" : ""} *</Label>
                  {Array.from({ length: Number(formData.adults) }).map((_, i) => (
                    <Input
                      key={`adult-name-${i}`}
                      placeholder={`Adult ${i + 2} full name`}
                      value={formData.adultNames[i] || ""}
                      onChange={(e) => {
                        const next = [...formData.adultNames];
                        next[i] = e.target.value;
                        setFormData({ ...formData, adultNames: next });
                      }}
                    />
                  ))}
                </div>
              )}

              {Number(formData.children5Plus) > 0 && (
                <div className="space-y-2">
                  <Label>
                    Child Name{Number(formData.children5Plus) > 1 ? "s" : ""} (5 and over) *
                  </Label>
                  {Array.from({ length: Number(formData.children5Plus) }).map((_, i) => (
                    <Input
                      key={`child5plus-name-${i}`}
                      placeholder={`Child ${i + 1} full name`}
                      value={formData.children5PlusNames[i] || ""}
                      onChange={(e) => {
                        const next = [...formData.children5PlusNames];
                        next[i] = e.target.value;
                        setFormData({ ...formData, children5PlusNames: next });
                      }}
                    />
                  ))}
                </div>
              )}

              {Number(formData.childrenUnder5) > 0 && (
                <div className="space-y-2">
                  <Label>
                    Child Name{Number(formData.childrenUnder5) > 1 ? "s" : ""} (Under 5) *
                  </Label>
                  {Array.from({ length: Number(formData.childrenUnder5) }).map((_, i) => (
                    <Input
                      key={`childunder5-name-${i}`}
                      placeholder={`Child ${i + 1} full name`}
                      value={formData.childrenUnder5Names[i] || ""}
                      onChange={(e) => {
                        const next = [...formData.childrenUnder5Names];
                        next[i] = e.target.value;
                        setFormData({ ...formData, childrenUnder5Names: next });
                      }}
                    />
                  ))}
                </div>
              )}

              {/* Total registration fee, based on membership status and attendee count */}
              {selectedEvent && (selectedEvent.memberFee > 0 || selectedEvent.nonMemberFee > 0) && (
                <div className="rounded-lg border-2 border-orange-200 bg-orange-50 px-4 py-3 text-sm space-y-1">
                  <p className="font-semibold text-orange-800">Registration Fee</p>
                  <p>
                    {isMember ? "Member fee" : "Non-member fee"}: <strong>${perPersonFee}</strong> per adult
                    &times; {1 + (Number(formData.adults) || 0)}
                  </p>
                  {(childrenUnder5 > 0 || children5Plus > 0) && (
                    <p>
                      Child fee: <strong>${childFee}</strong> per child &times; {chargeableChildren}{" "}
                      {under5Free && childrenUnder5 > 0 && (
                        <span className="text-muted-foreground">
                          ({childrenUnder5} under-5 {childrenUnder5 === 1 ? "child is" : "children are"} free)
                        </span>
                      )}
                    </p>
                  )}
                  <p className="text-base">
                    Total for {totalAttendees} {totalAttendees === 1 ? "attendee" : "attendees"}:{" "}
                    <strong>{totalFee && totalFee > 0 ? `$${totalFee}` : "Free"}</strong>
                  </p>

                  {!isMember && (
                    <div className="mt-3 pt-3 border-t border-orange-200">
                      <p className="text-orange-700">
                        {memberSavesMoney ? (
                          <>
                            Kutumb members pay just{" "}
                            <strong>${memberPerPersonFee}</strong> per person for this event
                            {memberTotalFee !== null && (
                              <>
                                {" "}
                                — <strong>
                                  {memberTotalFee > 0 ? `$${memberTotalFee}` : "Free"}
                                </strong>{" "}
                                total for {totalAttendees}{" "}
                                {totalAttendees === 1 ? "attendee" : "attendees"}
                              </>
                            )}
                            .
                          </>
                        ) : (
                          <>Kutumb membership is free and unlocks member pricing on future events.</>
                        )}
                      </p>
                      <button
                        type="button"
                        onClick={handleBecomeMember}
                        className="mt-2 inline-flex items-center gap-1.5 text-sm font-semibold text-primary underline underline-offset-2 hover:text-primary/80"
                      >
                        <Sparkles size={14} />
                        Join Kutumb for free {memberSavesMoney ? "to unlock this rate." : "."}
                      </button>
                    </div>
                  )}
                </div>
              )}

              <div>
                <Label htmlFor="heardAboutSource">How did you hear about this event?</Label>
                <Select
                  value={formData.heardAboutSource}
                  onValueChange={(value) =>
                    setFormData({
                      ...formData,
                      heardAboutSource: value,
                      // Clear any previously typed detail when switching
                      // away from "Other" so a stale value can't sneak in.
                      heardAboutOther: value === "Other" ? formData.heardAboutOther : "",
                    })
                  }
                >
                  <SelectTrigger id="heardAboutSource" className="mt-2">
                    <SelectValue placeholder="Select an option" />
                  </SelectTrigger>
                  <SelectContent>
                    {HEARD_ABOUT_OPTIONS.map((option) => (
                      <SelectItem key={option} value={option}>
                        {option}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {formData.heardAboutSource === "Other" && (
                <div>
                  <Label htmlFor="heardAboutOther">Please provide details</Label>
                  <Input
                    id="heardAboutOther"
                    value={formData.heardAboutOther}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        heardAboutOther: e.target.value,
                      })
                    }
                    placeholder="Tell us how you heard about this event"
                    className="mt-2"
                  />
                </div>
              )}

              <div>
                <Label htmlFor="comments">Additional Comments</Label>
                <Textarea
                  id="comments"
                  value={formData.comments}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      comments: e.target.value,
                    })
                  }
                  placeholder="Any special requirements or questions?"
                  className="mt-2 min-h-24"
                />
              </div>

              <Button
                type="submit"
                disabled={submitting}
                className="w-full btn-hero text-lg py-6"
              >
                {submitting
                  ? "Submitting…"
                  : totalFee !== null && totalFee > 0
                  ? "Continue to Payment"
                  : "Submit Registration"}
              </Button>

              {submitMessage && (
                <p
                  className={`mt-4 text-center text-sm ${
                    submitMessage === "Registration successful!"
                      ? "text-green-600"
                      : submitMessage.startsWith("Registration received")
                      ? "text-orange-600"
                      : "text-red-600"
                  }`}
                >
                  {submitMessage}
                </p>
              )}
            </form>
        </DialogContent>
      </Dialog>
    </TabsContent>
  );
};

export default UpcomingEvents;

