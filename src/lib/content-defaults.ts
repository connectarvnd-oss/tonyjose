// Default website copy. Everything here is editable from /admin/content and
// stored in the database; these values are used for seeding and as fallbacks.

export const defaultContent = {
  brand: {
    name: "Tony Jose",
    tagline: "Visa, study abroad & migration guidance",
    shortDescription:
      "Independent consultation on visa processes, overseas education admissions, and domestic and international migration, informed by 12 years of experience.",
  },
  hero: {
    eyebrow: "12 years of experience",
    headline: "Your next chapter starts somewhere.",
    emphasis: "somewhere.",
    supporting:
      "Visa guidance, international education, and migration support — informed by 12 years of experience.",
    primaryCta: "Book a Consultation",
    secondaryCta: "Explore Services",
  },
  intro: {
    heading: "Moving forward, with clarity.",
    body:
      "International travel, overseas education, and migration decisions can come with complicated processes and important questions. Tony Jose helps individuals explore their options, understand the process, and take informed next steps through personalised consultation and guidance.",
  },
  howItWorks: {
    heading: "How it works",
    steps: [
      {
        title: "Choose your consultation",
        body: "Select a free 15-minute initial enquiry or a full paid consultation.",
      },
      {
        title: "Select a suitable time",
        body: "View available appointment slots and choose a date and time that works for you.",
      },
      {
        title: "Meet Tony",
        body: "Receive a booking confirmation and the necessary details for your consultation.",
      },
    ],
  },
  experience: {
    heading: "12 years of experience. A more personal approach.",
    paragraphs: [
      "For twelve years, Tony has worked across domestic and international migration and overseas admissions — helping people make sense of processes that are often unfamiliar, detailed, and easy to get lost in.",
      "Every consultation is one-to-one. Rather than a script or a package, you get time to explain your situation, ask the questions that matter to you, and leave with a clearer picture of your options and what to do next.",
    ],
    principles: [
      { title: "Individual attention", body: "Your circumstances are specific. The conversation should be too." },
      { title: "Clear explanations", body: "Plain language about the process, requirements, and realistic next steps." },
      { title: "Honest guidance", body: "No promises of outcomes — just careful, informed advice." },
    ],
  },
  pricing: {
    heading: "Transparent pricing",
    note:
      "The free enquiry is limited to 15 minutes. The full consultation is charged at €28 per hour and paid securely when you book.",
  },
  faq: { heading: "Questions, answered" },
  finalCta: {
    heading: "Every journey begins with a conversation.",
    supporting: "Let’s understand your plans and work out the next step together.",
    cta: "Find a Time to Talk",
  },
  contact: {
    email: "hello@example.com",
    phone: "",
    addressLines: ["[Business address — to be completed]"],
    responseNote: "Replies usually within two working days.",
  },
  disclaimer: {
    text:
      "Consultations provide guidance and information only. They do not guarantee visa approval, university admission, or any migration outcome, and they are not legal representation. Decisions are made solely by the relevant authorities and institutions.",
  },
  seo: {
    title: "Tony Jose — Visa Consultant | Study Abroad & Migration Consultation",
    description:
      "Book a consultation with Tony Jose, a visa consultant with 12 years of experience in visa guidance, study abroad and overseas admissions, and migration support. Free 15-minute initial enquiry.",
  },
};

export type SiteContent = typeof defaultContent;
export type SiteContentKey = keyof SiteContent;

export const defaultServices = [
  {
    title: "Visa Consultation",
    description:
      "Guidance on visa processes, documentation requirements, application preparation, and understanding the next steps relevant to your circumstances.",
  },
  {
    title: "Study Abroad & Admissions",
    description:
      "Support for individuals exploring international education, overseas university admissions, and the application process.",
  },
  {
    title: "Migration Guidance",
    description:
      "Consultation for individuals exploring domestic or international migration pathways, eligibility considerations, and application processes.",
  },
  {
    title: "Personalised Consultation",
    description:
      "One-to-one discussions to understand your situation, answer initial questions, and identify appropriate next steps.",
  },
];

