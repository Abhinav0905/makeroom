import test from "node:test";
import assert from "node:assert/strict";
import { PayPal, PayPalError, type PayPalResource } from "../lib/paypal.ts";
import { createPayments } from "../lib/payments-core.ts";
import { canCheckCancelledHold } from "../lib/plan-ui.ts";
import {
  assertEditable,
  commit,
  consent,
  propose,
  seed,
  type Studio,
} from "../lib/domain.ts";
import { memoryStore } from "./support/memory-store.mts";
import {
  TIMEOUT,
  USD,
  err,
  fakePayPal,
  ok,
  type Reply,
} from "./support/fake-paypal.mts";

const OWNER = "test-owner";
const ORIGIN = "https://makeroom.test";
const APPROVAL = "https://www.sandbox.paypal.com/checkoutnow?token=ORD";
// PayPal routes, as "METHOD path".
const CREATE = "POST /v2/checkout/orders";
const GET_ORDER = "GET /v2/checkout/orders/ORD";
const AUTHORIZE = "POST /v2/checkout/orders/ORD/authorize";
const CAPTURE = "POST /v2/payments/authorizations/AUTH/capture";
const VOID = "POST /v2/payments/authorizations/AUTH/void";
const GET_CAP = "GET /v2/payments/captures/CAPN";
const REFUND_A = "POST /v2/payments/captures/CAP-A/refund";
const REFUND_B = "POST /v2/payments/captures/CAP-B/refund";
const GET_REFUND_A = "GET /v2/payments/refunds/RA";

