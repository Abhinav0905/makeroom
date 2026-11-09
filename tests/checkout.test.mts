import test from "node:test";
import assert from "node:assert/strict";
import {
  DomainError,
  consent,
  practiceSettle,
  propose,
  seed,
  type Studio,
} from "../lib/domain.ts";
import { checkoutView, offerView } from "../lib/customer-views.ts";
import {
  CHECKOUT_TOKEN,
  checkoutAccess,
  checkoutReturn,
  createCheckout,
  currentCheckoutView,
  isCurrentCheckout,
} from "../lib/checkout.ts";
import { appHref } from "../lib/client-runtime.ts";
import { memoryStore } from "./support/memory-store.mts";

const OWNER = "guest:32a76fb4-2e68-465a-8c4b-a8e4f01cd365";
const status = (code: number) => (e: unknown) =>
  e instanceof DomainError && e.status === code;
/** A practice studio with a fresh plan; accept moves by index. */
function planned(accept: number[] = []) {
  const s = seed();
  const p = propose(s, s.request);
  for (const i of accept) consent(s, p.moves[i].token, "accepted");
  return s;
}
/** The checkout link on a memory store, with payments that must never run. */
function practiceSetup(s: Studio, now?: () => number) {
  const store = memoryStore();
  store.put(OWNER, s);
  const paypalCalls: string[] = [];
  const checkout = createCheckout({
    payments: {
      async beginCheckout() {
        paypalCalls.push("beginCheckout");
        throw new Error("PayPal must not be called");
      },
      async finishApproval() {
        paypalCalls.push("finishApproval");
        throw new Error("PayPal must not be called");
      },
    },
    updateStudio: store.updateStudio,
    now,
  });
  const token = s.plan!.checkoutToken!;
  const pay = () => checkout.pay(OWNER, store.get(OWNER), token, "https://makeroom.test");
  return { store, checkout, token, pay, paypalCalls, studio: () => store.get(OWNER) };
}

test("each new plan gets its own checkout link, kept out of every offer view", () => {
  const s = seed();
  const first = propose(s, s.request);
  assert.match(first.checkoutToken!, CHECKOUT_TOKEN);
  assert.ok(first.moves.every((m) => m.token !== first.checkoutToken));
  assert.ok(isCurrentCheckout(s, first.id, first.checkoutToken!));
  for (const m of first.moves) {
    const shown = JSON.stringify(offerView(s, m.token));
    assert.ok(!shown.includes(first.checkoutToken!), "no checkout link");
    for (const other of first.moves.filter((o) => o !== m)) {
      assert.ok(!shown.includes(other.token), "no other offer link");
      assert.ok(!shown.includes(other.name), "no other customer");
    }
  }
  const second = propose(s, s.request);
  assert.match(second.checkoutToken!, CHECKOUT_TOKEN);
  assert.notEqual(second.checkoutToken, first.checkoutToken);
  assert.ok(isCurrentCheckout(s, second.id, second.checkoutToken!));
  assert.equal(isCurrentCheckout(s, first.id, first.checkoutToken!), false);
  assert.equal(isCurrentCheckout(s, second.id, first.checkoutToken!), false);
  assert.equal(
    isCurrentCheckout(s, second.id, second.moves[0].token),
    false,
    "an offer link is not a checkout link",
  );
  assert.throws(
    () => currentCheckoutView(s, first.checkoutToken!),
    status(410),
  );
  // Plans stored before the checkout page existed simply have no link.
  delete s.plan!.checkoutToken;
  assert.equal(isCurrentCheckout(s, second.id, second.checkoutToken!), false);
  assert.equal(isCurrentCheckout(s, second.id, ""), false);
});

test("the checkout view shows Maya's booking and counts, never other customers", () => {
  const s = planned([0]);
  const shown = currentCheckoutView(s, s.plan!.checkoutToken!);
  assert.deepEqual(shown, {
    name: "Maya Chen",
    service: "Editorial portrait session",
    date: "2026-11-12",
    start: 840,
    duration: 120,
    price: 12000,
    flexibility: 2500,
    total: 14500,
    accepted: 1,
    affected: 2,
    status: "proposed",
    mode: "practice",
    expiresAt: s.plan!.expiresAt,
    booked: false,
    payment: "none",
  });
  const text = JSON.stringify(shown);
  for (const b of s.bookings)
    assert.ok(!text.includes(b.name.split(" ")[0]), b.name);
  const p = s.plan!;
  for (const secret of [
    p.checkoutToken!,
    p.orderKey,
    p.authorizeKey,
    p.captureKey,
    ...p.moves.flatMap((m) => [m.token, m.refundKey]),
  ])
    assert.ok(!text.includes(secret));
  // Payment states the page distinguishes.
  p.orderId = "ORD";
  assert.equal(checkoutView(s).payment, "started");
  p.status = "authorized";
  assert.equal(checkoutView(s).payment, "on-hold");
  p.status = "review";
  assert.equal(checkoutView(s).payment, "checking");
});

