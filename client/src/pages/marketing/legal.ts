/**
 * The legal pages (Terms, Privacy, Cookies, Data Processing). Drafted for Metriq's launch; have a
 * lawyer in your own country review them before you rely on them.
 *
 * The facts every page uses are in LEGAL below. Check them first: who runs Metriq, where it is
 * registered, and which country's law and courts apply.
 */

export const LEGAL = {
  product: 'Metriq',
  /** The business that runs Metriq and signs these terms. */
  operator: '99 Technologies',
  /** Where that business is registered: its law applies and its courts decide disputes. */
  country: 'Pakistan',
  courts: 'the courts of Karachi, Pakistan',
  updated: '30 October 2026',
  /** How people reach us. There is no public email address yet, so the Help button and email replies. */
  contact: 'through the Help button inside Metriq, or by replying to any email Metriq sends you',
} as const

export type LegalDoc = {
  slug: 'terms' | 'privacy' | 'cookies' | 'dpa'
  title: string
  short: string
  summary: string[]
  sections: { id: string; title: string; body: (string | string[])[] }[]
}

const { product: M, operator: OP, country, courts, contact } = LEGAL

/** The services Metriq uses to run, and what each one gets. Kept here so Privacy and the DPA agree. */
export const SUBPROCESSORS = [
  { name: 'Our server and hosting providers', what: 'Run the servers, database and file storage that hold Metriq and your company’s data.' },
  { name: 'Mailtrap (Railsware)', what: 'Sends Metriq’s emails: sign-in links, invitations, reminders and reports.' },
  { name: 'Groq', what: 'Turns meeting recordings into text and writes meeting notes, only when someone uses AI meeting notes.' },
  { name: 'Anthropic', what: 'Writes meeting notes and summaries, only when someone uses an AI feature.' },
  { name: 'Cloudflare', what: 'Relays voice and video calls when a direct connection between two people is not possible.' },
  { name: 'Google and Microsoft', what: 'Confirm who you are when you choose to sign in with Google or Microsoft.' },
  { name: 'Stripe', what: 'Takes card payments and keeps payment details, once online payment opens. We never see full card numbers.' },
] as const