export const defaultFaqs = [
  {
    question: "What can I discuss during the free 15-minute enquiry?",
    answer:
      "The free enquiry is a short introductory call. You can explain your situation, ask an initial question, and find out whether a full consultation would be useful. It is limited to 15 minutes, so detailed review of documents or plans is best kept for a full consultation.",
  },
  {
    question: "What is included in a full consultation?",
    answer:
      "A full consultation is a 60-minute one-to-one session (€28 per hour) for a more detailed discussion about visa processes, overseas education and admissions, or migration questions. We go through your circumstances, the relevant process and requirements, and the practical next steps.",
  },
  {
    question: "Can you help me with study abroad applications?",
    answer:
      "Yes. Tony can talk you through exploring international education options, overseas university admissions, and how the application process generally works, so you can prepare with more confidence.",
  },
  {
    question: "Can you advise me on migration options?",
    answer:
      "Tony offers guidance for people exploring domestic or international migration pathways, including general eligibility considerations and how application processes typically work. This is guidance, not legal representation.",
  },
  {
    question: "How do I book an appointment?",
    answer:
      "Choose the free enquiry or a full consultation, pick an available time in the booking calendar, and enter a few contact details. Full consultations are paid securely online when you book. The whole process takes a minute or two.",
  },
  {
    question: "What happens after I book?",
    answer:
      "You'll see a confirmation page straight away and receive an email with your booking reference, the date and time in your time zone, the meeting details, and a link to add the appointment to your calendar. You'll also get a reminder before the consultation.",
  },
  {
    question: "Can I reschedule or cancel my appointment?",
    answer:
      "Yes. Your confirmation email contains a personal link to manage your booking. You can reschedule or cancel up to 24 hours before the appointment. Paid consultations cancelled with at least 24 hours' notice are refunded in full. See the Cancellation & Refund Policy for details.",
  },
  {
    question: "Does a consultation guarantee visa approval or university admission?",
    answer:
      "No. A consultation provides guidance and information to help you make informed decisions. Visa, admission, and migration decisions are made solely by the relevant authorities and institutions, and no outcome can be guaranteed.",
  },
];

const P = (label: string) => `[${label}]`;

