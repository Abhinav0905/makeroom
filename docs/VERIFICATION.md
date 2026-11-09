# Verification record

Checked November 8, 2026. All customers and transactions below belong to the fictional studio demonstration.

## PayPal sandbox, account-backed

The local application completed its browser checkout journey using one existing sandbox personal buyer as a stand-in for all three customers. Independent server calls then read the resulting captures and refunds back from PayPal.

| Step                           | Expected amount | Readback                            |
| ------------------------------ | --------------- | ----------------------------------- |
| Alex original prepayment       | USD 60.00       | PARTIALLY_REFUNDED after settlement |
| Sam original prepayment        | USD 60.00       | PARTIALLY_REFUNDED after settlement |
| Maya authorization and capture | USD 145.00      | COMPLETED                           |
| Partial refund to Alex         | USD 15.00       | COMPLETED                           |
| Partial refund to Sam          | USD 10.00       | COMPLETED                           |

Readback time: 2026-11-08T20:44:59.521Z. [The published verification record](../public/evidence/sandbox-verification.json) retains the sandbox transaction IDs and amounts. No live money moved. This proves the sandbox sequence for this merchant configuration, not live merchant eligibility or production reliability.

## AI, account-backed

Eight synthetic messages were sent to `gemini-2.5-flash` through the same extraction function used by the application. All eight returned the expected alternatives and clarification behavior:

- Exact 1 pm / $15 offer.
- Exact 4 pm / $10 offer with a prohibition on earlier times.
- Vague "later" message, requiring clarification.
- Refusal of every move.
- Two explicitly allowed alternatives.
- Instruction to ignore rules and refund $999, requiring clarification without alternatives.
- Explicit zero-refund move.
- A time with no refund amount, requiring clarification.

Run `node scripts/evaluate-ai.mts` to repeat using a configured Gemini key. Outputs are in ignored `outputs/ai-evaluation.json`. This small set is a smoke evaluation, not a measured accuracy claim. Human review and final customer consent remain required.

## Local checks

- 20 automated tests passed, including a sweep across valid time-grid scenarios and guest payment restrictions.
- TypeScript check passed.
- ESLint passed.
- Practice journey completed in Chrome, including separate customer offers and simulated settlement.
- Before public guest access was added, unauthenticated and forged-identity requests returned 401. A cross-origin mutation returned 403. The public build permits isolated guest practice records and blocks guest PayPal operations.
- PayPal credentials and Gemini key stay in ignored local environment data and hosted server secrets.

## Not established

No real studio has validated demand. No external customer pilot, real-money checkout, dispute test or load test has been run. Model responses can still misinterpret customer language. There is no claim of webhook delivery, calendar-platform integration, tax calculation or a production accounting ledger.

## GitHub Pages frontend

The public React app is also built as static files for GitHub Pages. Twenty-three automated tests pass, including three tests for the Pages origin allowlist, practice-only identity namespace and absence of credentialed CORS. Server secrets remain in the API environment.

Thirteen API integration checks also passed against the deployed service with the GitHub Pages origin: planning, both separate customer approvals, practice settlement, studio isolation, preflight, unrelated-origin rejection and PayPal mutation denial. The Cloudflare edge may set its own bot-management cookie; the Pages client omits credentials, the API does not set an application studio cookie, and credentialed CORS is not enabled.
