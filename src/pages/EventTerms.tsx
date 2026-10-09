import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { Card, CardContent } from "@/components/ui/card";
import {
  Ticket,
  RefreshCcw,
  ShieldAlert,
  HeartPulse,
  Camera,
  Gavel,
  CloudLightning,
  ScrollText,
  Users,
  Mail,
} from "lucide-react";

const lastUpdated = "28 July 2026";

const sections = [
  {
    icon: ScrollText,
    title: "1. Acceptance of These Terms",
    body: (
      <p className="text-muted-foreground">
        These Event Terms, Client Safety &amp; Liability Terms ("Event Terms") apply
        whenever you register for, attend, or participate in any event, activity, or
        gathering organised, hosted, or promoted by Kutumb Australia ("Kutumb", "we",
        "us", "our"), whether the event is free or paid, in person or online. By
        submitting an event registration form or attending an event, you (the
        "Attendee", "Registrant", or "you") agree to be bound by these Event Terms, in
        addition to our general Privacy &amp; Data Security Policy.
      </p>
    ),
  },
  {
    icon: Ticket,
    title: "2. Event Registration & Eligibility",
    body: (
      <ul className="list-disc pl-6 space-y-1 text-muted-foreground">
        <li>Registration for an event is only confirmed once you receive a confirmation from Kutumb (by email or on-screen confirmation).</li>
        <li>You must provide accurate and current information when registering, including the correct number of adults and children attending.</li>
        <li>Some events may have limited capacity, age restrictions, membership requirements, or eligibility criteria, which will be stated on the event listing.</li>
        <li>Kutumb reserves the right to decline or cancel a registration where information provided is inaccurate, incomplete, or where capacity has been reached.</li>
        <li>Where a registrant is under 18, a parent or legal guardian must complete the registration and remains responsible for that attendee throughout the event.</li>
      </ul>
    ),
  },
  {
    icon: RefreshCcw,
    title: "3. Cancellations, Changes & Refunds",
    body: (
      <>
        <ul className="list-disc pl-6 space-y-1 text-muted-foreground">
          <li>Kutumb may change the date, time, venue, or format of an event, or cancel an event, where necessary (including due to low registration, venue unavailability, safety concerns, or circumstances beyond our control). We will make reasonable efforts to notify registered attendees of any change or cancellation.</li>
          <li>Where an event you have paid for is cancelled by Kutumb, you will generally be offered a refund or credit towards a future event, unless stated otherwise on the event listing.</li>
          <li>If you wish to cancel your own registration, please notify us as soon as possible. Refunds for attendee-initiated cancellations, where applicable, are at Kutumb's discretion and may depend on notice given and any costs already incurred (such as catering or venue commitments).</li>
          <li>Donations made in connection with an event are non-refundable except where required by law.</li>
        </ul>
      </>
    ),
  },
  {
    icon: Users,
    title: "4. Code of Conduct",
    body: (
      <>
        <p className="mb-3">
          To keep our events safe, welcoming, and enjoyable for everyone, all
          attendees agree to:
        </p>
        <ul className="list-disc pl-6 space-y-1 text-muted-foreground">
          <li>Treat other attendees, volunteers, staff, and venue personnel with courtesy and respect</li>
          <li>Follow the reasonable instructions of Kutumb organisers, volunteers, and venue staff, including any safety directions</li>
          <li>Refrain from harassment, discrimination, violent, abusive, or disorderly behaviour</li>
          <li>Supervise any children or dependants brought to the event at all times</li>
        </ul>
        <p className="mt-3 text-muted-foreground">
          Kutumb reserves the right to remove any attendee from an event, without
          refund, whose conduct is considered to endanger, harass, or seriously
          disrupt other attendees, volunteers, or the event itself.
        </p>
      </>
    ),
  },
  {
    icon: HeartPulse,
    title: "5. Health, Safety & Special Requirements",
    body: (
      <ul className="list-disc pl-6 space-y-1 text-muted-foreground">
        <li>Attendees are responsible for informing Kutumb, at the time of registration or as soon as reasonably possible, of any medical conditions, allergies, dietary requirements, or accessibility needs relevant to their safe participation.</li>
        <li>Kutumb will take reasonable steps to accommodate disclosed needs, but cannot guarantee that every requirement can be met at every venue.</li>
        <li>Attendees participate in activities (including physical, outdoor, or group activities) at their own discretion and should not take part in any activity they believe may be unsafe for them.</li>
        <li>Parents or guardians are responsible for the health, safety, and behaviour of any children they bring to an event.</li>
      </ul>
    ),
  },
  {
    icon: ShieldAlert,
    title: "6. Assumption of Risk & Limitation of Liability",
    body: (
      <>
        <p className="mb-3 text-muted-foreground">
          Attendance at any Kutumb event is voluntary. To the maximum extent permitted
          by law:
        </p>
        <ul className="list-disc pl-6 space-y-1 text-muted-foreground">
          <li>Attendees acknowledge that community, cultural, and social events may involve inherent risks (including risks of personal injury, illness, or loss of or damage to property), and voluntarily assume those risks by attending.</li>
          <li>Kutumb, its committee members, volunteers, and organisers will not be liable for any injury, loss, damage, or expense arising from your attendance or participation at an event, except to the extent such liability arises from our negligence and cannot be excluded by law (including under the Australian Consumer Law).</li>
          <li>Kutumb is not liable for the acts, omissions, goods, or services of third parties, including venues, caterers, performers, or other suppliers engaged in connection with an event.</li>
          <li>Nothing in these Event Terms excludes, restricts, or modifies any consumer guarantee, right, or remedy that cannot lawfully be excluded, restricted, or modified.</li>
        </ul>
      </>
    ),
  },
  {
    icon: Camera,
    title: "7. Photography, Media & Publicity",
    body: (
      <p className="text-muted-foreground">
        Kutumb events may be photographed or filmed for use in newsletters, our
        website, social media, and promotional materials. By attending, you consent
        to being photographed or filmed in the general course of the event, unless
        you notify our organisers in writing before the event that you do not wish to
        be included, in which case we will take reasonable steps to accommodate your
        request. If you have concerns about a specific photo or video that includes
        you, please contact us and we will consider your request to remove it.
      </p>
    ),
  },
  {
    icon: CloudLightning,
    title: "8. Force Majeure",
    body: (
      <p className="text-muted-foreground">
        Kutumb will not be liable for any failure or delay in performing its
        obligations relating to an event where such failure or delay results from
        circumstances beyond its reasonable control, including extreme weather,
        natural disaster, public health orders, venue closure, government
        restrictions, industrial action, or other similar events.
      </p>
    ),
  },
  {
    icon: Gavel,
    title: "9. Indemnity & Governing Law",
    body: (
      <>
        <p className="mb-3 text-muted-foreground">
          To the extent permitted by law, you agree to indemnify Kutumb Australia,
          its committee members, volunteers, and organisers against any loss, claim,
          or liability arising from your breach of these Event Terms or your
          wrongful act or omission at an event, except to the extent caused by
          Kutumb's own negligence.
        </p>
        <p className="text-muted-foreground">
          These Event Terms are governed by the laws of New South Wales, Australia,
          and the parties submit to the non-exclusive jurisdiction of its courts.
        </p>
      </>
    ),
  },
];