export const defaultLegalPages: { slug: string; title: string; bodyMd: string }[] = [
  {
    slug: "impressum",
    title: "Legal Notice / Impressum",
    bodyMd: `> **Placeholder — must be completed with Tony's real business details and reviewed before launch.**

## Angaben gemäß § 5 DDG

${P("Full legal name")}
${P("Business name, if any")}
${P("Street and number")}
${P("Postcode and city")}
${P("Country")}

## Contact

Email: ${P("Email address")}
Phone: ${P("Phone number")}

## VAT / business registration

${P("VAT identification number under § 27a UStG, if applicable")}
${P("Trade register / registration details, if applicable")}

## Professional information

${P("Only include professional titles, registrations or supervisory authorities that apply and have been verified.")}

## Responsible for content

${P("Name and address of the person responsible for content")}

## Disclaimer

Consultations provide guidance and information only and do not constitute legal representation. No visa approval, admission or migration outcome is guaranteed.
`,
  },
  {
    slug: "privacy",
    title: "Privacy Policy",
    bodyMd: `> **Placeholder — this outline must be reviewed by a qualified adviser for GDPR compliance before launch.**

## 1. Controller

${P("Full legal name")}, ${P("Business address")}, ${P("Email address")}.

## 2. What we collect

When you book a consultation we collect your **name**, **email address**, the **appointment type and time**, and — only if you choose to provide them — your **phone number**, **country of residence**, **area of enquiry**, and a **short description of your question**. We do not ask for passport numbers, identity documents or financial information at booking.

Payments for full consultations are processed by Stripe. We never receive or store your card details; we store only the payment status and Stripe's transaction reference.

## 3. Why we use it (legal bases)

- To arrange and carry out your consultation, send confirmations and reminders (Art. 6(1)(b) GDPR — contract / pre-contractual steps).
- To meet accounting and tax obligations for paid consultations (Art. 6(1)(c) GDPR).
- To send occasional updates, **only if you opted in** (Art. 6(1)(a) GDPR — consent, which you can withdraw at any time).

## 4. Service providers (processors)

- Hosting: ${P("Hosting provider and location")}
- Database: ${P("Database provider and location")}
- Calendar: Google Calendar (Google Ireland Ltd.) — appointments are added to Tony's calendar.
- Video meetings: Google Meet, where online meetings are used.
- Payments: Stripe Payments Europe Ltd.
- Email delivery: ${P("Email provider, e.g. Resend")}

${P("Describe international transfers and safeguards (e.g. EU-U.S. Data Privacy Framework, SCCs) for each provider.")}

## 5. How long we keep it

Booking records are kept for ${P("retention period, e.g. 24 months")} after your last appointment and then anonymised, unless longer retention is legally required (for example, invoices). The optional message you write is deleted earlier.

## 6. Cookies

This website uses only strictly necessary cookies. See the Cookie Policy.

## 7. Your rights

You have the right to access, rectification, erasure, restriction, data portability and objection, and to withdraw consent at any time. Contact ${P("Email address")}. You may also lodge a complaint with a supervisory authority, e.g. ${P("competent data protection authority")}.
`,
  },
  {
    slug: "terms",
    title: "Terms of Service",
    bodyMd: `> **Placeholder — to be reviewed and completed before launch.**

## 1. Scope

These terms apply to consultations booked through this website with ${P("Full legal name / business name")}.

## 2. Nature of the service

Consultations provide general guidance and information about visa processes, overseas education and admissions, and migration. They do not constitute legal advice or legal representation, and ${P("Tony Jose")} is not acting as a lawyer or government-authorised representative ${P("— amend only if verified credentials apply")}. **No visa approval, admission or migration outcome is guaranteed.** Decisions rest solely with the relevant authorities and institutions.

## 3. Bookings and prices

- Free initial enquiry: 15 minutes, no charge.
- Full consultation: €28 per hour (60 minutes), payable in full at the time of booking.
- Prices ${P("include / do not include VAT — confirm with tax adviser")}.

A paid booking is confirmed only once payment has been successfully verified.

## 4. Cancellation and rescheduling

See the Cancellation & Refund Policy.

## 5. Right of withdrawal (consumers)

${P("Add the statutory withdrawal information for consumers and the treatment of services fully performed within the withdrawal period — requires legal review.")}

## 6. Liability

${P("Liability clause — requires legal review.")}

## 7. Governing law

${P("Governing law and jurisdiction")}
`,
  },
  {
    slug: "cancellation",
    title: "Cancellation & Refund Policy",
    bodyMd: `> **Placeholder — confirm the rules below with Tony before launch. They mirror the default booking settings.**

## Free initial enquiry

You can cancel or reschedule your free enquiry at any time up to 24 hours before it starts, using the link in your confirmation email.

## Full consultation (€28)

- **Cancel 24 hours or more before** the appointment: full refund to your original payment method.
- **Cancel less than 24 hours before**, or not attending: no automatic refund. Please get in touch if something unexpected came up.
- **Reschedule** up to 24 hours before the appointment, up to two times, at no cost.

## If we need to cancel

If Tony has to cancel, you will be offered a new time or a full refund.

## If your time slot became unavailable during payment

In the rare case that your payment completes after your reserved time was released, we will refund you in full automatically or contact you to arrange a new time.

## How refunds are paid

Refunds are issued via Stripe to the original payment method and usually appear within 5–10 business days.

Questions: ${P("Email address")}
`,
  },
  {
    slug: "cookies",
    title: "Cookie Policy",
    bodyMd: `> **Placeholder — review before launch.**

This website uses **only strictly necessary cookies and storage**:

| Name | Purpose | Duration |
| --- | --- | --- |
| \`tj_admin\` | Keeps administrators signed in to the private dashboard | 8 hours |
| \`tj_google_oauth\` | Protects the Google Calendar connection flow (admin only) | 10 minutes |
| Session storage | Remembers your booking progress in this browser tab | Until the tab is closed |

No analytics, advertising or tracking cookies are used, so no consent banner is shown. If privacy-friendly analytics are added later, this policy and the consent controls will be updated first.

When you pay, you are redirected to Stripe, which sets its own cookies under its own policy.
`,
  },
];

export const legalSlugs = defaultLegalPages.map((p) => p.slug);
