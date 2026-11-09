import test from "node:test";
import assert from "node:assert/strict";
import {
  assertEditable,
  consent,
  propose,
  seed,
  type Plan,
  type Studio,
} from "../lib/domain.ts";
import {
  canCancelExpiredOffer,
  canCancelOffer,
  canCheckCancelledHold,
  canCheckExistingPayment,
  checkoutLinkVisible,
  studioLocked,
} from "../lib/plan-ui.ts";

function studio(change: (p: Plan, s: Studio) => void = () => {}) {
  const s = seed();
  s.mode = "sandbox";
  const p = propose(s, s.request);
  for (const m of p.moves) consent(s, m.token, "accepted");
  change(p, s);
  return s;
}
const editable = (s: Studio) => {
  try {
    assertEditable(s);
    return true;
  } catch {
    return false;
  }
};

test("a cancelled sandbox checkout unlocks the studio, matching the server", () => {
  const open = studio((p) => {
    p.orderId = "ORD";
  });
  assert.equal(studioLocked(open), true);
  assert.equal(editable(open), false);
  const cancelled = studio((p) => {
    p.orderId = "ORD";
    p.status = "cancelled";
  });
  assert.equal(studioLocked(cancelled), false);
  assert.equal(editable(cancelled), true);
  const expired = studio((p) => {
    p.orderId = "ORD";
    p.status = "expired";
  });
  assert.equal(studioLocked(expired), true);
  assert.equal(editable(expired), false);
  assert.equal(studioLocked(studio()), false, "no checkout yet");
  const running = studio((_, s) => {
    s.operation = { id: "op", kind: "reconcile", startedAt: "" };
  });
  assert.equal(studioLocked(running), true);
  const confirmed = studio((p) => {
    p.orderId = "ORD";
    p.status = "complete";
    p.committed = true;
  });
  assert.equal(studioLocked(confirmed), true);
  assert.equal(editable(confirmed), false);
});

test("cancel is offered in review until PayPal has taken the payment", () => {
  const plan = (change: (p: Plan) => void) => studio(change).plan!;
  assert.equal(canCancelOffer(plan(() => {})), true);
  assert.equal(
    canCancelOffer(
      plan((p) => {
        p.orderId = "ORD";
        p.status = "review";
      }),
    ),
    true,
  );
  assert.equal(
    canCancelOffer(
      plan((p) => {
        p.status = "review";
        p.captureId = "CAPN";
        p.captureStatus = "PENDING";
      }),
    ),
    false,
  );
  assert.equal(
    canCancelOffer(
      plan((p) => {
        p.status = "review";
        p.captureId = "CAPN";
        p.captureStatus = "DECLINED";
      }),
    ),
    true,
  );
  assert.equal(
    canCancelOffer(
      plan((p) => {
        p.status = "settling";
        p.committed = true;
      }),
    ),
    false,
  );
});

test("an expired offer with a PayPal checkout gets its own cancel button", () => {
  const plan = (change: (p: Plan) => void) => studio(change).plan!;
  assert.equal(
    canCancelExpiredOffer(
      plan((p) => {
        p.status = "expired";
        p.orderId = "ORD";
      }),
    ),
    true,
  );
  assert.equal(
    canCancelExpiredOffer(
      plan((p) => {
        p.status = "expired";
      }),
    ),
    false,
    "without a checkout the form is already unlocked",
  );
  assert.equal(
    canCancelExpiredOffer(
      plan((p) => {
        p.status = "cancelled";
        p.orderId = "ORD";
      }),
    ),
    false,
  );
});

test("review shows one PayPal check button, not two", () => {
  const plan = (change: (p: Plan) => void) => studio(change).plan!;
  assert.equal(
    canCheckExistingPayment(
      plan((p) => {
        p.orderId = "ORD";
      }),
    ),
    true,
  );
  assert.equal(
    canCheckExistingPayment(
      plan((p) => {
        p.orderId = "ORD";
        p.status = "review";
      }),
    ),
    false,
  );
  assert.equal(canCheckExistingPayment(plan(() => {})), false);
});

test("a cancelled offer with an unconfirmed PayPal hold offers a payment check", () => {
  const plan = (change: (p: Plan) => void) => studio(change).plan!;
  const legacy = plan((p) => {
    p.orderId = "ORD";
    p.authorizationId = "AUTH";
    p.status = "cancelled";
    delete p.voidKey;
  });
  assert.equal(canCheckCancelledHold(legacy), true, "cancelled before void keys");
  assert.equal(
    canCheckCancelledHold(
      plan((p) => {
        p.orderId = "ORD";
        p.authorizationId = "AUTH";
        p.status = "cancelled";
      }),
    ),
    false,
    "a cancel with a void key had PayPal confirm the void",
  );
  assert.equal(
    canCheckCancelledHold(
      plan((p) => {
        p.orderId = "ORD";
        p.authorizationId = "AUTH";
        p.status = "cancelled";
        p.error = "PayPal did not confirm the void.";
      }),
    ),
    true,
    "a failed check can be repeated",
  );
  assert.equal(
    canCheckCancelledHold(
      plan((p) => {
        p.orderId = "ORD";
        p.status = "cancelled";
        delete p.voidKey;
      }),
    ),
    false,
    "no hold was recorded",
  );
  assert.equal(
    canCheckCancelledHold(
      plan((p) => {
        p.orderId = "ORD";
        p.authorizationId = "AUTH";
        p.status = "authorized";
        delete p.voidKey;
      }),
    ),
    false,
    "open offers use the plan's own buttons",
  );
});
test("the new customer's checkout link shows only when the backend serves the page", () => {
  const plan = (change: (p: Plan) => void = () => {}) => studio(change).plan!;
  const supported = { checkoutPage: true };
  assert.equal(checkoutLinkVisible(plan(), supported), true);
  assert.equal(
    checkoutLinkVisible(plan((p) => (p.status = "authorized")), supported),
    true,
    "the page shows the approved hold",
  );
  // The Pages frontend may talk to an older backend without the route.
  assert.equal(checkoutLinkVisible(plan(), {}), false);
  assert.equal(checkoutLinkVisible(plan(), { checkoutPage: false }), false);
  assert.equal(
    checkoutLinkVisible(plan((p) => delete p.checkoutToken), supported),
    false,
    "plans saved before the page existed have no link",
  );
  for (const status of ["declined", "expired", "cancelled"] as const)
    assert.equal(
      checkoutLinkVisible(plan((p) => (p.status = status)), supported),
      false,
      status,
    );
  assert.equal(
    checkoutLinkVisible(
      plan((p) => {
        p.committed = true;
        p.status = "complete";
      }),
      supported,
    ),
    false,
    "a booked plan needs no link",
  );
});