const EventTerms = () => {
  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />

      <main className="flex-grow">
        {/* Hero */}
        <section className="gradient-warm text-white py-20">
          <div className="container mx-auto px-4 text-center">
            <h1 className="mb-6">Event Terms, Client Safety &amp; Liability</h1>
            <p className="text-xl max-w-3xl mx-auto opacity-95">
              The terms that apply when you register for or attend a Kutumb Australia
              event.
            </p>
            <p className="mt-4 text-sm opacity-80">Last updated: {lastUpdated}</p>
          </div>
        </section>

        {/* Intro */}
        <section className="py-16">
          <div className="container mx-auto px-4">
            <div className="max-w-4xl mx-auto">
              <Card className="border-2 mb-12">
                <CardContent className="p-8">
                  <p className="text-muted-foreground">
                    Kutumb Australia organises community, cultural, and social events
                    for the benefit of our members and the wider community. These
                    Event Terms set out the responsibilities of Kutumb and of
                    attendees, including registration, cancellations, conduct, health
                    and safety, and liability, so that everyone can enjoy our events
                    with clear expectations. Please read these terms carefully before
                    registering for any event.
                  </p>
                </CardContent>
              </Card>

              <div className="space-y-8">
                {sections.map((section, index) => {
                  const Icon = section.icon;
                  return (
                    <Card key={index} className="border-2 card-hover">
                      <CardContent className="p-8">
                        <div className="flex items-start gap-4 mb-4">
                          <div className="w-12 h-12 bg-gradient-hero rounded-full flex items-center justify-center flex-shrink-0">
                            <Icon className="w-6 h-6 text-white" />
                          </div>
                          <h2 className="text-xl md:text-2xl font-bold pt-2">
                            {section.title}
                          </h2>
                        </div>
                        <div>{section.body}</div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>

              {/* Changes */}
              <Card className="border-2 mt-8">
                <CardContent className="p-8">
                  <h2 className="text-xl md:text-2xl font-bold mb-4">
                    10. Changes to These Terms
                  </h2>
                  <p className="text-muted-foreground">
                    We may update these Event Terms from time to time, for example to
                    reflect new types of events or venue requirements. The version
                    posted on this page at the time of your registration will apply to
                    that event. Continued registration or attendance at events after
                    changes are posted constitutes acceptance of the updated terms.
                  </p>
                </CardContent>
              </Card>

              {/* Contact */}
              <Card className="gradient-warm text-white border-2 mt-8">
                <CardContent className="p-8 text-center">
                  <Mail className="w-10 h-10 mx-auto mb-4" />
                  <h3 className="text-2xl font-bold mb-3">
                    Questions About an Event?
                  </h3>
                  <p className="mb-2 opacity-95">
                    If you have questions about these Event Terms, a specific event,
                    or need to discuss access or safety requirements, please contact
                    us:
                  </p>
                  <p className="font-semibold">info@kutumb.org.au</p>
                  <p className="opacity-90 text-sm mt-1">
                    Kutumb Australia, Sydney, New South Wales, Australia
                  </p>
                </CardContent>
              </Card>
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
};

export default EventTerms;
