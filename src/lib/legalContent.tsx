import type { ReactNode } from "react";

export type LegalSection = { title: string; body: ReactNode };
export type LegalDoc = { title: string; intro: string; sections: LegalSection[] };

export const LEGAL_UPDATED = "8 October 2026";
export const LEGAL_EMAIL = "support@kutumblink.com.au";

const P = ({ children }: { children: ReactNode }) => <p className="mb-3">{children}</p>;
const UL = ({ items }: { items: ReactNode[] }) => (
  <ul className="mb-3 list-disc space-y-1 pl-6">{items.map((item, i) => <li key={i}>{item}</li>)}</ul>
);

export const TERMS: LegalDoc = {
  title: "Terms of use",
  intro:
    "These terms explain how you can use KutumbLink, the platform where Australian charities and community organisers list events, sell tickets, run fundraisers and accept donations. In plain terms: organisers run their events, supporters take part, and KutumbLink provides the technology in between.",
  sections: [
    {
      title: "1. Who we are and what these terms cover",
      body: (<>
        <P>KutumbLink (“KutumbLink”, “we”, “us”) operates the KutumbLink website and services, including event listings, ticketing, fundraising pages, donations and the organiser console (the “Platform”).</P>
        <P>These terms apply to everyone who uses the Platform: visitors, supporters, ticket buyers, donors, fundraisers and organisers. By creating an account, buying a ticket, donating or otherwise using the Platform, you agree to these terms. If you do not agree, please do not use the Platform.</P>
      </>),
    },
    {
      title: "2. Our role",
      body: (<>
        <P>KutumbLink is a technology platform. Events, campaigns and fundraisers are created and run by independent organisers and charities. Unless we expressly say otherwise, we are not the organiser, host, seller or charity, and the contract for any event, ticket or donation is between you and the organiser.</P>
        <P>Listing a charity or event on KutumbLink does not mean we endorse it. Our platform review checks the identity and basic details of an organisation. It is separate from, and not a substitute for, registration with the ACNC or Deductible Gift Recipient (DGR) status.</P>
      </>),
    },
    {
      title: "3. Accounts",
      body: (<>
        <P>To create an organiser account you must be at least 18, have authority to act for the organisation, and give us accurate information, including your name, email, mobile number, region, state, organisation name, legal name and ABN.</P>
        <UL items={[
          "Keep your password secure. You are responsible for activity on your account.",
          "Tell us straight away if you think your account has been accessed without permission.",
          "Each organisation workspace is separate. Only add team members you trust and give them the lowest role they need.",
          "We may suspend or close accounts that give false information or breach these terms.",
        ]} />
      </>),
    },
    {
      title: "4. Organiser responsibilities",
      body: (<>
        <P>If you list events or campaigns, you promise that:</P>
        <UL items={[
          "your event details, prices, dates and descriptions are accurate and not misleading;",
          "you have the right to hold the event and sell the tickets or accept the donations;",
          "you will comply with Australian law, including consumer law, fundraising and charity laws, privacy law and any required licences, permits and insurance;",
          "you are responsible for the safety of your event, your attendees, volunteers and staff;",
          "you will provide the event as described, or refund buyers if it is cancelled or materially changed;",
          "you will only use attendee and supporter information to run your event and communicate with them lawfully.",
        ]} />
        <P>Organisers must not list illegal, hateful, deceptive or unsafe events, or use the Platform to raise funds for purposes other than those stated.</P>
      </>),
    },
    {
      title: "5. Buying tickets and registering",
      body: (<>
        <P>When you buy a ticket or register, you are buying from the organiser. Prices are shown in Australian dollars and may include booking or payment-processing fees, which are shown before you pay.</P>
        <UL items={[
          "Your confirmation email and ticket are sent to the email address you provide, so please check it carefully.",
          "Tickets may not be resold above face value or used for commercial purposes without the organiser's written permission.",
          "Organisers may set entry conditions, and may refuse entry for safety or conduct reasons.",
        ]} />
      </>),
    },
    {
      title: "6. Refunds and cancellations",
      body: (<>
        <P>Each organiser sets their own refund policy, which is shown on the event page. Your rights under the Australian Consumer Law are not limited by these terms, including the right to a remedy if an event is cancelled or is not provided as described.</P>
        <P>If an event is cancelled, the organiser is responsible for refunds. We will help process approved refunds through the original payment method where we can. Processing fees may not be recoverable unless required by law.</P>
      </>),
    },
    {
      title: "7. Donations and fundraising",
      body: (<>
        <P>Donations are gifts to the organisation named on the page and, unless the page says otherwise, are not refundable. Tax-deductibility depends on the charity's DGR status and your circumstances. A receipt is issued only where the charity is entitled to issue one.</P>
        <P>Fundraisers who create pages on behalf of a charity must be honest about their cause. We may remove or pause pages that look misleading, break the rules or are reported to us.</P>
        <P>Funds raised through the Platform are collected through our payment account and passed on to the relevant organisation after fees, refunds and chargebacks are deducted. Transfers are made on our published settlement schedule and may be delayed for verification or compliance reasons.</P>
      </>),
    },
    {
      title: "8. Fees and payments",
      body: (<>
        <P>Our current fees are shown on the Pricing page and may change with notice. Payments are processed by third-party providers (such as Stripe, PayPal or Square), whose terms also apply. We do not store full card details.</P>
        <P>We may withhold or reverse payments where we reasonably suspect fraud, a breach of these terms, or a chargeback or dispute.</P>
      </>),
    },
    {
      title: "9. Acceptable use",
      body: (<>
        <P>You must not:</P>
        <UL items={[
          "break the law or encourage others to;",
          "post content that is defamatory, harassing, discriminatory, sexually explicit or infringes anyone's rights;",
          "attempt to access other people's accounts or data, or interfere with the security or operation of the Platform;",
          "use bots, scrapers or automated tools to collect data or buy tickets in bulk;",
          "use the Platform to send spam or unsolicited marketing.",
        ]} />
      </>),
    },
    {
      title: "10. Content and intellectual property",
      body: (<>
        <P>The Platform, including its design, software and branding, belongs to KutumbLink. You keep ownership of the content you upload (such as event descriptions and images), and you give us a non-exclusive licence to host, display and promote it on and in connection with the Platform. You confirm you have the rights to do so.</P>
      </>),
    },
    {
      title: "11. Availability and changes",
      body: (<>
        <P>We work to keep the Platform available and secure, but we do not promise it will always be uninterrupted or error-free. We may add, change or remove features. We may update these terms from time to time; if we make a material change we will tell you through the Platform or by email, and continued use after the change means you accept it.</P>
      </>),
    },
    {
      title: "12. Liability",
      body: (<>
        <P>Nothing in these terms excludes rights you have under the Australian Consumer Law that cannot be excluded. Subject to that, and to the extent the law allows, KutumbLink is not liable for events, goods or services provided by organisers, or for indirect or consequential loss. Our total liability for any claim relating to the Platform is limited to the fees we received from you for the transaction in question.</P>
        <P>Organisers agree to indemnify KutumbLink against claims, losses and costs arising from their events, their content, or their breach of these terms or the law.</P>
      </>),
    },
    {
      title: "13. Suspension and termination",
      body: (<>
        <P>You can close your account at any time by contacting us, once any outstanding event obligations and refunds are settled. We may suspend or terminate access if you breach these terms, put people or the Platform at risk, or if required by law.</P>
      </>),
    },
    {
      title: "14. Governing law and contact",
      body: (<>
        <P>These terms are governed by the laws of New South Wales, Australia, and the parties submit to the non-exclusive jurisdiction of its courts.</P>
        <P>Questions about these terms? Email us at <a className="underline" href={`mailto:${LEGAL_EMAIL}`}>{LEGAL_EMAIL}</a>.</P>
      </>),
    },
  ],
};

