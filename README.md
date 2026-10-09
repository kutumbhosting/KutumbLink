# KutumbLink

KutumbLink is an Australian community and charity platform. The package includes the React/Vite website, Express API, PostgreSQL migrations, organisation admin tools, fundraising suite, event operations and production frontend build.

## What the package supports

- Public charity profiles, event discovery, event ticketing/registration, QR tickets and check-in.
- One-time donations (for organisations with internal giving enabled), published campaigns, supporter-led fundraising pages and teams. Other organisations can link to their external giving page.
- Charity onboarding and review, organisation-scoped roles, supporter records and activity history.
- Member records, event operations, finance reports, bank reconciliation and CSV imports.
- Stripe, Square and PayPal payment flows when configured; bank transfer workflows are also available.
- Public auctions with bids, organiser close-and-award, winner checkout links and secure AUD card checkout.
- Paid monthly or annual memberships with automatic Stripe renewals and self-service renewal cancellation.
- Online stores with product listings, inventory reservations, Australian delivery checkout and order fulfilment.
- Donor segments and consent-aware email campaigns with scheduling, unsubscribe links and engagement reporting.

KutumbLink charges A$0 in platform and subscription fees. Payment providers may still charge transaction fees under the organisation's provider agreement. Raffle sales are not included because Australian gaming requirements vary by state and territory. Membership renewal amounts and intervals are shown before checkout; members can request a secure self-service cancellation link.

The fundraising overview links to clearly labelled sample previews for all seven tools. These fictional examples are for page/layout demonstrations only: they do not create real records, send email, accept bids or process payments. To use live data, configure PostgreSQL, set up an approved organisation, sign in to **Organiser → Fundraising**, and configure Stripe/SMTP as needed. A blank demo database will not show real campaigns, auction listings, products or memberships until an organiser publishes them.

## Requirements

- Node.js 18 or later and npm.
- PostgreSQL 14 or later (Neon or another PostgreSQL service is supported).
- A database role able to create and alter tables in the selected schema.

## Quick start on Windows

1. Extract the complete ZIP to a writable folder. Do not run the launcher from the ZIP preview.
2. Install Node.js 18+ and create a PostgreSQL database.
3. Run `app.cmd`. On its first run it copies `.env.example` to `.env` and pauses for configuration.
4. Set `DATABASE_URL`, a strong `ADMIN_PASSWORD`, and independent random values for `JWT_SECRET` and `ENCRYPTION_KEY` in `.env`. Save it and run `app.cmd` again.

The launcher installs locked dependencies, applies the schema and migrations, verifies that every JavaScript/CSS bundle referenced by `dist/index.html` exists, rebuilds an incomplete/stale frontend, starts the server and opens `http://localhost:8080`. Press Ctrl+C in the launcher window to stop it. Keep `.env` private and never include it in a shared package. Do not remove files from `public/` or `dist/` by hand: `public/` contains static files used by the site, while `dist/` must remain a complete matching build.

Useful launcher modes:

| Command | Action |
| --- | --- |
| `app.cmd` | Start; install/build only when missing |
| `app.cmd install` | Reinstall locked npm dependencies |
| `app.cmd rebuild` | Rebuild the production frontend |

## Run manually or develop

From the project root:

```sh
copy .env.example .env   # Windows PowerShell: Copy-Item .env.example .env
# Edit .env before continuing.
npm ci
npm run migrate
npm run build
npm start
```

For frontend-only development use `npm run dev`. For frontend and API together use `npm run dev-full`. The production server serves `dist/` and listens on `PORT` (8080 by default). Set `PUBLIC_BASE_URL` to the public HTTPS origin in a deployed environment. The included `Dockerfile` builds the frontend and starts the server after running the database migration; persist `DATA_ROOT` if using a separate writable data volume.

## Environment settings