test("practice pay is the studio's practice booking, only once everyone agreed", async () => {
  const { pay, studio, paypalCalls, token } = practiceSetup(planned());
  await assert.rejects(pay(), /Waiting for 2 more customers to agree/);
  const s = studio();
  consent(s, s.plan!.moves[0].token, "accepted");
  const { pay: payOne, studio: studioOne } = practiceSetup(s);
  await assert.rejects(payOne(), /Waiting for 1 more customer to agree/);
  assert.deepEqual(
    studioOne().bookings.map((b) => [b.start, b.refunded]),
    [
      [840, 0],
      [900, 0],
    ],
    "nothing moved",
  );
  assert.equal(studio().plan!.checkoutToken, token);

  const ready = planned([0, 1]);
  const expected = structuredClone(ready);
  practiceSettle(expected);
  const done = practiceSetup(ready);
  const r = await done.pay();
  assert.equal(r.approvalUrl, undefined);
  const after = done.studio();
  assert.equal(after.plan!.status, "complete");
  assert.equal(after.plan!.committed, true);
  assert.equal(after.plan!.captureStatus, "COMPLETED");
  assert.deepEqual(
    after.bookings.map((b) => [b.start, b.refunded]),
    expected.bookings.map((b) => [b.start, b.refunded]),
  );
  assert.deepEqual(
    after.plan!.moves.map((m) => m.refundStatus),
    ["COMPLETED", "COMPLETED"],
  );
  assert.deepEqual(
    after.events.slice(0, 2).map((e) => e.title),
    expected.events.slice(0, 2).map((e) => e.title),
  );
  assert.equal(currentCheckoutView(after, done.token).booked, true);
  assert.equal(currentCheckoutView(after, done.token).payment, "paid");
  await assert.rejects(done.pay(), /already booked and paid/);
  assert.equal(done.studio().version, after.version, "a second pay changes nothing");
  assert.deepEqual([...paypalCalls, ...done.paypalCalls], []);
});

test("practice pay is refused after expiry, a refusal, a cancel or a replaced link", async () => {
  const late = planned([0, 1]);
  const expiry = Date.parse(late.plan!.expiresAt);
  const clockLate = practiceSetup(late, () => expiry + 1);
  await assert.rejects(clockLate.pay(), /booking link has expired/);
  assert.equal(clockLate.studio().plan!.status, "proposed");

  const expired = planned([0, 1]);
  expired.plan!.status = "expired";
  await assert.rejects(practiceSetup(expired).pay(), /booking link has expired/);

  const declined = planned([0]);
  consent(declined, declined.plan!.moves[1].token, "declined");
  await assert.rejects(practiceSetup(declined).pay(), /keep their original time/);

  const cancelled = planned([0, 1]);
  cancelled.plan!.status = "cancelled";
  await assert.rejects(practiceSetup(cancelled).pay(), /closed this booking request/);

  // The studio replaces the plan after the link was read: the old link must
  // not settle the new plan.
  const replaced = planned([0, 1]);
  const stale = practiceSetup(replaced);
  const snapshot = stale.studio();
  await stale.store.updateStudio(OWNER, (s) => {
    const p = propose(s, s.request);
    for (const m of p.moves) consent(s, m.token, "accepted");
  });
  await assert.rejects(
    stale.checkout.pay(OWNER, snapshot, stale.token, "https://makeroom.test"),
    status(410),
  );
  assert.equal(stale.studio().plan!.status, "proposed");
  assert.equal(stale.studio().plan!.committed, undefined);
});

test("the Pages client reaches only pages: practice studios; guests never reach sandbox", async () => {
  const ok = (owner: string, mode: "practice" | "sandbox", pages: boolean) =>
    assert.doesNotThrow(() => checkoutAccess(owner, mode, pages));
  const refused = (owner: string, mode: "practice" | "sandbox", pages: boolean) =>
    assert.throws(() => checkoutAccess(owner, mode, pages), status(403));
  ok("pages:32a76fb4-2e68-465a-8c4b-a8e4f01cd365", "practice", true);
  ok("guest:32a76fb4-2e68-465a-8c4b-a8e4f01cd365", "practice", false);
  ok("signed-in-user", "practice", false);
  ok("signed-in-user", "sandbox", false);
  refused("guest:32a76fb4-2e68-465a-8c4b-a8e4f01cd365", "practice", true);
  refused("signed-in-user", "practice", true);
  refused("pages:32a76fb4-2e68-465a-8c4b-a8e4f01cd365", "sandbox", true);
  refused("pages:32a76fb4-2e68-465a-8c4b-a8e4f01cd365", "sandbox", false);
  refused("guest:32a76fb4-2e68-465a-8c4b-a8e4f01cd365", "sandbox", false);

  // Even a guest studio stored in sandbox mode never reaches PayPal.
  const s = planned([0, 1]);
  s.mode = "sandbox";
  const guest = practiceSetup(s);
  await assert.rejects(guest.pay(), status(403));
  await assert.rejects(
    guest.checkout.approved(OWNER, guest.studio(), guest.token, "ORD"),
    status(403),
  );
  assert.deepEqual(guest.paypalCalls, []);
});

test("PayPal returns the buyer to the checkout page, and Pages links use ?checkout=", () => {
  const token = planned().plan!.checkoutToken!;
  assert.deepEqual(checkoutReturn("https://makeroom.test", token), {
    returnUrl: "https://makeroom.test/checkout/" + token + "?paypal=approved",
    cancelUrl: "https://makeroom.test/checkout/" + token + "?paypal=cancel",
  });
  assert.equal(appHref("/checkout/" + token), "/checkout/" + token);
  const g = globalThis as { window?: unknown };
  g.window = {
    __MAKEROOM_STATIC__: { basePath: "/makeroom/", apiOrigin: "https://api.test" },
  };
  try {
    assert.equal(appHref("/checkout/" + token), "/makeroom/?checkout=" + token);
    assert.equal(appHref("/offer/abc"), "/makeroom/?offer=abc");
  } finally {
    delete g.window;
  }
});
