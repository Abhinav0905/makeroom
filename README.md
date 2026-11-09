# MakeRoom

A little flexibility. One more booking.

MakeRoom helps a small studio fit a new booking into a fragmented calendar. It reads customer flexibility messages, proposes a valid arrangement, asks each affected customer for approval and pays agreed compensation as partial refunds to their original PayPal payments.

The example is narrow on purpose: one photography room, two prepaid appointments and one new request on November 12, 2026. Alex moves 2 pm to 1 pm for $15 back; Sam moves 3 pm to 4 pm for $10 back. Maya can then book 2–4 pm for $145. The studio adds $120 in gross booking revenue before fees and taxes.

## Try the public demo

Open [MakeRoom](https://abhinav0905.github.io/makeroom/). No account or API key is needed for the guest practice studio. Each browser gets a separate fictional studio identified by a random practice ID in local storage. Practice payments are simulated. The AI reader makes actual Gemini calls, limited to 20 per studio and 200 across the demo per UTC day; reviewed terms and the planner work after that allowance is used.

Choose **Customers**, read Alex's message with AI and review/save the result. Return to **Studio day**, find an arrangement, open and accept both customer offers, then complete the practice booking. Reset in **Connections** to try a $20 compensation budget or refuse an offer.

The [sandbox evidence page](https://abhinav0905.github.io/makeroom/?view=proof) shows the completed account-backed PayPal run. Run locally with your own PayPal test accounts for a new sandbox run.

[Watch the public demo video](https://youtu.be/yYuYDVw0iVs) (2 minutes 48 seconds). It starts with what MakeRoom does, then shows the app workflow, PayPal's own sandbox API logs and both completed refund responses. See [the matching PayPal records and IDs](docs/PAYPAL-EVIDENCE.md).

## Run locally

Use Node 22.18+ or Node 24+. Clone this repository and install dependencies with `npm ci`. Practice mode works without keys. To test the AI and PayPal integrations, create an ignored `.dev.vars` file:

```dotenv
PAYPAL_CLIENT_ID=your-sandbox-client-id
PAYPAL_CLIENT_SECRET=your-sandbox-secret
# Optional until an AI provider is connected:
GEMINI_API_KEY=your-key
GEMINI_MODEL=gemini-2.5-flash
```

Never place these values in browser code, a public repository or a demo recording.

Build once, create the local tables, then start development:

```sh
npm run build
npm run db:local
npm run dev -- --port 5177
```

Open http://127.0.0.1:5177 for the guest practice studio. For PayPal, select **Connections → Sign in**. Local sign-in uses the starter's loopback-only test identity. Production uses Sites authentication and request headers supplied by its gateway. Do not expose the local development server to the internet.

Start in practice mode. Connections can activate PayPal sandbox when credentials are present. The Customers screen funds the two original bookings. See [the demo walkthrough](docs/DEMO.md).

## What runs where

- GitHub Pages serves the React app: the studio calendar, preference review, customer offers and payment history. The same components also run in the Vinext server app.
- Cloudflare Workers run the API behind the Pages app. GitHub Pages cannot execute server code. API keys stay on the server. D1 persists per-user studios, scoped offer links, transaction identifiers and the audit record.
- Gemini proposes structured time/refund terms with exact source quotations. The response passes schema, opening-hours, time-grid and refund-limit checks. A person must review it before saving. Reviewed seed data works without a model connection and is labeled accordingly.
- A deterministic bounded search checks all allowed combinations, picks the lowest compensation cost and breaks ties by fewer moves. It never creates an alternative that was not reviewed.
- PayPal Orders v2 creates original prepayments and authorizes the new booking. Payments v2 captures the authorization and partially refunds the two original captures.

## GitHub Pages deployment

The public frontend is built with `npm run build:pages` and published by `.github/workflows/pages.yml`. It uses query-string routes so customer links and the evidence page work on a static host. The API origin is configured in `github-pages/main.tsx`; CORS allows only `https://abhinav0905.github.io`. Pages requests omit cookies and are always assigned a separate `pages:` practice identity, even if the visitor is signed into the server app. They cannot call PayPal mutations or view signed-in sandbox offers. No server secret is included in the Pages build.

The API and database continue to run on Cloudflare Workers through the existing Sites deployment. Local/server setup remains available for account-backed sandbox testing.

## Payment and consent boundaries

The original calendar stays unchanged until every affected customer accepts the current offer and the server reads back a completed capture with the expected USD amount. Offers expire after 30 minutes. Replacing terms invalidates earlier links.

Payment operations use a D1 compare-and-swap lock, durable PayPal request IDs and a separate readback of payment results. A timeout is an unknown outcome, not proof of failure. The payment check retrieves existing records before retrying refunds. An unknown refund older than five hours stops for manual review rather than risking a duplicate after PayPal's idempotency window.

Each customer's refund is handled on its own, so one refused or failed refund does not hold up the others. A refund PayPal refused or reported as failed is retried once per payment check with a new request ID; a timeout keeps the same ID, and if PayPal refuses that repeat, the refund stops for manual review instead of getting a new ID. If a payment step ends in review, the payment check reads the order, authorization and capture back from PayPal and moves the offer to what PayPal shows: confirmed, still pending, authorized again or cancelled. Cancelling voids the hold with its own request ID and counts only once PayPal confirms the void.

Capture and refunds are separate operations. If the charge succeeds but a refund is pending or fails, the booking remains confirmed and the UI reports outstanding settlement. Sandbox financial records cannot be reset. No live payment endpoint is present.

Customer offer links are bearer capabilities: anyone holding a link can answer that single offer. They do not reveal the other customers or the studio ledger. Guest practice records are isolated from signed-in studios and cannot invoke PayPal mutations. The hosted site is public; send offer links only to the intended recipient.

## Verification

```sh
npm test
npm run typecheck
npm run lint
npm run build
```

Tests cover planning constraints across the time grid, price and refund limits, consent expiry/refusal/replacement, payment gating, AI output validation, sandbox-only calls, idempotency keys and ambiguous provider failures. They do not prove real-world demand or model accuracy. Payment-state tests run the payment steps against a scripted PayPal sandbox: the recorded happy-path call sequence, recovery from timeouts, declines and lost redirects, voids and per-customer refunds. See [verification notes](docs/VERIFICATION.md) for the observed account-backed checks.

## Current scope

This is a hackathon prototype with fictional customers. It is not a production scheduling or payments service. It has no calendar import, multi-resource scheduling, external customer identity verification, tax calculation or automated dispute handling. Payment recovery uses on-demand API readback; no webhook delivery is claimed. The hosted AI connection depends on provider access.

MakeRoom's combination of consent, scheduling and original-payment refunds is the focus. Paid rescheduling and waitlists already exist; this project does not claim to have invented them.

## License and credits

MIT. Manrope is distributed under the SIL Open Font License in `public/fonts/OFL.txt`. The project uses the Sites Vinext starter, React, Lucide, Drizzle and Cloudflare D1. Vendored starter files keep their original notices.