const ORDER_PAYER = {
  id: "ORD",
  status: "PAYER_ACTION_REQUIRED",
  links: [{ rel: "payer-action", href: APPROVAL }],
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
const CAP = (status: string, id = "CAPN") => ({
  id,
  status,
  amount: USD("145.00"),
});
const REF = (id: string, status: string, value: string) => ({
  id,
  status,
  amount: USD(value),
});
const VOIDED = { id: "AUTH", status: "VOIDED", amount: USD("145.00") };

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
/** The buyer has a PayPal checkout for the plan. */
function withOrder(s: Studio) {
  s.plan!.orderId = "ORD";
  s.plan!.approvalUrl = APPROVAL;
}
/** The buyer's payment is on hold as AUTH. */
function authorized(s: Studio) {
  withOrder(s);
  s.plan!.status = "authorized";
  s.plan!.authorizationId = "AUTH";
  delete s.plan!.approvalUrl;
}
/** Booking confirmed against CAPN; refunds not yet attempted. */
function committed(s: Studio) {
  authorized(s);
  s.plan!.captureId = "CAPN";
  s.plan!.captureStatus = "COMPLETED";
  commit(s);
}
function setup(
  shape: (s: Studio) => void = () => {},
  now?: () => number,
) {
  const store = memoryStore();
  const fake = fakePayPal();
  const s = fundedStudio();
  shape(s);
  store.put(OWNER, s);
  const payments = createPayments({
    paypal: () => new PayPal({ clientId: "test", secret: "test" }, fake.send),
    readStudio: store.readStudio,
    updateStudio: store.updateStudio,
    now,
  });
  return { store, fake, payments, studio: () => store.get(OWNER) };
}
type Fake = ReturnType<typeof fakePayPal>;
/** Both agreed refunds succeed. */
function refundsComplete(fake: Fake, a: Reply = ok(REF("RA", "COMPLETED", "15.00"), 201)) {
  fake.on(REFUND_A, a).on(REFUND_B, ok(REF("RB", "COMPLETED", "10.00"), 201));
}
/** Every queued reply was used and nothing else was requested. */
function done(fake: Fake) {
  assert.deepEqual(fake.unexpected, []);
  assert.deepEqual(fake.pending(), []);
}
const starts = (s: Studio) => s.bookings.map((b) => b.start);
const refunded = (s: Studio) => s.bookings.map((b) => b.refunded);
const uncertain = (e: unknown) => e instanceof PayPalError && e.uncertain;

test("H1: the happy path keeps the recorded PayPal call sequence and keys", async () => {
  const { fake, payments, studio } = setup();
  fake
    .on(CREATE, ok(ORDER_PAYER, 201))
    .on(GET_ORDER, ok(ORDER_APPROVED))
    .on(AUTHORIZE, ok(ORDER_AUTH("CREATED"), 201))
    .on(CAPTURE, ok(CAP("COMPLETED"), 201))
    .on(GET_CAP, ok(CAP("COMPLETED")));
  refundsComplete(fake);
  let s = await payments.beginCheckout(OWNER, ORIGIN);
  assert.equal(s.plan?.orderId, "ORD");
  assert.equal(s.plan?.approvalUrl, APPROVAL);
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
  done(fake);
});

// Ways out of review

for (const [label, failure] of [
  ["times out", TIMEOUT],
  ["gets a 503", err(503, "SERVICE_UNAVAILABLE")],
] as const)
  test(`R1: capture ${label}, the authorization survives, capture retries with the same key`, async () => {
    const { fake, payments, studio } = setup(authorized);
    const captureKey = studio().plan!.captureKey;
    fake.on(CAPTURE, failure);
    await assert.rejects(payments.captureAndSettle(OWNER), uncertain);
    assert.equal(studio().plan!.status, "review");
    assert.deepEqual(starts(studio()), [840, 900]);
    assert.equal(studio().operation, undefined);

    fake.on(GET_ORDER, ok(ORDER_AUTH("CREATED")));
    let s = await payments.reconcile(OWNER);
    assert.equal(s.plan!.status, "authorized");
    assert.equal(s.plan!.authorizationId, "AUTH");
    assert.equal(s.plan!.error, undefined);
    assert.equal(s.plan!.captureKey, captureKey, "no rotation after a timeout");

    fake.on(CAPTURE, ok(CAP("COMPLETED"), 201)).on(GET_CAP, ok(CAP("COMPLETED")));
    refundsComplete(fake);
    s = await payments.captureAndSettle(OWNER);
    assert.equal(s.plan!.status, "complete");
    assert.deepEqual(
      fake.to(CAPTURE).map((c) => c.key),
      [captureKey, captureKey],
    );
    done(fake);
  });

test("R2: capture times out but PayPal captured; reconcile confirms and refunds once", async () => {
  const { fake, payments, studio } = setup(authorized);
  fake.on(CAPTURE, TIMEOUT);
  await assert.rejects(payments.captureAndSettle(OWNER), uncertain);
  assert.equal(studio().plan!.status, "review");

  fake.on(GET_ORDER, ok(ORDER_AUTH("CAPTURED", [CAP("COMPLETED")])));
  refundsComplete(fake);
  const s = await payments.reconcile(OWNER);
  assert.equal(s.plan!.status, "complete");
  assert.equal(s.plan!.captureId, "CAPN");
  assert.deepEqual(starts(s), [780, 960]);
  assert.deepEqual(refunded(s), [1500, 1000]);
  assert.equal(fake.to(CAPTURE).length, 1, "no second capture");
  done(fake);
});

test("R3: cancel after recovering the authorization voids with its own key", async () => {
  const { fake, payments, studio } = setup(authorized);
  fake.on(CAPTURE, err(503, "SERVICE_UNAVAILABLE"));
  await assert.rejects(payments.captureAndSettle(OWNER));
  fake.on(GET_ORDER, ok(ORDER_AUTH("CREATED")));
  await payments.reconcile(OWNER);
  assert.equal(studio().plan!.status, "authorized");

  fake.on(VOID, ok(VOIDED));
  const s = await payments.cancelCheckout(OWNER);
  const p = s.plan!;
  assert.equal(p.status, "cancelled");
  const [voidCall] = fake.to(VOID);
  assert.ok(p.voidKey);
  assert.equal(voidCall.key, p.voidKey);
  assert.notEqual(p.voidKey, p.authorizeKey);
  assert.notEqual(p.voidKey, p.captureKey);
  assert.doesNotThrow(() => assertEditable(s));
  assert.deepEqual(starts(s), [840, 900]);
  assert.deepEqual(refunded(s), [0, 0]);
  done(fake);
});

test("R4: cancel straight from review once PayPal shows the hold is uncaptured", async () => {
  const { fake, payments, studio } = setup(authorized);
  fake.on(CAPTURE, err(503, "SERVICE_UNAVAILABLE"));
  await assert.rejects(payments.captureAndSettle(OWNER));
  assert.equal(studio().plan!.status, "review");

  fake.on(GET_ORDER, ok(ORDER_AUTH("CREATED"))).on(VOID, ok(VOIDED));
  const s = await payments.cancelCheckout(OWNER);
  assert.equal(s.plan!.status, "cancelled");
  assert.deepEqual(fake.routes().slice(1), [GET_ORDER, VOID]);
  assert.equal(fake.to(VOID)[0].key, s.plan!.voidKey);
  assert.deepEqual(starts(s), [840, 900]);
  done(fake);
});

test("R4: cancel from review is refused when PayPal shows a completed capture", async () => {
  const { fake, payments, studio } = setup(authorized);
  fake.on(CAPTURE, TIMEOUT);
  await assert.rejects(payments.captureAndSettle(OWNER));

  fake.on(GET_ORDER, ok(ORDER_AUTH("CAPTURED", [CAP("COMPLETED")])));
  refundsComplete(fake);
  await assert.rejects(
    payments.cancelCheckout(OWNER),
    /PayPal shows a payment for this booking; it was not cancelled/,
  );
  assert.equal(fake.to(VOID).length, 0);
  const s = studio();
  assert.equal(s.plan!.committed, true, "the captured payment is honoured");
  assert.equal(s.plan!.status, "complete");
  assert.equal(s.plan!.error, undefined, "a complete plan keeps no error box");
  assert.deepEqual(refunded(s), [1500, 1000]);
  assert.ok(
    s.events.some((e) => /it was not cancelled/.test(e.detail)),
    "the refused cancel is still logged",
  );
  done(fake);
});

// Cancels

for (const status of ["proposed", "expired"] as const)
  test(`C1: cancel of a ${status} checkout voids a hold PayPal has that the studio did not record`, async () => {
    const { fake, payments } = setup((s) => {
      withOrder(s);
      s.plan!.status = status;
    });
    fake.on(GET_ORDER, ok(ORDER_AUTH("CREATED"))).on(VOID, ok(VOIDED));
    const s = await payments.cancelCheckout(OWNER);
    assert.equal(s.plan!.status, "cancelled");
    assert.equal(s.plan!.authorizationId, "AUTH");
    assert.equal(s.plan!.error, undefined);
    assert.deepEqual(fake.routes(), [GET_ORDER, VOID]);
    assert.equal(fake.to(VOID)[0].key, s.plan!.voidKey);
    assert.deepEqual(starts(s), [840, 900]);
    assert.doesNotThrow(() => assertEditable(s));
    done(fake);
  });

test("C1: cancel of an open checkout the buyer never approved needs no void", async () => {
  const { fake, payments } = setup(withOrder);
  fake.on(GET_ORDER, ok(ORDER_PAYER));
  const s = await payments.cancelCheckout(OWNER);
  assert.equal(s.plan!.status, "cancelled");
  assert.equal(s.plan!.approvalUrl, undefined);
  assert.deepEqual(fake.routes(), [GET_ORDER]);
  assert.doesNotThrow(() => assertEditable(s));
  done(fake);
});

test("C1: cancel of an open checkout is refused while PayPal reviews an unrecorded authorization", async () => {
  const { fake, payments, studio } = setup(withOrder);
  fake.on(GET_ORDER, ok(ORDER_AUTH("PENDING")));
  await assert.rejects(
    payments.cancelCheckout(OWNER),
    /still reviewing this authorization; it was not cancelled/,
  );
  const s = studio();
  assert.equal(s.plan!.status, "proposed");
  assert.equal(fake.to(VOID).length, 0);
  assert.throws(() => assertEditable(s), /Finish or cancel/);
  done(fake);
});

test("C1: cancel without a PayPal checkout makes no PayPal call", async () => {
  const { fake, payments } = setup();
  const s = await payments.cancelCheckout(OWNER);
  assert.equal(s.plan!.status, "cancelled");
  assert.equal(fake.calls.length, 0);
});

test("C3: reconcile finishes the void for an offer cancelled before void keys existed", async () => {
  const { fake, payments, studio } = setup((s) => {
    authorized(s);
    s.plan!.status = "cancelled";
    delete s.plan!.voidKey;
  });
  assert.equal(canCheckCancelledHold(studio().plan!), true);
  fake.on(GET_ORDER, ok(ORDER_AUTH("CREATED"))).on(VOID, ok(VOIDED));
  const s = await payments.reconcile(OWNER);
  const p = s.plan!;
  assert.equal(p.status, "cancelled", "the offer is not revived");
  assert.ok(p.voidKey);
  assert.deepEqual(fake.routes(), [GET_ORDER, VOID]);
  assert.equal(fake.to(VOID)[0].key, p.voidKey);
  assert.notEqual(p.voidKey, p.authorizeKey);
  assert.ok(s.events.some((e) => e.title === "Authorization voided"));
  assert.equal(canCheckCancelledHold(p), false);
  assert.deepEqual(starts(s), [840, 900]);
  assert.doesNotThrow(() => assertEditable(s));
  done(fake);
});

test("C3: a failed legacy void stays checkable and a retry reuses the void key", async () => {
  const { fake, payments, studio } = setup((s) => {
    authorized(s);
    s.plan!.status = "cancelled";
    delete s.plan!.voidKey;
  });
  fake
    .on(GET_ORDER, ok(ORDER_AUTH("CREATED")))
    .on(VOID, ok({ id: "AUTH", status: "CREATED" }));
  await assert.rejects(
    payments.reconcile(OWNER),
    /PayPal did not confirm the void/,
  );
  let p = studio().plan!;
  assert.equal(p.status, "cancelled");
  assert.match(p.error ?? "", /did not confirm the void/);
  assert.equal(canCheckCancelledHold(p), true, "the check stays available");

  fake.on(GET_ORDER, ok(ORDER_AUTH("CREATED"))).on(VOID, ok(VOIDED));
  p = (await payments.reconcile(OWNER)).plan!;
  assert.equal(p.status, "cancelled");
  assert.equal(p.error, undefined);
  assert.equal(canCheckCancelledHold(p), false);
  assert.deepEqual(
    fake.to(VOID).map((c) => c.key),
    [p.voidKey, p.voidKey],
  );
  done(fake);
});

test("C3: a legacy cancelled offer PayPal shows as voided is only confirmed", async () => {
  const { fake, payments } = setup((s) => {
    authorized(s);
    s.plan!.status = "cancelled";
    delete s.plan!.voidKey;
  });
  fake.on(GET_ORDER, ok(ORDER_AUTH("VOIDED")));
  const s = await payments.reconcile(OWNER);
  assert.equal(s.plan!.status, "cancelled");
  assert.equal(fake.to(VOID).length, 0);
  assert.ok(s.events.some((e) => e.title === "No payment is held"));
  assert.equal(canCheckCancelledHold(s.plan!), false);
  done(fake);
});

test("R5: authorize fails on the PayPal return; reconcile authorizes with the same key", async () => {
  const { fake, payments, studio } = setup(withOrder);
  fake
    .on(GET_ORDER, ok(ORDER_APPROVED))
    .on(AUTHORIZE, err(503, "SERVICE_UNAVAILABLE"));
  await assert.rejects(payments.finishApproval(OWNER, "ORD"), uncertain);
  assert.equal(studio().plan!.status, "review");

  fake
    .on(GET_ORDER, ok(ORDER_APPROVED))
    .on(AUTHORIZE, ok(ORDER_AUTH("CREATED"), 201));
  const s = await payments.reconcile(OWNER);
  assert.equal(s.plan!.status, "authorized");
  assert.equal(s.plan!.authorizationId, "AUTH");
  assert.equal(s.plan!.approvalUrl, undefined);
  assert.deepEqual(
    fake.to(AUTHORIZE).map((c) => c.key),
    [s.plan!.authorizeKey, s.plan!.authorizeKey],
  );
  done(fake);
});

test("R5: reconcile does not authorize again when PayPal already holds the payment", async () => {
  const { fake, payments } = setup(withOrder);
  fake.on(GET_ORDER, ok(ORDER_APPROVED)).on(AUTHORIZE, TIMEOUT);
  await assert.rejects(payments.finishApproval(OWNER, "ORD"), uncertain);

  fake.on(GET_ORDER, ok(ORDER_AUTH("CREATED")));
  const s = await payments.reconcile(OWNER);
  assert.equal(s.plan!.status, "authorized");
  assert.equal(fake.to(AUTHORIZE).length, 1);
  done(fake);
});

test("R6: a lost approval redirect is finished by reconcile", async () => {
  const { fake, payments } = setup(withOrder);
  fake
    .on(GET_ORDER, ok(ORDER_APPROVED))
    .on(AUTHORIZE, ok(ORDER_AUTH("CREATED"), 201));
  const s = await payments.reconcile(OWNER);
  assert.equal(s.plan!.status, "authorized");
  assert.equal(fake.to(AUTHORIZE)[0].key, s.plan!.authorizeKey);
  done(fake);
});

test("R6: an expired approved offer is closed without authorizing", async () => {
  const { fake, payments } = setup((s) => {
    withOrder(s);
    s.plan!.expiresAt = new Date(Date.now() - 60_000).toISOString();
  });
  fake.on(GET_ORDER, ok(ORDER_APPROVED));
  const s = await payments.reconcile(OWNER);
  assert.equal(s.plan!.status, "cancelled");
  assert.equal(s.plan!.approvalUrl, undefined);
  assert.equal(fake.to(AUTHORIZE).length, 0);
  assert.doesNotThrow(() => assertEditable(s));
  done(fake);
});

test("R6: an order the buyer has not approved keeps the offer open", async () => {
  const { fake, payments } = setup((s) => {
    withOrder(s);
    s.plan!.status = "review";
  });
  fake.on(GET_ORDER, ok(ORDER_PAYER));
  const s = await payments.reconcile(OWNER);
  assert.equal(s.plan!.status, "proposed");
  assert.equal(s.plan!.approvalUrl, APPROVAL);
  done(fake);
});

test("R7: an order creation timeout keeps the offer open and the retry reuses the key", async () => {
  const { fake, payments, studio } = setup();
  fake.on(CREATE, TIMEOUT);
  await assert.rejects(payments.beginCheckout(OWNER, ORIGIN), uncertain);
  let p = studio().plan!;
  assert.equal(p.status, "proposed");
  assert.equal(p.orderId, undefined);
  assert.match(p.error ?? "", /did not arrive/);

  fake.on(CREATE, ok(ORDER_PAYER, 201));
  p = (await payments.beginCheckout(OWNER, ORIGIN)).plan!;
  assert.equal(p.orderId, "ORD");
  assert.equal(p.approvalUrl, APPROVAL);
  assert.equal(p.error, undefined);
  assert.deepEqual(
    fake.to(CREATE).map((c) => c.key),
    [p.orderKey, p.orderKey],
  );
  done(fake);
});

test("R7: a stored review with no order is reopened without calling PayPal", async () => {
  const { fake, payments } = setup((s) => {
    s.plan!.status = "review";
    s.plan!.error = "PayPal's response did not arrive.";
  });
  const s = await payments.reconcile(OWNER);
  assert.equal(s.plan!.status, "proposed");
  assert.equal(s.plan!.error, undefined);
  assert.equal(s.operation, undefined);
  assert.equal(fake.calls.length + fake.tokens, 0);
});

test("R8: a declined capture is reported, then recovered with a new capture key", async () => {
  const { fake, payments, studio } = setup(authorized);
  const firstKey = studio().plan!.captureKey;
  fake.on(CAPTURE, ok(CAP("DECLINED"), 201)).on(GET_CAP, ok(CAP("DECLINED")));
  await assert.rejects(payments.captureAndSettle(OWNER), /declined/);
  let s = studio();
  assert.equal(s.plan!.status, "review");
  assert.match(s.plan!.error ?? "", /declined/);
  assert.deepEqual(starts(s), [840, 900]);
  assert.ok(!fake.routes().some((r) => r.endsWith("/refund")));

  fake
    .on(GET_CAP, ok(CAP("DECLINED")))
    .on(GET_ORDER, ok(ORDER_AUTH("CREATED", [CAP("DECLINED")])));
  s = await payments.reconcile(OWNER);
  const p = s.plan!;
  assert.equal(p.status, "authorized");
  assert.equal(p.captureId, undefined);
  assert.equal(p.captureStatus, undefined);
  assert.deepEqual(p.failedCaptureIds, ["CAPN"]);
  assert.notEqual(p.captureKey, firstKey);

  // A second check does not rotate again for the same declined capture.
  fake.on(GET_ORDER, ok(ORDER_AUTH("CREATED", [CAP("DECLINED")])));
  s = await payments.reconcile(OWNER);
  assert.equal(s.plan!.captureKey, p.captureKey);
  assert.deepEqual(s.plan!.failedCaptureIds, ["CAPN"]);

  fake
    .on(CAPTURE, ok(CAP("COMPLETED", "CAPN2"), 201))
    .on("GET /v2/payments/captures/CAPN2", ok(CAP("COMPLETED", "CAPN2")));
  refundsComplete(fake);
  s = await payments.captureAndSettle(OWNER);
  assert.equal(s.plan!.status, "complete");
  assert.deepEqual(
    fake.to(CAPTURE).map((c) => c.key),
    [firstKey, p.captureKey],
  );
  done(fake);
});

for (const as of ["VOIDED", "DENIED"])
  test(`R8: a declined capture with a ${as.toLowerCase()} authorization closes the offer`, async () => {
    const { fake, payments } = setup(authorized);
    fake.on(CAPTURE, ok(CAP("DECLINED"), 201)).on(GET_CAP, ok(CAP("DECLINED")));
    await assert.rejects(payments.captureAndSettle(OWNER), /declined/);

    fake
      .on(GET_CAP, ok(CAP("DECLINED")))
      .on(GET_ORDER, ok(ORDER_AUTH(as, [CAP("DECLINED")])));
    const s = await payments.reconcile(OWNER);
    assert.equal(s.plan!.status, "cancelled");
    assert.equal(s.plan!.captureId, undefined);
    assert.doesNotThrow(() => assertEditable(s));
    assert.deepEqual(starts(s), [840, 900]);
    done(fake);
  });

test("R9: a pending capture never reports success and cannot be cancelled", async () => {
  const { fake, payments, studio } = setup(authorized);
  fake.on(CAPTURE, ok(CAP("PENDING"), 201)).on(GET_CAP, ok(CAP("PENDING")));
  await assert.rejects(payments.captureAndSettle(OWNER), /still reviewing/);
  let s = studio();
  assert.equal(s.plan!.status, "review");
  assert.equal(s.plan!.captureStatus, "PENDING");
  assert.ok(s.events.some((e) => e.title === "Payment pending"));

  await assert.rejects(
    payments.cancelCheckout(OWNER),
    /PayPal has taken this payment/,
  );

  fake.on(GET_CAP, ok(CAP("PENDING")));
  s = await payments.reconcile(OWNER);
  assert.equal(s.plan!.status, "review");
  assert.ok(!s.plan!.committed);
  assert.deepEqual(starts(s), [840, 900]);

  fake.on(GET_CAP, ok(CAP("COMPLETED")));
  refundsComplete(fake);
  s = await payments.reconcile(OWNER);
  assert.equal(s.plan!.status, "complete");
  assert.deepEqual(refunded(s), [1500, 1000]);
  assert.equal(fake.to(VOID).length, 0);
  done(fake);
});

test("R10: a funding capture failure leaves the plan untouched", async () => {
  const { fake, payments, studio } = setup((s) => {
    delete s.bookings[0].captureId;
    s.bookings[0].fundingOrderId = "FORD";
    s.bookings[0].fundingKey = "fund-key";
    s.bookings[0].fundingCaptureKey = "fund-capture-key";
  });
  fake
    .on("GET /v2/checkout/orders/FORD", ok({ id: "FORD", status: "APPROVED" }))
    .on(
      "POST /v2/checkout/orders/FORD/capture",
      err(502, "BAD_GATEWAY"),
    );
  await assert.rejects(
    payments.finishFunding(OWNER, "alex", "FORD"),
    uncertain,
  );
  const s = studio();
  assert.equal(s.plan!.status, "proposed");
  assert.equal(s.plan!.error, undefined);
  assert.equal(
    fake.to("POST /v2/checkout/orders/FORD/capture")[0].key,
    "fund-capture-key",
  );
  assert.ok(s.events.some((e) => e.title === "Payment needs attention"));
  done(fake);
});

// Voids

test("V1: the void key is saved before the call and differs from the other keys", async () => {
  const fresh = fundedStudio().plan!;
  assert.ok(fresh.voidKey);
  assert.equal(
    new Set([fresh.orderKey, fresh.authorizeKey, fresh.captureKey, fresh.voidKey])
      .size,
    4,
  );
  // A plan stored before void keys existed gets one before PayPal is called.
  const { fake, payments, studio } = setup((s) => {
    authorized(s);
    delete s.plan!.voidKey;
  });
  fake.on(VOID, TIMEOUT);
  await assert.rejects(payments.cancelCheckout(OWNER), uncertain);
  const p = studio().plan!;
  assert.equal(p.status, "review");
  assert.ok(p.voidKey);
  assert.equal(fake.to(VOID)[0].key, p.voidKey);
  assert.notEqual(p.voidKey, p.authorizeKey);
  done(fake);
});

test("V2: a void PayPal does not confirm leaves the hold authorized", async () => {
  const { fake, payments, studio } = setup(authorized);
  fake.on(VOID, ok({ id: "AUTH", status: "CREATED" }));
  await assert.rejects(
    payments.cancelCheckout(OWNER),
    /PayPal did not confirm the void/,
  );
  assert.equal(studio().plan!.status, "authorized");
  done(fake);
});

test("V3: an empty void response is checked against the order", async () => {
  const { fake, payments } = setup(authorized);
  fake.on(VOID, { status: 204 }).on(GET_ORDER, ok(ORDER_AUTH("VOIDED")));
  const s = await payments.cancelCheckout(OWNER);
  assert.equal(s.plan!.status, "cancelled");
  done(fake);
});

test("V3: an empty void response with the hold still active is not a cancel", async () => {
  const { fake, payments, studio } = setup(authorized);
  fake.on(VOID, { status: 204 }).on(GET_ORDER, ok(ORDER_AUTH("CREATED")));
  await assert.rejects(
    payments.cancelCheckout(OWNER),
    /PayPal did not confirm the void/,
  );
  assert.equal(studio().plan!.status, "authorized");
  done(fake);
});

test("V4: a void 500 goes to review; reconcile finds it voided", async () => {
  const { fake, payments, studio } = setup(authorized);
  fake.on(VOID, err(500, "INTERNAL_SERVER_ERROR"));
  await assert.rejects(payments.cancelCheckout(OWNER), uncertain);
  assert.equal(studio().plan!.status, "review");

  fake.on(GET_ORDER, ok(ORDER_AUTH("VOIDED")));
  const s = await payments.reconcile(OWNER);
  assert.equal(s.plan!.status, "cancelled");
  assert.doesNotThrow(() => assertEditable(s));
  done(fake);
});

test("V4: a void 500 with the hold still active can be cancelled again with the same key", async () => {
  const { fake, payments, studio } = setup(authorized);
  fake.on(VOID, err(500, "INTERNAL_SERVER_ERROR"));
  await assert.rejects(payments.cancelCheckout(OWNER), uncertain);
  const voidKey = studio().plan!.voidKey;

  fake.on(GET_ORDER, ok(ORDER_AUTH("CREATED")));
  let s = await payments.reconcile(OWNER);
  assert.equal(s.plan!.status, "authorized");

  fake.on(VOID, ok(VOIDED));
  s = await payments.cancelCheckout(OWNER);
  assert.equal(s.plan!.status, "cancelled");
  assert.deepEqual(
    fake.to(VOID).map((c) => c.key),
    [voidKey, voidKey],
  );
  done(fake);
});

test("V5: a void refused as previously captured goes to review and reconcile completes it", async () => {
  const { fake, payments, studio } = setup(authorized);
  fake.on(VOID, err(422, "PREVIOUSLY_CAPTURED"));
  await assert.rejects(
    payments.cancelCheckout(OWNER),
    /PayPal shows this payment was captured/,
  );
  assert.equal(studio().plan!.status, "review");

  fake.on(GET_ORDER, ok(ORDER_AUTH("CAPTURED", [CAP("COMPLETED")])));
  refundsComplete(fake);
  const s = await payments.reconcile(OWNER);
  assert.equal(s.plan!.status, "complete");
  assert.deepEqual(starts(s), [780, 960]);
  done(fake);
});

// Refunds

test("F1: a refused refund does not block the other customer's refund", async () => {
  const { fake, payments, studio } = setup(authorized);
  fake.on(CAPTURE, ok(CAP("COMPLETED"), 201)).on(GET_CAP, ok(CAP("COMPLETED")));
  refundsComplete(fake, err(422, "TRANSACTION_REFUSED"));
  await assert.rejects(
    payments.captureAndSettle(OWNER),
    /Booking confirmed\. Some refunds need attention: .*TRANSACTION_REFUSED/,
  );
  let s = studio();
  const [alex, sam] = s.plan!.moves;
  assert.equal(s.plan!.status, "settling");
  assert.match(s.plan!.error ?? "", /Some refunds need attention/);
  assert.equal(alex.refundStatus, "REJECTED");
  assert.equal(alex.refundError, "TRANSACTION_REFUSED");
  assert.equal(sam.refundStatus, "COMPLETED");
  assert.deepEqual(starts(s), [780, 960]);
  assert.deepEqual(refunded(s), [0, 1000]);
  assert.equal(fake.to(REFUND_A).length, 1);

  // The next check retries once with a new key, since PayPal refused the first.
  fake
    .on(GET_CAP, ok(CAP("COMPLETED")))
    .on(REFUND_A, ok(REF("RA", "COMPLETED", "15.00"), 201));
  s = await payments.reconcile(OWNER);
  assert.equal(s.plan!.status, "complete");
  assert.equal(s.plan!.error, undefined);
  assert.deepEqual(refunded(s), [1500, 1000]);
  const [first, second] = fake.to(REFUND_A).map((c) => c.key);
  assert.equal(first, alex.refundKey);
  assert.equal(second, s.plan!.moves[0].refundKey);
  assert.notEqual(first, second);
  done(fake);
});

test("F2: a failed refund is confirmed and retried with a new key", async () => {
  const { fake, payments, studio } = setup(authorized);
  fake.on(CAPTURE, ok(CAP("COMPLETED"), 201)).on(GET_CAP, ok(CAP("COMPLETED")));
  refundsComplete(fake, ok(REF("RA", "FAILED", "15.00"), 201));
  await assert.rejects(
    payments.captureAndSettle(OWNER),
    /Some refunds need attention: Alex: PayPal reported the refund as failed/,
  );
  let s = studio();
  const firstKey = s.plan!.moves[0].refundKey;
  assert.equal(s.plan!.moves[0].refundStatus, "FAILED");
  assert.equal(s.plan!.moves[1].refundStatus, "COMPLETED");
  assert.equal(s.plan!.status, "settling");

  fake.reset();
  fake
    .on(GET_CAP, ok(CAP("COMPLETED")))
    .on(GET_REFUND_A, ok(REF("RA", "FAILED", "15.00")))
    .on(REFUND_A, ok(REF("RA2", "COMPLETED", "15.00"), 201));
  s = await payments.reconcile(OWNER);
  const alex = s.plan!.moves[0];
  assert.deepEqual(fake.routes(), [GET_CAP, GET_REFUND_A, REFUND_A]);
  assert.notEqual(fake.to(REFUND_A)[0].key, firstKey);
  assert.equal(fake.to(REFUND_A)[0].key, alex.refundKey);
  assert.equal(s.plan!.status, "complete");
  assert.equal(alex.refundId, "RA2");
  assert.deepEqual(alex.previousRefundIds, ["RA"]);
  assert.deepEqual(refunded(s), [1500, 1000]);
  done(fake);
});

test("F2: a failed refund that PayPal later completed is recorded, not repeated", async () => {
  const { fake, payments } = setup((s) => {
    committed(s);
    const [alex, sam] = s.plan!.moves;
    Object.assign(alex, { refundId: "RA", refundStatus: "FAILED" });
    Object.assign(sam, { refundId: "RB", refundStatus: "COMPLETED" });
    s.bookings[1].refunded = 1000;
  });
  fake
    .on(GET_CAP, ok(CAP("COMPLETED")))
    .on(GET_REFUND_A, ok(REF("RA", "COMPLETED", "15.00")));
  const s = await payments.reconcile(OWNER);
  assert.equal(s.plan!.status, "complete");
  assert.deepEqual(refunded(s), [1500, 1000]);
  assert.equal(fake.to(REFUND_A).length, 0);
  done(fake);
});

test("F3: a refund timeout keeps its key and is repeated on the next check", async () => {
  const { fake, payments, studio } = setup(authorized);
  fake.on(CAPTURE, ok(CAP("COMPLETED"), 201)).on(GET_CAP, ok(CAP("COMPLETED")));
  refundsComplete(fake, TIMEOUT);
  await assert.rejects(
    payments.captureAndSettle(OWNER),
    /Some refunds need attention/,
  );
  let s = studio();
  assert.equal(s.plan!.moves[0].refundStatus, "REQUESTED");
  assert.equal(s.plan!.moves[1].refundStatus, "COMPLETED");
  assert.equal(s.plan!.status, "settling");

  fake
    .on(GET_CAP, ok(CAP("COMPLETED")))
    .on(REFUND_A, ok(REF("RA", "COMPLETED", "15.00"), 201));
  s = await payments.reconcile(OWNER);
  assert.equal(s.plan!.status, "complete");
  const keys = fake.to(REFUND_A).map((c) => c.key);
  assert.deepEqual(keys, [s.plan!.moves[0].refundKey, s.plan!.moves[0].refundKey]);
  assert.deepEqual(refunded(s), [1500, 1000]);
  done(fake);
});

test("F4: a pending refund is read back and counted once", async () => {
  const { fake, payments } = setup(authorized);
  fake.on(CAPTURE, ok(CAP("COMPLETED"), 201)).on(GET_CAP, ok(CAP("COMPLETED")));
  refundsComplete(fake, ok(REF("RA", "PENDING", "15.00"), 201));
  let s = await payments.captureAndSettle(OWNER);
  assert.equal(s.plan!.status, "settling");
  assert.equal(s.plan!.error, undefined, "pending is progress, not a problem");
  assert.deepEqual(refunded(s), [0, 1000]);

  fake
    .on(GET_CAP, ok(CAP("COMPLETED")))
    .on(GET_REFUND_A, ok(REF("RA", "COMPLETED", "15.00")));
  s = await payments.reconcile(OWNER);
  assert.equal(s.plan!.status, "complete");
  assert.deepEqual(refunded(s), [1500, 1000]);
  assert.equal(fake.to(REFUND_A).length, 1);
  done(fake);
});

test("F5: an old refund with an unknown result is flagged, not repeated", async () => {
  const { fake, payments, studio } = setup((s) => {
    committed(s);
    s.plan!.moves[0].refundStatus = "REQUESTED";
    s.plan!.moves[0].refundAttemptAt = new Date(
      Date.now() - 6 * 60 * 60_000,
    ).toISOString();
  });
  fake
    .on(GET_CAP, ok(CAP("COMPLETED")))
    .on(REFUND_B, ok(REF("RB", "COMPLETED", "10.00"), 201));
  await assert.rejects(
    payments.reconcile(OWNER),
    /Alex: An earlier refund has an unknown result/,
  );
  let s = studio();
  assert.equal(s.plan!.moves[0].refundStatus, "UNKNOWN");
  assert.equal(s.plan!.moves[1].refundStatus, "COMPLETED");
  assert.equal(fake.to(REFUND_A).length, 0);

  // Manual review: later checks still leave Alex's refund alone.
  fake.on(GET_CAP, ok(CAP("COMPLETED")));
  await assert.rejects(payments.reconcile(OWNER), /Some refunds need attention/);
  s = studio();
  assert.equal(s.plan!.status, "settling");
  assert.equal(fake.to(REFUND_A).length, 0);
  done(fake);
});

test("F6: a refund with the wrong amount is flagged and not retried", async () => {
  const { fake, payments, studio } = setup(authorized);
  fake.on(CAPTURE, ok(CAP("COMPLETED"), 201)).on(GET_CAP, ok(CAP("COMPLETED")));
  refundsComplete(fake, ok(REF("RA", "COMPLETED", "16.00"), 201));
  await assert.rejects(
    payments.captureAndSettle(OWNER),
    /Alex: PayPal returned a different refund amount/,
  );
  let s = studio();
  const alex = s.plan!.moves[0];
  assert.equal(alex.refundStatus, "UNKNOWN");
  assert.equal(alex.refundId, "RA");
  assert.equal(s.plan!.moves[1].refundStatus, "COMPLETED");
  assert.deepEqual(refunded(s), [0, 1000]);

  fake.on(GET_CAP, ok(CAP("COMPLETED")));
  await assert.rejects(payments.reconcile(OWNER), /Some refunds need attention/);
  s = studio();
  assert.equal(fake.to(REFUND_A).length, 1);
  assert.equal(fake.to(GET_REFUND_A).length, 0);
  done(fake);
});

test("F7: a refund repeated after a timeout and then refused goes to manual review", async () => {
  const { fake, payments, studio } = setup(authorized);
  fake.on(CAPTURE, ok(CAP("COMPLETED"), 201)).on(GET_CAP, ok(CAP("COMPLETED")));
  refundsComplete(fake, TIMEOUT);
  await assert.rejects(
    payments.captureAndSettle(OWNER),
    /Some refunds need attention/,
  );
  const key = studio().plan!.moves[0].refundKey;
  assert.equal(studio().plan!.moves[0].refundStatus, "REQUESTED");

  // The repeat is refused, but the first request may still be in progress or
  // done, so a new key could pay Alex twice.
  fake
    .on(GET_CAP, ok(CAP("COMPLETED")))
    .on(REFUND_A, err(422, "PREVIOUS_REQUEST_IN_PROGRESS"));
  await assert.rejects(
    payments.reconcile(OWNER),
    /Alex: .*PREVIOUS_REQUEST_IN_PROGRESS.*Check it in PayPal/,
  );
  let s = studio();
  const alex = s.plan!.moves[0];
  assert.equal(alex.refundStatus, "UNKNOWN");
  assert.equal(alex.refundKey, key, "no new key");
  assert.equal(alex.previousRefundIds, undefined);
  assert.match(alex.refundError ?? "", /PREVIOUS_REQUEST_IN_PROGRESS/);
  assert.equal(s.plan!.status, "settling");
  assert.ok(s.events.some((e) => e.title === "Refund needs manual review"));
  assert.deepEqual(
    fake.to(REFUND_A).map((c) => c.key),
    [key, key],
  );

  // Later checks leave it for a person to resolve.
  fake.on(GET_CAP, ok(CAP("COMPLETED")));
  await assert.rejects(payments.reconcile(OWNER), /Some refunds need attention/);
  s = studio();
  assert.equal(s.plan!.moves[0].refundKey, key);
  assert.equal(fake.to(REFUND_A).length, 2);
  assert.deepEqual(refunded(s), [0, 1000]);
  done(fake);
});

// Locks, modes and funding

test("L1: a running step blocks payments; reconcile takes over a stale lock", async () => {
  const start = Date.parse("2026-11-12T18:00:00.000Z");
  let clock = start + 30_000;
  const { fake, payments, studio } = setup((s) => {
    authorized(s);
    s.plan!.expiresAt = new Date(start + 30 * 60_000).toISOString();
    s.operation = {
      id: "other-step",
      kind: "capture-and-refund",
      startedAt: new Date(start).toISOString(),
    };
  }, () => clock);
  await assert.rejects(payments.captureAndSettle(OWNER), /already running/);
  await assert.rejects(payments.reconcile(OWNER), /already running/);
  assert.equal(fake.calls.length, 0);
  assert.equal(studio().operation?.id, "other-step");

  clock = start + 121_000;
  await assert.rejects(payments.captureAndSettle(OWNER), /already running/);
  fake.on(GET_ORDER, ok(ORDER_AUTH("CREATED")));
  const s = await payments.reconcile(OWNER);
  assert.equal(s.plan!.status, "authorized");
  assert.equal(s.operation, undefined);
  done(fake);
});

test("L2: practice studios never reach PayPal", async () => {
  const { fake, payments } = setup((s) => {
    authorized(s);
    s.mode = "practice";
  });
  for (const step of [
    () => payments.fundBooking(OWNER, "alex", ORIGIN),
    () => payments.finishFunding(OWNER, "alex", "FORD"),
    () => payments.beginCheckout(OWNER, ORIGIN),
    () => payments.finishApproval(OWNER, "ORD"),
    () => payments.captureAndSettle(OWNER),
    () => payments.reconcile(OWNER),
    () => payments.cancelCheckout(OWNER),
  ])
    await assert.rejects(step(), /Switch to PayPal sandbox/);
  assert.equal(fake.calls.length + fake.tokens, 0);
});

test("L3: funding with a lost redirect captures the approved order", async () => {
  const { fake, payments } = setup((s) => {
    delete s.bookings[0].captureId;
    Object.assign(s.bookings[0], {
      fundingOrderId: "FORD",
      fundingKey: "fund-key",
      fundingCaptureKey: "fund-capture-key",
      fundingApprovalUrl:
        "https://www.sandbox.paypal.com/checkoutnow?token=FORD",
    });
  });
  const FCAP = { id: "FCAP", status: "COMPLETED", amount: USD("60.00") };
  fake
    .on("GET /v2/checkout/orders/FORD", ok({ id: "FORD", status: "APPROVED" }))
    .on(
      "POST /v2/checkout/orders/FORD/capture",
      ok(
        {
          id: "FORD",
          status: "COMPLETED",
          purchase_units: [{ payments: { captures: [FCAP] } }],
        },
        201,
      ),
    )
    .on("GET /v2/payments/captures/FCAP", ok(FCAP));
  const s = await payments.fundBooking(OWNER, "alex", ORIGIN);
  assert.equal(s.bookings[0].captureId, "FCAP");
  assert.equal(s.bookings[0].fundingApprovalUrl, undefined);
  assert.equal(
    fake.to("POST /v2/checkout/orders/FORD/capture")[0].key,
    "fund-capture-key",
  );
  assert.equal(s.plan!.status, "proposed");
  done(fake);
});

test("L3: funding an order still awaiting approval returns its link as before", async () => {
  const { fake, payments } = setup((s) => {
    delete s.bookings[0].captureId;
    Object.assign(s.bookings[0], {
      fundingOrderId: "FORD",
      fundingKey: "fund-key",
      fundingCaptureKey: "fund-capture-key",
    });
  });
  const link = "https://www.sandbox.paypal.com/checkoutnow?token=FORD";
  fake.on(
    "GET /v2/checkout/orders/FORD",
    ok({
      id: "FORD",
      status: "PAYER_ACTION_REQUIRED",
      links: [{ rel: "payer-action", href: link }],
    }),
  );
  const s = await payments.fundBooking(OWNER, "alex", ORIGIN);
  assert.equal(s.bookings[0].fundingApprovalUrl, link);
  assert.equal(s.bookings[0].captureId, undefined);
  done(fake);
});
