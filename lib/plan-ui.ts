// Which studio controls a plan allows. Pure, so node:test can check them.
import { type Plan, type Studio } from "./domain.ts";
/**
 * Request and preference inputs stay locked while a payment step runs, while a
 * PayPal checkout is still open, or once the booking is confirmed. Mirrors
 * assertEditable in lib/domain.ts, so a cancelled checkout unlocks the studio.
 */
export function studioLocked(s: Pick<Studio, "operation" | "plan">) {
  const p = s.plan;
  return (
    !!s.operation ||
    (!!p?.orderId && !["cancelled", "complete"].includes(p.status)) ||
    !!p?.committed
  );
}
/** "Cancel this offer" on an open plan: offered until PayPal has taken the payment. */
export function canCancelOffer(p: Plan) {
  return (
    !p.committed && !["COMPLETED", "PENDING"].includes(p.captureStatus ?? "")
  );
}
/** An expired offer that still has a PayPal checkout must be cancelled explicitly. */
export function canCancelExpiredOffer(p: Plan) {
  return p.status === "expired" && !!p.orderId;
}
/** The secondary PayPal check link. In review the main button already runs the same check. */
export function canCheckExistingPayment(p: Plan) {
  return !!p.orderId && !p.committed && p.status !== "review";
}
/**
 * A cancelled offer that recorded a PayPal hold without a confirmed void:
 * cancelled before this studio kept a void key (older records), or a later
 * check of it failed. The check reads PayPal and voids any hold still there.
 */
export function canCheckCancelledHold(p: Plan) {
  return (
    p.status === "cancelled" &&
    !!p.orderId &&
    !!p.authorizationId &&
    (!p.voidKey || !!p.error)
  );
}
/**
 * The new customer's checkout link on an open plan. Shown only when the
 * backend reports the checkout page (an older API has no such route) and the
 * plan has a link: plans saved before the page existed do not.
 */
export function checkoutLinkVisible(
  p: Plan,
  backend: { checkoutPage?: boolean },
) {
  return (
    backend.checkoutPage === true &&
    !!p.checkoutToken &&
    !p.committed &&
    !["declined", "expired", "cancelled"].includes(p.status)
  );
}