export const PRIVACY: LegalDoc = {
  title: "Privacy policy",
  intro:
    "We take your privacy seriously. This policy explains what personal information KutumbLink collects, why we collect it, who we share it with and the choices you have. We handle personal information in line with the Privacy Act 1988 (Cth) and the Australian Privacy Principles.",
  sections: [
    {
      title: "1. Information we collect",
      body: (<>
        <UL items={[
          <><strong>Account details</strong>: first and last name, email address, mobile number, region, state, organisation name, legal name and ABN, and an encrypted password.</>,
          <><strong>Event and ticket information</strong>: names, email addresses, phone numbers, ticket types, attendee details and any accessibility or dietary needs you choose to share.</>,
          <><strong>Donation and fundraising information</strong>: donation amounts, dedication messages and receipt details.</>,
          <><strong>Payment information</strong>: handled by our payment providers. We receive confirmation, a reference and the last digits of a card, but not full card numbers.</>,
          <><strong>Technical information</strong>: device, browser, IP address, pages viewed and approximate location, collected through cookies and similar technologies.</>,
          <><strong>Communications</strong>: messages you send to us or through the Platform.</>,
        ]} />
      </>),
    },
    {
      title: "2. How we use it",
      body: (<>
        <UL items={[
          "to create and secure accounts and verify organisations;",
          "to process tickets, registrations, donations, refunds and payouts;",
          "to send confirmations, tickets, receipts and important service messages;",
          "to help organisers run their events and communicate with their attendees and supporters;",
          "to prevent fraud and misuse, keep the Platform secure and meet legal obligations;",
          "to understand how the Platform is used and improve it;",
          "to send news and recommendations, where you have opted in. You can unsubscribe at any time.",
        ]} />
      </>),
    },
    {
      title: "3. Who we share it with",
      body: (<>
        <P><strong>Organisers.</strong> When you buy a ticket, register or donate, we share the necessary details (such as your name, email and ticket or donation information) with the organiser or charity running the event or campaign. They are responsible for handling it in line with privacy law and their own privacy policy.</P>
        <P><strong>Service providers.</strong> We use trusted providers for payments, hosting, email and SMS delivery, analytics and fraud prevention. They may only use your information to provide services to us.</P>
        <P><strong>Legal and safety.</strong> We may disclose information where required by law or to protect people, property or the integrity of the Platform.</P>
        <P>We do not sell your personal information.</P>
      </>),
    },
    {
      title: "4. Overseas disclosure",
      body: (<P>Some of our providers store or process data outside Australia, for example in the United States. Where we send information overseas, we take reasonable steps to make sure it is handled in line with the Australian Privacy Principles.</P>),
    },
    {
      title: "5. Cookies",
      body: (<P>We use cookies that are necessary for sign-in and security, plus analytics cookies that help us understand usage. You can control cookies in your browser settings, but some parts of the Platform may not work without the necessary ones.</P>),
    },
    {
      title: "6. Security and retention",
      body: (<P>We protect information with measures such as encrypted passwords, secure connections and role-based access to organisation workspaces. We keep information only as long as needed for the purposes above and to meet legal, tax and accounting obligations, then delete or de-identify it. No system is completely secure, so please use a strong, unique password.</P>),
    },
    {
      title: "7. Your choices and rights",
      body: (<>
        <P>You can ask to access or correct the personal information we hold about you, ask us to delete it where we are able to, or opt out of marketing messages. Contact us using the details below. We will respond within a reasonable time and may need to verify your identity first.</P>
        <P>For information held by an organiser (for example, an event's attendee list), please contact that organiser directly.</P>
      </>),
    },
    {
      title: "8. Children",
      body: (<P>The Platform is not directed to children under 13, and organiser accounts are for adults only. If you think a child has given us personal information, please tell us so we can remove it.</P>),
    },
    {
      title: "9. Changes to this policy",
      body: (<P>We may update this policy from time to time. The latest version is always available from the footer of the Platform and shows the date it was last updated.</P>),
    },
    {
      title: "10. Contact and complaints",
      body: (<>
        <P>Email our privacy contact at <a className="underline" href={`mailto:${LEGAL_EMAIL}`}>{LEGAL_EMAIL}</a>. If you are not satisfied with our response, you can complain to the Office of the Australian Information Commissioner (OAIC) at oaic.gov.au.</P>
      </>),
    },
  ],
};

export type LegalKind = "terms" | "privacy";
export const LEGAL_DOCS: Record<LegalKind, LegalDoc> = { terms: TERMS, privacy: PRIVACY };
