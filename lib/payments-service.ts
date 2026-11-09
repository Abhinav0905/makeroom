import { config } from "./config";
import { PayPal } from "./paypal";
import { readStudio, updateStudio } from "./store";
import { DomainError } from "./domain";
import { createPayments } from "./payments-core";
import { createCheckout } from "./checkout";
function provider() {
  const c = config();
  if (!c.PAYPAL_CLIENT_ID || !c.PAYPAL_CLIENT_SECRET)
    throw new DomainError(
      "Connect your PayPal sandbox app in settings first.",
      503,
    );
  return new PayPal({
    clientId: c.PAYPAL_CLIENT_ID,
    secret: c.PAYPAL_CLIENT_SECRET,
  });
}
export const {
  fundBooking,
  finishFunding,
  beginCheckout,
  finishApproval,
  captureAndSettle,
  reconcile,
  cancelCheckout,
} = createPayments({ paypal: provider, readStudio, updateStudio });
// The new customer's checkout link uses the same payment steps.
export const checkout = createCheckout({
  payments: { beginCheckout, finishApproval },
  updateStudio,
});
