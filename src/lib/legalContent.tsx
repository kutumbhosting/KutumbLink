import type { ReactNode } from "react";

export type LegalSection = { title: string; body: ReactNode };
export type LegalDoc = { title: string; intro: string; sections: LegalSection[] };

export const LEGAL_UPDATED = "9 October 2026";
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
  title: "Privacy and cookie policy",
  intro:
    "This policy explains how KutumbLink handles personal information when you browse the site, register for an event, donate, fundraise, manage an organisation or contact us. Organisers may also collect information for their own purposes; please read their privacy notice for those activities. Where the Privacy Act 1988 (Cth) applies, we handle personal information under the Australian Privacy Principles.",
  sections: [
    {
      title: "1. Information we collect",
      body: (<>
        <UL items={[
          <><strong>Account and organisation details</strong>: your name, email, phone, organisation details and information needed to authenticate or review an organisation.</>,
          <><strong>Event and supporter details</strong>: registration, attendee, membership, volunteer, donation and fundraising records, including information you choose to provide. Organisers decide which optional details they request.</>,
          <><strong>Payment details</strong>: payments are handled by the payment provider shown at checkout. KutumbLink receives transaction status and references needed to support the service; the provider handles card credentials.</>,
          <><strong>Platform activity</strong>: event-page views and campaign source information may be recorded for event reporting. If an organiser sends an email campaign through KutumbLink, delivery status and campaign open or link-click activity may be recorded for campaign reporting.</>,
          <><strong>Technical and contact information</strong>: requests to the website may include browser, device, network and timestamp details processed by the platform and its hosting services. We also keep communications and preference records you provide.</>,
          <><strong>Optional location lookup</strong>: if you choose “Use my location”, your browser asks for permission and sends your approximate device coordinates to KutumbLink. We forward them to our configured reverse-geocoding service (OpenStreetMap Nominatim by default) to identify a nearby suburb or city. We briefly cache a rounded location lookup to limit repeat requests; we do not save your precise coordinates as a profile or event record. The <a className="underline" href="https://osmfoundation.org/wiki/Privacy_Policy">OpenStreetMap privacy policy</a> applies when its service is used.</>,
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
          "to operate and secure the service, troubleshoot issues and measure event or email campaign activity;",
          "when you request it, to identify a nearby area for event discovery;",
          "to send marketing only where permitted and where you have consented. You can opt out of marketing at any time.",
        ]} />
      </>),
    },
    {
      title: "3. Who we share it with",
      body: (<>
        <P><strong>Organisers.</strong> When you buy a ticket, register or donate, we share the necessary details (such as your name, email and ticket or donation information) with the organiser or charity running the event or campaign. They are responsible for handling it in line with privacy law and their own privacy policy.</P>
        <P><strong>Service providers.</strong> We share relevant information with providers that support hosting, payment processing, email and SMS delivery, identity checks and platform security. We do not currently use third-party advertising or analytics cookies.</P>
        <P><strong>Legal and safety.</strong> We may disclose information where required by law or to protect people, property or the integrity of the Platform.</P>
        <P>We do not sell your personal information.</P>
      </>),
    },
    {
      title: "4. Overseas disclosure",
      body: (<P>Some service providers may store or process information outside Australia, depending on the provider and the service configuration. Where the Privacy Act applies and personal information is disclosed to an overseas recipient, we take steps required by applicable Australian privacy law.</P>),
    },
    {
      title: "5. Cookies and similar technologies",
      body: (<>
        <P>This release uses first-party cookies for essential functions: administrator and supporter sign-in sessions, and a preference that remembers the state of an interface panel. The sign-in cookies are httpOnly and are not available to page scripts. Blocking or clearing them can sign you out or affect a saved interface preference.</P>
        <P>We do not currently set advertising or third-party analytics cookies. Event-page measurement and, when an organiser sends a campaign, email open and link-click reporting are described above; these features do not rely on an advertising cookie. A payment provider may use its own technologies on its checkout pages under that provider’s notices.</P>
        <P>You can block or clear cookies in your browser settings. See <a className="underline" href="/privacy-choices">Your privacy choices</a> for the available controls and preference links.</P>
      </>),
    },
    {
      title: "6. Security and retention",
      body: (<P>We protect information with measures such as encrypted passwords, secure connections and role-based access to organisation workspaces. We keep information only as long as needed for the purposes above and to meet legal, tax and accounting obligations, then delete or de-identify it. No system is completely secure, so please use a strong, unique password.</P>),
    },
    {
      title: "7. Your choices and privacy rights",
      body: (<>
        <P>You can ask to access or correct personal information we hold about you, and request deletion where we can do so while meeting legal, payment and record-keeping obligations. We may need to verify your identity. You can also change supporter communication preferences or use your browser’s cookie settings. See <a className="underline" href="/privacy-choices">Your privacy choices</a>.</P>
        <P>For information an organiser controls about its event, campaign, members or supporters, contact that organiser. KutumbLink can help route a request where appropriate.</P>
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
        <P>Email our privacy contact at <a className="underline" href={`mailto:${LEGAL_EMAIL}`}>{LEGAL_EMAIL}</a>. If the Privacy Act applies and you are not satisfied with our response, you may contact the <a className="underline" href="https://www.oaic.gov.au/privacy/your-privacy-rights">Office of the Australian Information Commissioner</a>.</P>
      </>),
    },
  ],
};

