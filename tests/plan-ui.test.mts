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
  canCheckExistingPayment,
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