Start from `.env.example`; edit the existing entries and do not add duplicate keys.

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string; required. |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | Initial platform administrator created on first migration only. Changing these later does not reset an existing account. |
| `JWT_SECRET` | Signs admin/session tokens. Set a strong private value. |
| `ENCRYPTION_KEY` | Encrypts saved integration secrets. Keep stable across restarts and retain securely with backups. |
| `NODE_ENV` | Runtime environment (`development` locally; `production` when deployed). |
| `PORT` | HTTP port; defaults to 8080. |
| `PUBLIC_BASE_URL` | Public HTTPS origin used for payment return URLs, fundraising email unsubscribe/tracking links and externally fetched WhatsApp documents. |
| `KUTUMBLINK_FEATURE_ORGANISATIONS`, `KUTUMBLINK_FEATURE_SUPPORTER_IDENTITY` | Rollout switches for the organisation and supporter-identity APIs. Organisation workspace defaults to enabled; set a switch to `false` to disable it. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM` | Optional SMTP delivery for receipts, registration and system email. |
| `ADMIN_ALERT_EMAIL` | Optional destination for operational alerts. |
| `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_SENDER_NUMBER` | Optional Meta WhatsApp Cloud API integration. |

Payment, Open Banking and Google Drive integration credentials are managed in the authenticated platform settings UI and stored encrypted. Do not commit `.env`, credentials, exported supporter data, or real bank statements.

## Database and application data

`npm run migrate` (also run by the Windows launcher and Docker startup) applies `server/db/schema.sql`, performs the guarded first-time seed from `server/db/seed.sql`, and applies ordered SQL migrations from `server/db/migrations`. Migration files are recorded in `kutumb_schema_migrations`. Back up the target database before the first deployment or schema change, then review the migration output. The initial administrator is created only when its email is not already present.

Most structured records are in PostgreSQL. The source package contains no bundled `server/data` or `src/data` directories. User uploads and downloadable manuals are stored in the runtime writable directory configured by `DATA_ROOT` (default: `server/runtime-data`); set it to a persistent volume in deployed environments. Keep PostgreSQL and that runtime directory backed up.

Back up PostgreSQL and any configured persistent `DATA_ROOT`. Media stored in `kutumb_media_files` counts toward database storage. Never restore an old database over newer production data without first taking a separate backup.

## Payments, donations and Australian requirements

Configure Stripe, Square, PayPal and payment-method switches in **Admin → Platform Console → Settings / API Keys**. Use each provider's sandbox first. Set the Stripe webhook URL to `/api/ticketing/stripe/webhook`, use the same signing secret configured in KutumbLink, and enable `checkout.session.completed`, `checkout.session.expired`, `invoice.paid`, `invoice.payment_failed`, `customer.subscription.updated`, `customer.subscription.deleted`, and `charge.refunded`. This signature-verified endpoint handles donations, auction/store checkouts and memberships. Verify payment from the server-side status/webhook before treating it as paid. Bank transfer and reconciliation workflows are separate. Keep provider credentials and webhook signing secrets private.

Charity profile approval is a KutumbLink review; it does not establish ACNC registration, deductible gift recipient (DGR) endorsement, or eligibility for a tax deduction. Do not promise tax-deductible receipts unless the recipient and gift qualify. Australian fundraising and gaming rules differ between states and territories; raffle sales are disabled in this package pending those controls.

## Email and WhatsApp

SMTP is optional. Without it, database registration/payment workflows can still operate, but email delivery is unavailable. Set the SMTP variables above and restart the server. Check `GET /api/email/status`; an authenticated admin can send a test message with `POST /api/email/test-send` and a JSON `to` address. Confirm delivery before enabling reminders or campaign emails. Fundraising email requires an organisation legal name, working contact email, postal address and configured public HTTPS base URL. Campaigns include only supporters with current email consent and exclude opt-outs.

WhatsApp uses Meta's Cloud API. Set its token, phone-number ID and sender number, then use `GET /api/whatsapp/status` to diagnose readiness. `PUBLIC_BASE_URL` must be reachable over HTTPS so Meta can fetch document links; localhost will not work. Meta's recipient and messaging-window/template rules apply. Use a test number before production.

Event reminder, unpaid-registration cancellation and welcome-message controls are under the admin automatic-registration-email settings. Review each event's switches and preview due messages before enabling cancellation. Email delivery requires working SMTP.

## Bank reconciliation integrations

- **Open Banking (openfeed):** connect through **Admin → Platform Console → API Keys → Live Bank Feed (openfeed)**. Register the application with the least required read-only banking scope, connect the approved account on the live site, and test with **Sync now**. Scheduled sync and consent depend on the provider. Review its current service terms and charges.
- **Bank statement Drive drop box:** from the bank file drop box settings, copy the generated Google Apps Script into a private Apps Script project and run its installer. Share the Drive folder only with trusted uploaders: importing a statement can reconcile and mark registrations paid. The public site must be reachable by the script. CSV/XLS/XLSX statements are supported; PDF statements are not.
- **Manual statement import:** upload a supported statement from the admin reconciliation screen. Unmatched credits remain available for later matching; overlapping imports are deduplicated.

## Admin and CSV tools

Use `/admin` for platform administration and `/organiser` for the organisation workspace. API authorization is enforced server-side; hiding a page or navigation link does not grant or remove API access. Organisation roles are scoped to their organisation. Use the admin Data Management area to download the sample CSVs under `public/sample-csv`, validate imports, and review the import preview before committing. Imports are limited and transactional. Payment, banking, audit, ticket-order, refund and settlement records are protected and must use their dedicated workflows.

## Build validation

```sh
npm run build
npm run lint
npm run verify:dist
```

Before launch, validate onboarding and role boundaries, donation/ticket payments plus provider webhooks, emails, QR check-in, refunds, statement reconciliation, backups and restore against staging and provider sandboxes. The lint script currently reports project-wide issues, including explicit `any` violations; resolve them before adopting a strict lint gate.

## Deployment checklist

- Use HTTPS and set `NODE_ENV=production`, `PUBLIC_BASE_URL`, `PORT`, and strong independent secrets.
- Restrict database access; back up PostgreSQL and persistent media/data; confirm the runtime can create/alter schema objects before migration.
- Configure provider sandbox/live credentials deliberately, verify webhook signatures, and run end-to-end transactions before opening public checkout.
- Verify SMTP, receipt content, opt-in/consent behavior, admin alerts and support contact details.
- Keep `.env`, bank statements, private Drive scripts, provider keys and supporter exports out of source control and shared ZIPs.
- Confirm public charity statements, DGR/tax claims, privacy notices and state/territory fundraising obligations with the responsible organisation.

## Project layout

- `src/` — React website, pages and UI components.
- `server/server.js`, `server/routes/`, `server/lib/` — Express server and API services.
- `server/db/schema.sql`, `server/db/seed.sql`, `server/db/migrations/` — database structure, initial seed and additive migrations, including `013_fundraising_suite.sql`.
- `public/` — public static media, static files and sample CSV imports.
- `server/runtime-data/` — created at runtime for user uploads and manuals; not included in the source package.
- `dist/` — production frontend generated by `npm run build`.
