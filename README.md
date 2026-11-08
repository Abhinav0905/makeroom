# MakeRoom

A little flexibility. One more booking.

MakeRoom helps a small studio fit a new booking into a fragmented calendar. It reads customer flexibility messages, proposes a valid arrangement, asks each affected customer for approval and pays agreed compensation as partial refunds to their original PayPal payments.

The example is narrow on purpose: one photography room, two prepaid appointments and one new request on November 12, 2026. Alex moves 2 pm to 1 pm for $15 back; Sam moves 3 pm to 4 pm for $10 back. Maya can then book 2–4 pm for $145. The studio adds $120 in gross booking revenue before fees and taxes.

## Run locally

Use Node 22.18+ or Node 24+. Install dependencies with `npm ci`. Create an ignored `.dev.vars` file:

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
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_open_prima.sql
npm run dev -- --port 5177
```

Open http://127.0.0.1:5177 and select **Open my studio**. Local sign-in uses the starter's loopback-only test identity. Production uses Sites authentication and request headers supplied by its gateway. Do not expose the local development server to the internet.

Start in practice mode. Connections can activate PayPal sandbox when credentials are present. The Customers screen funds the two original bookings. See [the demo walkthrough](docs/DEMO.md).

## What runs where

- React and Vinext render the studio calendar, preference review, customer offers and payment history.
- Cloudflare Workers run the API. D1 persists per-user studios, scoped offer links, transaction identifiers and the audit record.
- Gemini proposes structured time/refund terms with exact source quotations. The response passes schema, opening-hours, time-grid and refund-limit checks. A person must review it before saving. Reviewed seed data works without a model connection and is labeled accordingly.
- A deterministic bounded search checks all allowed combinations, picks the lowest compensation cost and breaks ties by fewer moves. It never creates an alternative that was not reviewed.
- PayPal Orders v2 creates original prepayments and authorizes the new booking. Payments v2 captures the authorization and partially refunds the two original captures.

## Payment and consent boundaries

The original calendar stays unchanged until every affected customer accepts the current offer and the server reads back a completed capture with the expected USD amount. Offers expire after 30 minutes. Replacing terms invalidates earlier links.

Payment operations use a D1 compare-and-swap lock, durable PayPal request IDs and a separate readback of payment results. A timeout is an unknown outcome, not proof of failure. The payment check retrieves existing records before retrying refunds. An unknown refund older than five hours stops for manual review rather than risking a duplicate after PayPal's idempotency window.

Capture and refunds are separate operations. If the charge succeeds but a refund is pending or fails, the booking remains confirmed and the UI reports outstanding settlement. Sandbox financial records cannot be reset. No live payment endpoint is present.

Customer offer links are bearer capabilities: anyone holding a link can answer that single offer. They do not reveal the other customers or the studio ledger. The current private deployment requires the owner to sign in at the site gateway, so external customer testing needs a separately approved sharing change.

## Verification

```sh
npm test
npm run typecheck
npm run lint
npm run build
```

Tests cover planning constraints across the time grid, price and refund limits, consent expiry/refusal/replacement, payment gating, AI output validation, sandbox-only calls, idempotency keys and ambiguous provider failures. They do not prove real-world demand or model accuracy. See [verification notes](docs/VERIFICATION.md) for the observed account-backed checks.

## Current scope

This is a hackathon prototype with fictional customers. It is not a production scheduling or payments service. It has no calendar import, multi-resource scheduling, external customer identity verification, tax calculation or automated dispute handling. Payment recovery uses on-demand API readback; no webhook delivery is claimed. The hosted AI connection depends on provider access.

MakeRoom's combination of consent, scheduling and original-payment refunds is the focus. Paid rescheduling and waitlists already exist; this project does not claim to have invented them.

## License and credits

MIT. Manrope is distributed under the SIL Open Font License in `public/fonts/OFL.txt`. The project uses the Sites Vinext starter, React, Lucide, Drizzle and Cloudflare D1. Vendored starter files keep their original notices.