export const LEGAL_DOCS: LegalDoc[] = [
  /* ================================================================== terms */
  {
    slug: 'terms',
    title: 'Terms of Service',
    short: 'Terms',
    summary: [
      `These terms are the agreement between ${OP} and the company or person that uses ${M}.`,
      `Your company’s data belongs to your company. We only use it to run ${M} for you.`,
      `${M} is free while it launches. We will tell you before any charge starts, and you can leave at any time.`,
      'Do not use Metriq for anything illegal, or to track people in ways the law does not allow.',
    ],
    sections: [
      {
        id: 'agreement', title: '1. This agreement',
        body: [
          `These Terms of Service (the “Terms”) are a binding agreement between ${OP} (“we”, “us”, “our”) and you. ${M} is the web app at our website and everything in it, including any mobile apps, connectors and emails (the “Service”).`,
          `If you sign up for a company or team, you accept these Terms for that company (the “Customer”) and confirm you have the authority to do so. If you do not have that authority, or do not agree to these Terms, do not use the Service. People your Customer invites (“Users”) must also follow these Terms when they use the Service.`,
          'Our Privacy Policy, Cookie Policy and, for business customers, our Data Processing Addendum form part of these Terms.',
        ],
      },
      {
        id: 'accounts', title: '2. Accounts',
        body: [
          'You must give true and complete information when you sign up, and keep it up to date. You must be at least 18 years old, or the age of majority where you live, to create a company account.',
          'You are responsible for everything done under your accounts. Keep passwords private, use a strong password, and tell us at once if you think an account has been used without permission. The Super Admin of a company controls who is invited, what each person can see, and when access ends.',
          'If you sign in with Google or Microsoft, their terms also apply to that sign-in, and we rely on them to confirm your email address.',
        ],
      },
      {
        id: 'launch', title: '3. Free launch period, plans and fees',
        body: [
          `During our launch period the Service is free. Plans and prices shown on our website describe what the Service will cost once online payment opens. Before we start charging, we will tell each Customer by email and in the Service, at least 14 days in advance, and you can decide then whether to choose a paid plan.`,
          'Once a paid plan applies: fees are charged in advance for each month or year, in US dollars, and do not include taxes unless stated. A plan covers everyone up to its limit of people. Changing plans in the middle of a period is worked out to the day. Paid fees are not refunded except where the law requires it or we say otherwise in writing.',
          'If a payment fails, we will tell you and try again. If it is still unpaid after a reasonable notice period, we may limit the Service to reading what is already there until the payment is made.',
          'We may change our prices for future periods with at least 30 days’ notice. A change never applies to a period you have already paid for.',
        ],
      },
      {
        id: 'your-data', title: '4. Your data',
        body: [
          `Everything your Customer and its Users put into the Service, such as attendance records, tasks, messages, files, reports, leads and recordings (“Customer Data”), belongs to the Customer. We claim no ownership of it.`,
          'You give us permission to host, copy, process, send and display Customer Data only as needed to provide, secure and support the Service for you, and as described in our Privacy Policy and Data Processing Addendum. We do not sell Customer Data, and we do not use it to train artificial intelligence models.',
          'You are responsible for Customer Data: that you have the right to put it in the Service, that it is accurate, and that your use of it is lawful. This includes telling your employees about attendance, location-of-network checks and other records you keep about them, and getting any consent the law in your country requires.',
          'Our staff can only look inside your company’s Service when your Super Admin allows support access, for a limited time, and every visit is logged. We may also access Customer Data where the law requires us to, or to stop a security threat or abuse, and we will tell you when we lawfully can.',
        ],
      },
      {
        id: 'use', title: '5. Acceptable use',
        body: [
          'You and your Users must not:',
          [
            'break any law, including employment, privacy, telemarketing, anti-spam and data protection laws;',
            'monitor or record people secretly, or in a way the law where they work does not allow;',
            'upload anything you have no right to share, or anything that is unlawful, harmful, threatening, abusive or infringes someone else’s rights;',
            'send spam or unsolicited calls or messages using contact lists in the Service, or call people who have asked not to be called;',
            'try to get into another company’s data, test our security without our written permission, or get around any limit or protection in the Service;',
            'upload viruses or harmful code, or overload, scrape or reverse-engineer the Service;',
            'resell or rent the Service to others, or use it to build a competing product.',
          ],
          'We may remove content or suspend access that breaks this section. Where possible we will warn you first and give you a chance to fix it.',
        ],
      },
      {
        id: 'ai', title: '6. AI features and connected apps',
        body: [
          'Some features use artificial intelligence, such as meeting notes, summaries and connecting your own AI assistant. AI output can be wrong or incomplete. Check it before you rely on it, especially before acting on it about a person.',
          'Recording a meeting or call may need the consent of everyone in it. Before you record, tell the people in the meeting and get any consent the law requires.',
          'If you connect a third-party app or AI assistant to the Service, you choose what it can see, and that app’s own terms and privacy policy apply to what it does with the data it receives.',
        ],
      },
      {
        id: 'ours', title: '7. Our service and our rights',
        body: [
          `We own the Service, including its software, design, names and logos. These Terms give you a limited, non-exclusive, non-transferable right to use the Service for your own business while these Terms are in force. Nothing else passes to you.`,
          'If you send us ideas or feedback, we may use them freely, with no duty to you.',
          'We keep improving the Service and may add, change or remove features. If we remove something important that you depend on, we will tell you in advance where we reasonably can.',
        ],
      },
      {
        id: 'availability', title: '8. Availability and support',
        body: [
          'We work to keep the Service available and secure, back up the database every night and before every update, and fix problems quickly. We do not promise that the Service will always be available or free of errors; planned maintenance and events outside our control can interrupt it.',
          `Support is given ${contact}.`,
        ],
      },
      {
        id: 'ending', title: '9. Ending this agreement',
        body: [
          'You may stop using the Service and close your company account at any time.',
          'We may suspend or end your access if you seriously or repeatedly break these Terms, if the law requires it, or if your use puts the Service or other customers at risk. Unless the risk is urgent, we will give notice and a chance to fix the problem first. We may also stop offering the Service altogether with at least 60 days’ notice.',
          'When your account ends, you can ask us for an export of your Customer Data within 30 days. After that we delete it from the live Service, and from backups as they roll over, within a further 60 days, unless the law requires us to keep it.',
          'Sections that by their nature should continue after the agreement ends (such as fees owed, data ownership, limits of liability and governing law) continue.',
        ],
      },
      {
        id: 'warranty', title: '10. Disclaimer',
        body: [
          'Except as these Terms expressly say, the Service is provided “as is” and “as available”. To the fullest extent the law allows, we disclaim all other warranties, express or implied, including fitness for a particular purpose, merchantability and non-infringement. Calculations in the Service, such as hours, pay-related totals and targets, are tools to help you; you remain responsible for payroll, legal and business decisions you make with them.',
        ],
      },
      {
        id: 'liability', title: '11. Limit of liability',
        body: [
          'To the fullest extent the law allows, neither side is liable to the other for any indirect, incidental, special or consequential loss, or for lost profits, revenue, goodwill or data that could have been avoided with reasonable backups, even if told it was possible.',
          'To the fullest extent the law allows, our total liability arising out of or relating to these Terms is limited to the greater of (a) the fees the Customer paid us for the Service in the 12 months before the event that caused the claim and (b) 100 US dollars.',
          'Nothing in these Terms limits liability that cannot be limited by law, such as for fraud, or for death or personal injury caused by negligence.',
        ],
      },
      {
        id: 'indemnity', title: '12. Claims from others',
        body: [
          'The Customer will defend and compensate us against claims by third parties (including its own employees) arising from Customer Data, or from the Customer’s or its Users’ use of the Service in breach of these Terms or the law. We will tell the Customer promptly about any such claim and cooperate reasonably.',
        ],
      },
      {
        id: 'changes', title: '13. Changes to these Terms',
        body: [
          'We may update these Terms. For an important change, we will tell Customers by email or in the Service at least 30 days before it applies. Continuing to use the Service after a change applies means you accept it; if you do not, you can close your account before then.',
        ],
      },
      {
        id: 'law', title: '14. Law and disputes',
        body: [
          `These Terms are governed by the laws of ${country}, without regard to conflict-of-law rules. Both sides agree to try in good faith to settle any dispute by talking first. If that fails within 30 days, the dispute will be decided by ${courts}, which have exclusive jurisdiction, unless the law where a consumer lives gives them the right to bring a claim there.`,
        ],
      },
      {
        id: 'general', title: '15. General',
        body: [
          'These Terms, with the policies they refer to, are the whole agreement between us about the Service. If a part is found unenforceable, the rest stays in force. Not enforcing a right is not giving it up. You may not transfer this agreement without our written consent; we may transfer it to a business that takes over the Service, and will tell you if we do. Neither side is responsible for delays caused by events outside its reasonable control.',
          `Questions about these Terms: write to us ${contact}.`,
        ],
      },
    ],
  },

  /* ================================================================== privacy */
  {
    slug: 'privacy',
    title: 'Privacy Policy',
    short: 'Privacy',
    summary: [
      `For your company’s records in ${M}, your company decides what is kept; we process it for them.`,
      'We collect only what we need to run Metriq, keep it safe and talk to you about it.',
      'We do not sell personal data, show adverts, or use your data to train AI models.',
      'You can ask to see, correct, export or delete your data.',
    ],
    sections: [
      {
        id: 'who', title: '1. Who we are',
        body: [
          `${OP} runs ${M} (“we”, “us”). This policy explains how we handle personal data when you visit our website, sign up, or use ${M}.`,
          `We play two roles. For the records a company keeps in ${M} about its people and its work (“Customer Data”), the company is the controller and decides what is collected and why; we process that data on its behalf, under our Data Processing Addendum. If you are an employee and have a question about your records, ask your employer first; we will help them answer. For account, billing, website and support data, we are the controller.`,
        ],
      },
      {
        id: 'collect', title: '2. What we collect',
        body: [
          'Account details: name, work email, password (stored only as a one-way hash), role, department, profile photo if you add one, and your company’s name, address on our website and time zone.',
          'What you and your team put in: attendance times, breaks, leave and overtime; tasks, projects, comments and files; chat messages; daily reports and targets; leads and call notes; meeting recordings and notes when someone uses those features.',
          'Sign-in and security records: when and how you signed in, IP address, browser and device type, and an activity log of important changes. If your company limits check-in to its office network, the network address is checked at check-in.',
          'Sign-in with Google or Microsoft: your name, email address and a provider account ID. We never get your Google or Microsoft password.',
          'Billing (once online payment opens): plan, invoices and billing contact. Card details go straight to our payment provider; we never see or keep full card numbers.',
          'Support: what you write to us and anything you choose to send with it.',
          'Website: our website does not use analytics or advertising trackers. Our servers keep short technical logs (such as IP address and pages requested) to keep the service secure and working.',
        ],
      },
      {
        id: 'use', title: '3. How we use it',
        body: [
          [
            `to provide ${M}: sign you in, show the right screens to the right people, keep records and send the emails and notifications you or your company turned on;`,
            'to keep it secure: detect abuse, stop unauthorised access, and keep logs of sign-ins and changes;',
            'to support you and tell you about important changes, such as to these policies or to prices;',
            'to bill for paid plans, once online payment opens;',
            'to improve the service, using counts and error reports rather than the content of your records;',
            'to meet our legal duties.',
          ],
          'We do not sell personal data, use it for advertising, or use Customer Data to train artificial intelligence models.',
        ],
      },
      {
        id: 'basis', title: '4. Legal bases',
        body: [
          'Where laws such as the EU or UK GDPR apply, we rely on: performing our contract with you or your company; our legitimate interests in running a secure and reliable service (balanced against your rights); our legal obligations; and consent, where we ask for it (you can withdraw it at any time). For Customer Data, the legal basis is decided by your company as controller.',
        ],
      },
      {
        id: 'share', title: '5. Who we share it with',
        body: [
          'We share personal data only with service providers that help us run Metriq, under contracts that require them to protect it and use it only to provide their service to us:',
          SUBPROCESSORS.map((s) => `${s.name}: ${s.what}`),
          `Inside your company, what people can see depends on the roles and permissions your Super Admin sets. We may also share data where the law requires it, to protect people’s safety or our rights, or as part of a sale or merger of our business, in which case this policy continues to protect it.`,
        ],
      },
      {
        id: 'transfers', title: '6. International transfers',
        body: [
          'Metriq’s servers and some of our providers are outside the country you may be in, including in the United States. Where data protection law requires it, we use recognised safeguards for these transfers, such as the European Commission’s Standard Contractual Clauses, and we take steps to make sure your data is protected to the same standard.',
        ],
      },
      {
        id: 'keep', title: '7. How long we keep it',
        body: [
          'Customer Data is kept while your company uses Metriq, for as long as your company chooses. When a company closes its account, we delete its data within 30 days after the export window, and from backups as they roll over within a further 60 days.',
          'Sign-in and security logs are kept for up to 12 months. Billing records are kept as long as tax law requires. Support messages are kept for up to 24 months after the conversation ends.',
        ],
      },
      {
        id: 'security', title: '8. Security',
        body: [
          'Each company’s records are walled off from every other company, by the app and by the database itself. Everything travels over HTTPS; passwords are stored as strong one-way hashes; the database and files are backed up nightly and before every update. Our staff can enter a company’s Metriq only when its Super Admin allows it, for a limited time, and every visit is logged. No system is perfectly secure; if a breach affects your data, we will tell you and the authorities as the law requires.',
        ],
      },
      {
        id: 'rights', title: '9. Your rights',
        body: [
          'Depending on where you live, you may have the right to: see the personal data we hold about you; correct it; delete it; get a copy in a portable format; object to or limit some uses; and withdraw consent. You also have the right to complain to your local data protection authority.',
          `To use these rights, write to us ${contact}. If your request is about records your employer keeps in Metriq, we will pass it to them, as they decide on it. We answer within 30 days and will not treat you differently for using your rights. Residents of California may also ask what categories of personal information we collect and disclose; we do not sell or share personal information for cross-context advertising.`,
        ],
      },
      {
        id: 'children', title: '10. Children',
        body: ['Metriq is a tool for work and is not meant for anyone under 16. We do not knowingly collect data from children. If you think a child has given us personal data, tell us and we will delete it.'],
      },
      {
        id: 'cookies', title: '11. Cookies',
        body: ['We use only the cookies needed to sign you in and keep you secure. Our Cookie Policy lists them.'],
      },
      {
        id: 'changes', title: '12. Changes and contact',
        body: [
          'We will update this policy when what we do changes, and change the date at the top. For important changes we will tell account holders by email or in Metriq before they apply.',
          `Questions or requests: write to us ${contact}.`,
        ],
      },
    ],
  },

  /* ================================================================== cookies */
  {
    slug: 'cookies',
    title: 'Cookie Policy',
    short: 'Cookies',
    summary: [
      'We use only cookies that are needed to sign you in and keep you secure.',
      'No advertising cookies and no analytics trackers.',
      'A few settings, like dark mode, are kept in your own browser and never sent to us.',
    ],
    sections: [
      {
        id: 'what', title: '1. What cookies are',
        body: ['Cookies are small files a website stores in your browser. Similar tools, such as your browser’s local storage, keep small settings on your own device.'],
      },
      {
        id: 'ours', title: '2. The cookies we use',
        body: [
          'All of these are strictly necessary for Metriq to work, so they do not need your consent under laws such as the EU ePrivacy rules. They cannot be read by other websites.',
          [
            'token: keeps you signed in. Set when you sign in, lasts up to 7 days, or until you sign out.',
            'pt_oauth: makes sure a Google or Microsoft sign-in came back to the same browser that started it. Lasts 10 minutes.',
            'Guest pass: lets a guest who joined a call or chat by link stay in it. Lasts a few hours.',
            'Owner session: only for Metriq’s own operators on our control panel.',
          ],
        ],
      },
      {
        id: 'storage', title: '3. Settings kept in your browser',
        body: ['Metriq remembers small choices on your device, such as light or dark mode, whether the menu is collapsed, and which view you last used on a page. These stay in your browser and are not sent to us. Clearing your browser’s site data resets them.'],
      },
      {
        id: 'none', title: '4. What we do not use',
        body: ['We do not use advertising cookies, cross-site trackers, social media pixels or analytics cookies. If that ever changes, we will update this policy first and ask for your consent where the law requires it.'],
      },
      {
        id: 'control', title: '5. Your choices',
        body: [`You can block or delete cookies in your browser’s settings. If you block the necessary cookies, you will not be able to sign in. Questions: write to us ${contact}.`],
      },
    ],
  },

  /* ================================================================== dpa */
  {
    slug: 'dpa',
    title: 'Data Processing Addendum',
    short: 'Data Processing',
    summary: [
      'For business customers: how we process your company’s data on your behalf.',
      'We act only on your instructions, keep it confidential and secure, and help you meet your duties.',
      'We tell you about new providers, and about any breach without undue delay.',
      'It applies automatically when you accept our Terms of Service.',
    ],
    sections: [
      {
        id: 'scope', title: '1. Scope',
        body: [
          `This Data Processing Addendum (“DPA”) forms part of the Terms of Service between ${OP} (“Processor”) and the Customer (“Controller”). It applies when we process personal data in Customer Data on the Customer’s behalf, and is designed to meet Article 28 of the EU and UK GDPR and similar laws. If this DPA and the Terms conflict, this DPA wins for data protection matters.`,
        ],
      },
      {
        id: 'details', title: '2. The processing',
        body: [
          [
            'Subject matter and duration: providing the Service, for as long as the Terms are in force and until the data is deleted as described below.',
            'Nature and purpose: hosting, storing, organising, displaying, sending and analysing data so the Customer can run attendance, projects, chat, calls, reports, sales and other features.',
            'Data subjects: the Customer’s employees, contractors and guests, and contacts the Customer stores (such as leads and customers).',
            'Kinds of data: names, contact details, job and department details, attendance and working-time records, work content, messages, files, call and meeting records, and sign-in and device data. The Customer should not put special categories of data (such as health data) in the Service unless it has a lawful basis and the Service is suited to it.',
          ],
        ],
      },
      {
        id: 'instructions', title: '3. Processing only on instructions',
        body: ['We process Customer personal data only on the Customer’s documented instructions, which are the Terms, this DPA and the Customer’s use and settings of the Service, unless the law requires otherwise; in that case we tell the Customer first unless the law forbids it. We will tell the Customer if we believe an instruction breaks data protection law.'],
      },
      {
        id: 'people', title: '4. Confidentiality',
        body: ['Everyone at our business who can access Customer personal data is bound by confidentiality. Our staff look inside a Customer’s Service only when the Customer’s Super Admin allows support access, for the time allowed, and every visit is logged.'],
      },
      {
        id: 'security', title: '5. Security measures',
        body: [
          [
            'Separation of each customer’s data, enforced in the application and in the database itself;',
            'encryption in transit (HTTPS) and one-way hashing of passwords;',
            'role-based access inside each company, decided by the Customer;',
            'nightly backups and backups before every update, with the ability to roll back;',
            'logs of sign-ins and important changes, and monitoring of errors and abuse;',
            'limited, logged and time-bound staff access, as above.',
          ],
          'We review these measures regularly and may improve them, but never reduce the overall level of protection.',
        ],
      },
      {
        id: 'sub', title: '6. Sub-processors',
        body: [
          'The Customer authorises us to use the sub-processors listed in our Privacy Policy. We bind each to data protection terms at least as protective as this DPA and remain responsible for them. We will give at least 14 days’ notice before adding or replacing one; the Customer may object on reasonable data protection grounds, and if we cannot address the objection, the Customer may end the affected part of the Service.',
        ],
      },
      {
        id: 'help', title: '7. Helping the Customer',
        body: ['Taking into account the nature of the processing, we help the Customer answer requests from people exercising their rights (mainly through the Service’s own export, edit and delete tools), and with security, breach notifications, data protection impact assessments and consultations with authorities, where these concern our processing.'],
      },
      {
        id: 'breach', title: '8. Personal data breaches',
        body: ['We will tell the Customer without undue delay, and in any case within 72 hours, after becoming aware of a personal data breach affecting Customer personal data, with the information the Customer reasonably needs to meet its own duties, and we will take reasonable steps to contain it and reduce its effects.'],
      },
      {
        id: 'transfers', title: '9. International transfers',
        body: ['Where Customer personal data subject to EU, UK or Swiss law is transferred to a country without an adequacy decision, the Standard Contractual Clauses (Module 2, controller to processor, or Module 3 where applicable), with the UK addendum where relevant, are incorporated into this DPA by reference, with the Customer as data exporter and us as data importer.'],
      },
      {
        id: 'end', title: '10. Deletion and return',
        body: ['When the Terms end, the Customer can export its data for 30 days. We then delete Customer personal data from the live Service, and from backups as they roll over within a further 60 days, unless the law requires us to keep it, in which case we keep it protected and use it for nothing else.'],
      },
      {
        id: 'audit', title: '11. Information and audits',
        body: ['We make available the information reasonably needed to show we meet this DPA, and answer the Customer’s reasonable written security questions. Where that is not enough, the Customer may audit our compliance once a year with 30 days’ notice, during business hours, at its own cost, through an independent auditor bound by confidentiality, and in a way that does not expose other customers’ data.'],
      },
      {
        id: 'liability', title: '12. Liability',
        body: [`Each side’s liability under this DPA is subject to the limits in the Terms, except where the law does not allow it. Questions about this DPA: write to us ${contact}.`],
      },
    ],
  },
]
