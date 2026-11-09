# Verification record

Checked November 8 and 9, 2026. All customers and transactions below belong to the fictional studio demonstration.

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

## PayPal sandbox, second run (November 9, 2026)

A fresh local workspace, separate from the November 8 records, ran the whole flow again with the updated code and was recorded for the demo video. The three fictional customers paid as PayPal guest checkouts on PayPal's own sandbox checkout page, using a published sandbox test card; no PayPal account was created. Authenticated GET requests then read every result back from PayPal:

| Step | PayPal ID | Amount | Readback |
| --- | --- | --- | --- |
| Alex original prepayment | `71Y081377T278070C` | USD 60.00 | PARTIALLY_REFUNDED |
| Sam original prepayment | `6MC46836RT877864B` | USD 60.00 | PARTIALLY_REFUNDED |
| Maya's order (intent AUTHORIZE) | `3SE28460TW205160U` | USD 145.00 | COMPLETED |
| Maya's capture | `8HA81230165383331` | USD 145.00 | COMPLETED |
| Partial refund to Alex | `2M789313EJ2559441` | USD 15.00 | COMPLETED |
| Partial refund to Sam | `7G359565H3880444P` | USD 10.00 | COMPLETED |

Readback time: 2026-11-09T20:56:06.607Z. [The readback record](evidence/paypal-readback-run2-2026-11-09.json) keeps the GET requests, HTTP statuses, IDs and amounts, without credentials or buyer details. No live money moved.

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

## AI step after the messy-message update

Checked November 9, 2026. Since the record above, the AI step changed:

- Alex's practice message is messy: 1 pm for $15, 4 pm for $20 and 4:30 pm for $20. The reviewed seed terms are 1 pm / $15 and 4 pm / $20. The planner still moves Alex to 1 pm for $15 and Sam to 4 pm for $10.
- The prompt includes the booking's current start. Each alternative in the reply is checked on its own: a time outside opening hours, off the 15-minute grid, at the current start or above the refund limit is set aside with a plain reason, and the other times stay available. Format errors, a missing quotation, or a clarification together with times still reject the whole reply with a specific message.
- The owner sees and can save every alternative, not only the first. The model's free-text explanation is no longer shown as the result.
- Quotations are matched ignoring case, spacing, curly quotes and Unicode compatibility forms. The stored and displayed quotation is the customer's exact text.
- Saved AI-sourced terms keep their quotations, including when the same terms are saved again.

The eight-message result above was measured before these changes. `scripts/evaluate-ai.mts` now has ten cases: the eight above, Alex's messy message (expected 1 pm / $15 and 4 pm / $20, with 4:30 pm set aside) and a counter-offer ("$10 isn't really enough... Make it $25 back"). Against `gemini-2.5-flash` with the new prompt, all ten matched the expected alternatives, set-aside times and clarification behavior in each of three runs on November 9, 2026. This is still a small smoke evaluation, not a measured accuracy claim.

## Local checks

- 120 automated tests pass, including a sweep across valid time-grid scenarios, guest payment restrictions, 68 payment-state tests and 20 tests of the AI checks (quotation matching, set-aside reasons, provider failure messages and keeping quotations on save). The payment-state tests run each payment step against a scripted PayPal sandbox inside the test process, with no network calls: the recorded happy-path call sequence and request IDs, the same calls and request IDs when Maya pays from her own checkout link, recovery from timeouts, declines, pending results and lost redirects, voids and cancels, and each customer's refund on its own. Six more tests check which payment buttons and links the studio shows, and six check Maya's checkout link: a new secret link per plan, what the page shows, and when a practice payment is refused.
- TypeScript check passed.
- ESLint passed.
- Practice journey completed in Chrome, including separate customer offers and simulated settlement.
- Before public guest access was added, unauthenticated and forged-identity requests returned 401. A cross-origin mutation returned 403. The public build permits isolated guest practice records and blocks guest PayPal operations.
- PayPal credentials and Gemini key stay in ignored local environment data and hosted server secrets.

## Not established

No real studio has validated demand. No external customer pilot, real-money checkout, dispute test or load test has been run. Model responses can still misinterpret customer language. There is no claim of webhook delivery, calendar-platform integration, tax calculation or a production accounting ledger.

## GitHub Pages frontend

The public React app is also built as static files for GitHub Pages. The automated tests include three for the Pages origin allowlist, practice-only identity namespace and absence of credentialed CORS. Server secrets remain in the API environment.

Thirteen API integration checks also passed against the deployed service with the GitHub Pages origin: planning, both separate customer approvals, practice settlement, studio isolation, preflight, unrelated-origin rejection and PayPal mutation denial. The Cloudflare edge may set its own bot-management cookie; the Pages client omits credentials, the API does not set an application studio cookie, and credentialed CORS is not enabled.
