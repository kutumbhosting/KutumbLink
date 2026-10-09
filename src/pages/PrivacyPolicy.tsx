import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { Card, CardContent } from "@/components/ui/card";
import {
  ShieldCheck,
  Lock,
  Database,
  UserCheck,
  Share2,
  Cookie,
  Baby,
  FileEdit,
  Mail,
} from "lucide-react";

const lastUpdated = "28 July 2026";

const sections = [
  {
    icon: Database,
    title: "1. Information We Collect",
    body: (
      <>
        <p className="mb-3">
          When you interact with Kutumb Australia — including through our membership
          form, event registration forms, donation forms, or contact form — we may
          collect the following personal information:
        </p>
        <ul className="list-disc pl-6 space-y-1 text-muted-foreground">
          <li>Full name and contact details (email address, phone number, postal address)</li>
          <li>Membership details, such as membership category and membership number</li>
          <li>Event registration details, including number of attendees, children accompanying you, and any comments or special requirements you provide</li>
          <li>Payment or donation records where you choose to donate or pay for an event (we do not store full card numbers — these are processed by our payment provider)</li>
          <li>Communications you send us, such as messages through our Contact page</li>
          <li>Limited technical information (such as browser type and general usage data) collected automatically when you use our website</li>
        </ul>
      </>
    ),
  },
  {
    icon: UserCheck,
    title: "2. How We Use Your Information",
    body: (
      <>
        <p className="mb-3">We use the personal information we collect to:</p>
        <ul className="list-disc pl-6 space-y-1 text-muted-foreground">
          <li>Process and manage your membership with Kutumb Australia</li>
          <li>Register you and any accompanying guests for events, and manage attendance and catering numbers</li>
          <li>Communicate with you about membership, events, activities, and community news</li>
          <li>Issue receipts for donations and maintain records for accounting and compliance purposes</li>
          <li>Respond to enquiries submitted through our Contact page</li>
          <li>Improve our website, programs, and services</li>
          <li>Meet legal, regulatory, or reporting obligations</li>
        </ul>
        <p className="mt-3">
          We do not use your personal information for automated decision-making that
          produces legal or similarly significant effects on you.
        </p>
      </>
    ),
  },
  {
    icon: Lock,
    title: "3. How We Store and Protect Your Data",
    body: (
      <>
        <p className="mb-3">
          We take reasonable technical and organisational steps to protect the personal
          information we hold from misuse, interference, loss, unauthorised access,
          modification, or disclosure. These steps include:
        </p>
        <ul className="list-disc pl-6 space-y-1 text-muted-foreground">
          <li>Restricting access to membership and event data to authorised committee members and administrators only</li>
          <li>Storing data on secured servers and password-protected systems</li>
          <li>Using encrypted connections (HTTPS) for data submitted through our website</li>
          <li>Regularly reviewing who has access to our administration systems</li>
          <li>Requiring any third-party service providers we use to maintain appropriate security standards</li>
        </ul>
        <p className="mt-3">
          While we take reasonable steps to protect your data, no method of electronic
          storage or transmission is 100% secure. If we become aware of a data breach
          that is likely to result in serious harm, we will take steps in line with the
          Notifiable Data Breaches scheme under the Privacy Act 1988 (Cth), including
          notifying affected individuals and the Office of the Australian Information
          Commissioner (OAIC) where required.
        </p>
      </>
    ),
  },
  {
    icon: Share2,
    title: "4. Disclosure of Your Information",
    body: (
      <>
        <p className="mb-3">
          Kutumb Australia does not sell or rent your personal information. We may
          share limited information with:
        </p>
        <ul className="list-disc pl-6 space-y-1 text-muted-foreground">
          <li>Committee members and volunteers who need it to organise events or manage membership</li>
          <li>Trusted service providers who help us operate our website, email, or payment processing, and who are required to protect your information</li>
          <li>Event venues or partner organisations, but only where necessary (for example, providing final attendee numbers), and only the minimum information required</li>
          <li>Government agencies or authorities where we are required to do so by law</li>
        </ul>
      </>
    ),
  },
  {
    icon: FileEdit,
    title: "5. Data Retention",
    body: (
      <p className="text-muted-foreground">
        We retain personal information only for as long as it is needed for the
        purposes described in this policy, or as required by law (for example,
        financial records relating to donations). Membership and event registration
        records are periodically reviewed, and information that is no longer required
        is securely deleted or de-identified.
      </p>
    ),
  },
  {
    icon: ShieldCheck,
    title: "6. Your Rights and Choices",
    body: (
      <>
        <p className="mb-3">
          Under the Australian Privacy Principles, you have the right to:
        </p>
        <ul className="list-disc pl-6 space-y-1 text-muted-foreground">
          <li>Ask what personal information we hold about you and request a copy of it</li>
          <li>Ask us to correct any information that is inaccurate, out of date, or incomplete</li>
          <li>Withdraw your membership or ask us to stop sending you communications at any time</li>
          <li>Ask us to delete your personal information, subject to any legal or record-keeping obligations</li>
          <li>Lodge a complaint if you believe we have mishandled your personal information</li>
        </ul>
        <p className="mt-3">
          To exercise any of these rights, please contact us using the details at the
          end of this page. We will respond within a reasonable time.
        </p>
      </>
    ),
  },
  {
    icon: Cookie,
    title: "7. Cookies and Website Analytics",
    body: (
      <p className="text-muted-foreground">
        Our website may use cookies or similar technologies to remember your
        preferences and understand how visitors use our site. You can control or
        disable cookies through your browser settings; doing so may affect some
        website functionality.
      </p>
    ),
  },
  {
    icon: Baby,
    title: "8. Children's Information",
    body: (
      <p className="text-muted-foreground">
        Where an event registration includes children accompanying a parent or
        guardian, we only collect the minimum information necessary (such as number
        and age range of children) for planning and safety purposes. We do not
        knowingly collect personal information directly from children without the
        involvement of a parent or guardian.
      </p>
    ),
  },
];

