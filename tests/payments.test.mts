import test from "node:test";
import assert from "node:assert/strict";
import { PayPal, type PayPalResource } from "../lib/paypal.ts";
import { createPayments } from "../lib/payments-core.ts";
import { consent, propose, seed, type Studio } from "../lib/domain.ts";
import { memoryStore } from "./support/memory-store.mts";
import { USD, fakePayPal, ok } from "./support/fake-paypal.mts";

const OWNER = "test-owner";
const ORIGIN = "https://makeroom.test";
const ORDERS = "/v2/checkout/orders";
const ORDER_PAYER = {
  id: "ORD",
  status: "PAYER_ACTION_REQUIRED",
  links: [
    {
      rel: "payer-action",
      href: "https://www.sandbox.paypal.com/checkoutnow?token=ORD",
    },
  ],
};
const ORDER_APPROVED = { id: "ORD", status: "APPROVED", purchase_units: [{}] };
const ORDER_AUTH = (as: string, caps?: PayPalResource[]) => ({
  id: "ORD",
  status: "COMPLETED",
  purchase_units: [
    {
      payments: {
        authorizations: [{ id: "AUTH", status: as, amount: USD("145.00") }],
        ...(caps ? { captures: caps } : {}),
      },
    },
  ],
});
const CAP = (status: string) => ({
  id: "CAPN",
  status,
  amount: USD("145.00"),
});
const REF = (id: string, status: string, value: string) => ({
  id,
  status,
  amount: USD(value),
});

type Body = {
  amount?: { value: string };
  purchase_units?: { amount: { value: string } }[];
};
/** A sandbox studio with both original bookings funded and both moves accepted. */
function fundedStudio(): Studio {
  const s = seed();
  s.mode = "sandbox";
  s.bookings[0].captureId = "CAP-A";
  s.bookings[1].captureId = "CAP-B";
  const p = propose(s, s.request);
  for (const m of p.moves) consent(s, m.token, "accepted");
  return s;
}
function setup(shape: (s: Studio) => void = () => {}) {
  const store = memoryStore();
  const fake = fakePayPal();
  const s = fundedStudio();
  shape(s);
  store.put(OWNER, s);
  const payments = createPayments({
    paypal: () => new PayPal({ clientId: "test", secret: "test" }, fake.send),
    readStudio: store.readStudio,
    updateStudio: store.updateStudio,
  });
  return { store, fake, payments, studio: () => store.get(OWNER) };
}

test("H1: the happy path keeps the recorded PayPal call sequence and keys", async () => {
  const { fake, payments, studio } = setup();
  fake
    .on("POST " + ORDERS, ok(ORDER_PAYER, 201))
    .on("GET " + ORDERS + "/ORD", ok(ORDER_APPROVED))
    .on("POST " + ORDERS + "/ORD/authorize", ok(ORDER_AUTH("CREATED"), 201))
    .on(
      "POST /v2/payments/authorizations/AUTH/capture",
      ok(CAP("COMPLETED"), 201),
    )
    .on("GET /v2/payments/captures/CAPN", ok(CAP("COMPLETED")))
    .on(
      "POST /v2/payments/captures/CAP-A/refund",
      ok(REF("RA", "COMPLETED", "15.00"), 201),
    )
    .on(
      "POST /v2/payments/captures/CAP-B/refund",
      ok(REF("RB", "COMPLETED", "10.00"), 201),
    );
  let s = await payments.beginCheckout(OWNER, ORIGIN);
  assert.equal(s.plan?.orderId, "ORD");
  assert.equal(
    s.plan?.approvalUrl,
    "https://www.sandbox.paypal.com/checkoutnow?token=ORD",
  );
  s = await payments.finishApproval(OWNER, "ORD");
  assert.equal(s.plan?.status, "authorized");
  assert.equal(s.plan?.authorizationId, "AUTH");
  s = await payments.captureAndSettle(OWNER);

  assert.deepEqual(fake.routes(), [
    "POST /v2/checkout/orders",
    "GET /v2/checkout/orders/ORD",
    "POST /v2/checkout/orders/ORD/authorize",
    "POST /v2/payments/authorizations/AUTH/capture",
    "GET /v2/payments/captures/CAPN",
    "POST /v2/payments/captures/CAP-A/refund",
    "POST /v2/payments/captures/CAP-B/refund",
  ]);
  assert.equal(fake.tokens, 7, "each PayPal request gets its own token");
  const p = studio().plan!;
  const keys = fake.calls.filter((c) => c.method === "POST").map((c) => c.key);
  assert.deepEqual(keys, [
    p.orderKey,
    p.authorizeKey,
    p.captureKey,
    p.moves[0].refundKey,
    p.moves[1].refundKey,
  ]);
  assert.equal(new Set(keys).size, 5, "every mutation has its own key");
  assert.ok(fake.calls.every((c) => c.method === "POST" || c.key === null));
  const [order, , , capture, , refundA, refundB] = fake.calls.map(
    (c) => c.body as Body,
  );
  assert.equal(order.purchase_units?.[0].amount.value, "145.00");
  assert.deepEqual(capture, { final_capture: true });
  assert.equal(refundA.amount?.value, "15.00");
  assert.equal(refundB.amount?.value, "10.00");
  assert.ok(!fake.routes().some((r) => r.endsWith("/void")));
  assert.equal(s.plan?.status, "complete");
  assert.equal(p.status, "complete");
  assert.equal(p.committed, true);
  assert.equal(p.error, undefined);
  assert.deepEqual(
    studio().bookings.map((b) => [b.start, b.refunded]),
    [
      [780, 1500],
      [960, 1000],
    ],
  );
  assert.equal(studio().operation, undefined, "the payment lock is released");
  assert.deepEqual(fake.unexpected, []);
  assert.deepEqual(fake.pending(), []);
});
