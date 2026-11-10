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
import {
  checkoutView,
  offerView,
  pacificTime,
} from "../lib/customer-views.ts";
import {
  checkoutAccess,
  createCheckout,
  currentCheckoutView,
} from "../lib/checkout.ts";
import { LINK_TOKEN, createLinks, type LinkRow } from "../lib/links.ts";
import { returnUrls } from "../lib/payments-core.ts";
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

/** The offers table and studios of lib/store.ts, in memory. */
function linkSetup(s: Studio) {
  const store = memoryStore();
  store.put(OWNER, s);
  const rows = new Map<string, LinkRow>();
  const register = (st: Studio) => {
    const p = st.plan!;
    for (const t of [...p.moves.map((m) => m.token), p.checkoutToken!])
      rows.set(t, { owner: OWNER, plan_id: p.id });
  };
  register(s);
  const links = createLinks({
    findLink: async (token) => rows.get(token) ?? null,
    readStudio: store.readStudio,
  });
  return { store, links, register };
}

test("each new plan gets its own checkout link, kept out of every offer view", () => {
  const s = seed();
  const first = propose(s, s.request);
  assert.match(first.checkoutToken!, LINK_TOKEN);
  assert.ok(first.moves.every((m) => m.token !== first.checkoutToken));
  for (const m of first.moves) {
    const shown = JSON.stringify(offerView(s, m.token));
    assert.ok(!shown.includes(first.checkoutToken!), "no checkout link");
    for (const other of first.moves.filter((o) => o !== m)) {
      assert.ok(!shown.includes(other.token), "no other offer link");
      assert.ok(!shown.includes(other.name), "no other customer");
    }
  }
  const second = propose(s, s.request);
  assert.match(second.checkoutToken!, LINK_TOKEN);
  assert.notEqual(second.checkoutToken, first.checkoutToken);
  assert.throws(
    () => currentCheckoutView(s, first.checkoutToken!),
    status(410),
  );
  assert.doesNotThrow(() => currentCheckoutView(s, second.checkoutToken!));
});

test("checkout and offer links answer 404 for the wrong kind and 410 once replaced", async () => {
  const s = planned();
  const first = s.plan!;
  const { store, links, register } = linkSetup(s);
  const found = await links.checkoutOwner(first.checkoutToken!);
  assert.equal(found.owner, OWNER);
  assert.equal(found.studio.plan!.id, first.id);
  assert.equal(
    (await links.offerOwner(first.moves[0].token)).studio.plan!.id,
    first.id,
  );
  // The current plan's link of the other kind is simply not found.
  await assert.rejects(links.checkoutOwner(first.moves[0].token), status(404));
  await assert.rejects(links.offerOwner(first.checkoutToken!), status(404));
  // Malformed and unknown links.
  await assert.rejects(links.checkoutOwner("nope"), status(404));
  await assert.rejects(
    links.checkoutOwner("a".repeat(72)),
    /booking link wasn't found/,
  );
  // A new arrangement replaces every earlier link.
  const next = await store.updateStudio(OWNER, (st) => {
    propose(st, st.request);
  });
  register(next);
  await assert.rejects(
    links.checkoutOwner(first.checkoutToken!),
    (e: unknown) => status(410)(e) && /replaced this booking link/.test(String(e)),
  );
  await assert.rejects(links.offerOwner(first.moves[0].token), status(410));
  assert.ok(await links.checkoutOwner(next.plan!.checkoutToken!));
  // A plan stored before the checkout page existed has no checkout link.
  await store.updateStudio(OWNER, (st) => {
    delete st.plan!.checkoutToken;
  });
  await assert.rejects(
    links.checkoutOwner(next.plan!.checkoutToken!),
    status(404),
  );
  // Resetting the studio removes the plan.
  await store.updateStudio(OWNER, (st) => {
    st.plan = null;
  });
  await assert.rejects(links.offerOwner(next.plan!.moves[0].token), status(410));
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
  const expiry = Date.parse(p.expiresAt);
  p.orderId = "ORD";
  p.orderFrom = "checkout";
  assert.equal(checkoutView(s).payment, "started");
  p.orderFrom = "studio";
  assert.equal(checkoutView(s).payment, "studio", "the studio started PayPal");
  delete p.orderFrom;
  assert.equal(checkoutView(s).payment, "studio", "orders from before orderFrom");
  delete p.orderId;
  p.orderFrom = "studio";
  assert.equal(
    checkoutView(s).payment,
    "studio",
    "a studio order whose create timed out",
  );
  p.orderId = "ORD";
  p.status = "authorized";
  assert.equal(checkoutView(s, expiry - 1).payment, "on-hold");
  assert.equal(checkoutView(s, expiry + 1).payment, "lapsed", "hold past expiry");
  p.status = "review";
  assert.equal(checkoutView(s).payment, "checking");
});

test("the hold time is shown in Pacific time like the session", () => {
  assert.equal(pacificTime("2026-11-12T22:41:00.000Z"), "2:41 pm");
  assert.equal(pacificTime("2026-11-12T08:05:00.000Z"), "12:05 am");
  assert.equal(pacificTime("2026-07-01T19:00:00.000Z"), "12:00 pm", "daylight time");
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

test("PayPal returns the buyer to whoever started the order, and Pages links use ?checkout=", () => {
  const p = planned().plan!;
  const token = p.checkoutToken!;
  const studioUrls = {
    returnUrl: "https://makeroom.test/?paypal=request",
    cancelUrl: "https://makeroom.test/?paypal=cancel",
  };
  assert.deepEqual(returnUrls("https://makeroom.test", p), studioUrls);
  p.orderFrom = "studio";
  assert.deepEqual(returnUrls("https://makeroom.test", p), studioUrls);
  p.orderFrom = "checkout";
  assert.deepEqual(returnUrls("https://makeroom.test", p), {
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
