// What each customer link may show. A link reveals only its holder's own
// booking: never another customer's name, a secret token or a PayPal ID.
// Pure, so node:test can check that nothing private leaks.
import { type Plan, type Studio } from "./domain.ts";
/** The view behind a moved customer's offer link. */
export function offerView(s: Studio, token: string) {
  const p = s.plan!;
  const m = p.moves.find((m) => m.token === token)!;
  return {
    name: m.name,
    from: m.from,
    to: m.to,
    duration: m.duration,
    refund: m.refund,
    date: s.date,
    mode: s.mode,
    consent: m.consent,
    status: p.status,
    expiresAt: p.expiresAt,
    service: s.bookings.find((b) => b.id === m.bookingId)!.service,
    committed: !!p.committed,
    refundStatus: m.refundStatus,
  };
}
/**
 * Where the new customer's payment stands: nothing yet, a PayPal checkout
 * opened, a hold approved, a check in progress, or paid and booked.
 */
export type CheckoutPayment = "none" | "started" | "on-hold" | "checking" | "paid";
export function checkoutPayment(p: Plan): CheckoutPayment {
  if (p.committed) return "paid";
  if (p.status === "review") return "checking";
  if (p.status === "authorized") return "on-hold";
  if (p.orderId && p.status === "proposed") return "started";
  return "none";
}
/** The view behind the new customer's checkout link. */
export function checkoutView(s: Studio) {
  const p = s.plan!;
  const r = p.request;
  return {
    name: r.name,
    service: r.service,
    date: s.date,
    start: r.start,
    duration: r.duration,
    price: r.base,
    flexibility: p.totalRefund,
    total: p.totalCharge,
    // Counts only: the offers promise each moved customer privacy.
    accepted: p.moves.filter((m) => m.consent === "accepted").length,
    affected: p.moves.length,
    status: p.status,
    mode: s.mode,
    expiresAt: p.expiresAt,
    booked: !!p.committed,
    payment: checkoutPayment(p),
  };
}
export type CheckoutView = ReturnType<typeof checkoutView>;