export const ORGANISER_TERMS: LegalDoc = {
  title: "Organiser terms",
  intro: "These terms apply when an organisation or its authorised team uses KutumbLink to publish events, campaigns, auctions, memberships or products, collect supporter information, send updates or receive payments. They supplement the general Terms of use.",
  sections: [
    { title: "1. Authority and accurate information", body: (<><P>You must be at least 18 and authorised to act for the organisation. Keep organisation, contact, banking, event and campaign information accurate and current, and tell us about material changes. We may request documents or other information to verify an organisation, its representatives or a payment instruction.</P><P>KutumbLink’s platform review is not ACNC registration, a fundraising licence, an endorsement or confirmation of deductible gift recipient status.</P></>) },
    { title: "2. Fundraising and public claims", body: (<><P>You are responsible for having authority to fundraise and for complying with applicable Commonwealth, state and territory laws, permits and codes. Requirements vary by jurisdiction. Describe the purpose, beneficiary, use of funds, fees, conditions and any material limits clearly and truthfully.</P><P>Do not say a donation is tax deductible unless the recipient and gift qualify. A charity’s status alone does not make every donation deductible. Raffles and lottery-style fundraising are not available in this release.</P><P>Fundraising by charities is regulated across states and territories; check the regulator and requirements for every place where you solicit donations.</P></>) },
    { title: "3. Events, goods and supporter services", body: (<><P>You are responsible for delivering each event, membership, product, auction item and other offer as described, including safety, accessibility, fulfilment, stock, customer service, cancellations and refunds. Publish clear prices, dates, eligibility rules, delivery details and refund terms before checkout.</P><P>Nothing in these terms excludes consumer guarantees or other rights that cannot be excluded under the Australian Consumer Law. If an event or offer is cancelled, materially changed, faulty or not supplied as promised, you must provide any remedy required by law.</P></>) },
    { title: "4. Payments, fees and settlement", body: (<><P>KutumbLink platform access is currently priced at A$0 as shown on the Pricing page. Payment-provider fees, bank charges, taxes and any other charges disclosed at checkout may still apply. We may update platform pricing with notice.</P><P>Payments are processed by the provider shown in the relevant flow. You authorise us and the provider to process transactions, refunds and reversals needed to complete your instructions. Settlement timing depends on the payment flow, verification, provider processing, refunds, disputes and compliance checks. We may delay or withhold a transfer where reasonably necessary to investigate suspected fraud, meet legal obligations or cover a refund or chargeback.</P><P>You remain responsible for your own tax, accounting and reporting obligations. Keep complete records of receipts, fees, refunds and transfers.</P></>) },
    { title: "5. Supporter information and communications", body: (<><P>Use attendee, donor and supporter information only for the event, donation, membership, fulfilment or other purpose explained when it was collected. Provide any notice required for your collection and obtain valid consent where required. Keep access limited to authorised people, protect the information and delete or de-identify it when no longer required.</P><P>Do not upload purchased, scraped or otherwise unauthorised contact lists. Before sending marketing email or SMS, ensure you have the required consent, identify the sender and provide a working unsubscribe method. Honour opt-outs promptly. Transactional messages should stay relevant to the person’s registration, payment or service.</P><P>KutumbLink’s Privacy and cookie policy describes how the platform handles personal information. You are responsible for your own privacy notice and practices as an organiser.</P></>) },
    { title: "6. Account security and team roles", body: (<><P>Keep login links, passwords and payment credentials secure. Give team members only the access they need, remove access when they leave and promptly tell us about suspected misuse or a compromised account. You are responsible for actions taken by people using your organisation workspace.</P></>) },
    { title: "7. Content and prohibited use", body: (<><P>You retain ownership of content you submit and give KutumbLink permission to host, display and promote it as needed to provide the service. You confirm that you have permission to use it and that it is accurate, lawful and not misleading.</P><P>You must not use the platform for fraud, unlawful fundraising, misleading claims, discrimination, harassment, unsafe events, unauthorised gaming, infringement of another person’s rights or interference with platform security. We may remove or pause content while we review a concern.</P></>) },
    { title: "8. Suspension and termination", body: (<><P>We may restrict access, pause a listing or delay a transfer if information is incomplete, a payment is disputed, we receive a credible safety or fraud report, you breach these terms or action is needed to comply with law. Where appropriate, we will contact you and explain the next steps. You remain responsible for outstanding events, customer communications, refunds and records after access ends.</P></>) },
    { title: "9. Australian law and contact", body: (<><P>These terms are governed by the laws of New South Wales, Australia, subject to any mandatory laws that apply elsewhere. The Australian Consumer Law continues to apply where relevant.</P><P>Contact us about these terms at <a className="underline" href={`mailto:${LEGAL_EMAIL}`}>{LEGAL_EMAIL}</a>. For state and territory fundraising rules, consult the relevant regulator; the <a className="underline" href="https://www.acnc.gov.au/for-charities/manage-your-charity/other-regulators/state-and-territory-regulators">ACNC regulator directory</a> links to jurisdiction-specific information.</P></>) },
  ],
};

export type LegalKind = "terms" | "privacy";
export const LEGAL_DOCS: Record<LegalKind, LegalDoc> = { terms: TERMS, privacy: PRIVACY };