const PrivacyPolicy = () => {
  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />

      <main className="flex-grow">
        {/* Hero */}
        <section className="gradient-warm text-white py-20">
          <div className="container mx-auto px-4 text-center">
            <h1 className="mb-6">Privacy &amp; Data Security Policy</h1>
            <p className="text-xl max-w-3xl mx-auto opacity-95">
              How Kutumb Australia collects, uses, stores, and protects your personal
              information.
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
                    Kutumb Australia ("Kutumb", "we", "us", "our") is committed to
                    protecting the privacy and security of personal information
                    provided by our members, event registrants, donors, and website
                    visitors. This policy explains what personal information we
                    collect through our membership form, event registration forms, and
                    website, how we use and protect it, and the choices and rights
                    available to you. This policy applies together with the Australian
                    Privacy Principles (APPs) contained in the Privacy Act 1988 (Cth).
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

              {/* Changes to policy */}
              <Card className="border-2 mt-8">
                <CardContent className="p-8">
                  <h2 className="text-xl md:text-2xl font-bold mb-4">
                    9. Changes to This Policy
                  </h2>
                  <p className="text-muted-foreground">
                    We may update this policy from time to time to reflect changes in
                    our practices or legal requirements. The updated version will be
                    posted on this page with a revised "last updated" date. We
                    encourage you to review this page periodically.
                  </p>
                </CardContent>
              </Card>

              {/* Contact */}
              <Card className="gradient-warm text-white border-2 mt-8">
                <CardContent className="p-8 text-center">
                  <Mail className="w-10 h-10 mx-auto mb-4" />
                  <h3 className="text-2xl font-bold mb-3">
                    Questions About Your Data?
                  </h3>
                  <p className="mb-2 opacity-95">
                    If you have any questions, or wish to access, correct, or delete
                    your personal information, please contact our Privacy Officer:
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

export default PrivacyPolicy;
