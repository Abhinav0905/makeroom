import { config } from "./config";
import { PayPal, PayPalError, type PayPalResource } from "./paypal";
import { readStudio, updateStudio } from "./store";
import {
  DomainError,
  assertReady,
  commit,
  event,
  id,
  money,
  type Studio,
} from "./domain";
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
function approval(r: PayPalResource) {
  const url = r.links?.find((l) =>
    ["payer-action", "approve"].includes(l.rel),
  )?.href;
  if (!url || new URL(url).hostname !== "www.sandbox.paypal.com")
    throw new DomainError(
      "PayPal did not return a sandbox approval link.",
      502,
    );
  return url;
}
function confirmedAmount(r: PayPalResource, amount: number) {
  if (
    r.amount?.currency_code !== "USD" ||
    Number(r.amount.value) !== amount / 100
  )
    throw new DomainError(
      "The PayPal amount didn't match this booking. Manual review is required.",
    );
}
async function transaction(
  owner: string,
  kind: string,
  prepare: (s: Studio) => void,
  run: (
    s: Studio,
    save: (fn: (s: Studio) => void) => Promise<Studio>,
    api: PayPal,
  ) => Promise<void>,
  recovery = false,
) {
  const api = provider();
  const operationId = id();
  const s = await updateStudio(owner, (s) => {
    if (s.mode !== "sandbox")
      throw new DomainError(
        "Switch to PayPal sandbox to use this payment step.",
      );
    if (
      s.operation &&
      !(recovery && Date.now() - Date.parse(s.operation.startedAt) > 120_000)
    )
      throw new DomainError("A payment step is already running. Please wait.");
    prepare(s);
    s.operation = {
      id: operationId,
      kind,
      startedAt: new Date().toISOString(),
    };
  });
  const save = (fn: (s: Studio) => void) =>
    updateStudio(owner, (s) => {
      if (s.operation?.id !== operationId)
        throw new DomainError(
          "The payment lock changed. Check payment status.",
        );
      fn(s);
    });
  try {
    await run(s, save, api);
  } catch (e) {
    await save((s) => {
      if (s.plan) {
        s.plan.error =
          e instanceof Error ? e.message : "Payment step needs review.";
        if (e instanceof PayPalError && e.uncertain && !s.plan.committed)
          s.plan.status = "review";
      }
      event(
        s,
        "Payment needs attention",
        e instanceof Error ? e.message : "Please check payment status.",
        "notice",
      );
    }).catch(() => {});
    throw e;
  } finally {
    await save((s) => {
      delete s.operation;
    }).catch(() => {});
  }
  return readStudio(owner);
}
export async function fundBooking(
  owner: string,
  bookingId: string,
  origin: string,
) {
  return transaction(
    owner,
    "fund-booking",
    (s) => {
      if (s.plan?.orderId)
        throw new DomainError(
          "Finish the current request before funding another booking.",
        );
      const b = s.bookings.find((b) => b.id === bookingId);
      if (!b) throw new DomainError("Booking not found.", 404);
      if (b.captureId) throw new DomainError("This booking is already funded.");
      b.fundingKey ??= id();
      b.fundingCaptureKey ??= id();
    },
    async (s, save, api) => {
      const b = s.bookings.find((b) => b.id === bookingId)!;
      const r = b.fundingOrderId
        ? await api.getOrder(b.fundingOrderId)
        : await api.createOrder(
            b.prepaid,
            "CAPTURE",
            b.fundingKey!,
            origin + "/?paypal=booking&booking=" + b.id,
            origin + "/?paypal=cancel",
            "Prepaid " + b.service,
          );
      const url = approval(r);
      await save((s) => {
        const current = s.bookings.find((b) => b.id === bookingId)!;
        current.fundingOrderId = r.id;
        current.fundingApprovalUrl = url;
        event(
          s,
          "Original booking checkout ready",
          b.name +
            " can approve their " +
            money(b.prepaid) +
            " sandbox prepayment.",
          "payment",
        );
      });
    },
  );
}
export async function finishFunding(
  owner: string,
  bookingId: string,
  orderId: string,
) {
  return transaction(
    owner,
    "capture-prepayment",
    (s) => {
      const b = s.bookings.find((b) => b.id === bookingId);
      if (!b || b.fundingOrderId !== orderId)
        throw new DomainError(
          "This checkout does not belong to the booking.",
          400,
        );
    },
    async (s, save, api) => {
      const b = s.bookings.find((b) => b.id === bookingId)!;
      if (b.captureId) return;
      let r = await api.getOrder(orderId);
      if (!r.purchase_units?.[0]?.payments?.captures?.length)
        r = await api.captureOrder(orderId, b.fundingCaptureKey!);
      const cap = r.purchase_units?.[0]?.payments?.captures?.[0];
      if (!cap)
        throw new DomainError("PayPal has not returned a payment result yet.");
      const verified = await api.getCapture(cap.id);
      confirmedAmount(verified, b.prepaid);
      if (verified.status !== "COMPLETED")
        throw new DomainError(
          "The original payment is " +
            verified.status.toLowerCase() +
            ". Check again before offering refunds.",
        );
      await save((s) => {
        const current = s.bookings.find((b) => b.id === bookingId)!;
        current.captureId = verified.id;
        delete current.fundingApprovalUrl;
        event(
          s,
          "Original booking funded",
          b.name +
            "'s " +
            money(b.prepaid) +
            " sandbox payment was read back as completed.",
          "payment",
        );
      });
    },
  );
}
export async function beginCheckout(owner: string, origin: string) {
  return transaction(
    owner,
    "create-checkout",
    (s) => {
      assertReady(s);
    },
    async (s, save, api) => {
      const p = s.plan!;
      const order = p.orderId
        ? await api.getOrder(p.orderId)
        : await api.createOrder(
            p.totalCharge,
            "AUTHORIZE",
            p.orderKey,
            origin + "/?paypal=request",
            origin + "/?paypal=cancel",
            "Studio session with agreed flexibility refunds",
          );
      const url = approval(order);
      await save((s) => {
        s.plan!.orderId = order.id;
        s.plan!.approvalUrl = url;
        event(
          s,
          "Customer checkout ready",
          money(p.totalCharge) +
            " will be authorized. The booking is not confirmed yet.",
          "payment",
        );
      });
    },
  );
}
export async function finishApproval(owner: string, orderId: string) {
  return transaction(
    owner,
    "authorize",
    (s) => {
      const p = s.plan;
      if (!p || p.orderId !== orderId)
        throw new DomainError(
          "This checkout does not belong to the current offer.",
          400,
        );
      if (p.status !== "authorized") assertReady(s);
    },
    async (s, save, api) => {
      const p = s.plan!;
      if (p.authorizationId) return;
      let order = await api.getOrder(orderId);
      if (!order.purchase_units?.[0]?.payments?.authorizations?.length)
        order = await api.authorize(orderId, p.authorizeKey);
      const a = order.purchase_units?.[0]?.payments?.authorizations?.[0];
      if (!a || a.status !== "CREATED")
        throw new DomainError("The buyer's payment is not authorized yet.");
      confirmedAmount(a, p.totalCharge);
      await save((s) => {
        s.plan!.authorizationId = a.id;
        s.plan!.status = "authorized";
        delete s.plan!.approvalUrl;
        event(
          s,
          "Payment authorized",
          money(p.totalCharge) +
            " is on hold. Review the arrangement before confirming the booking.",
          "payment",
        );
      });
    },
  );
}
async function refundMoves(
  snapshot: Studio,
  save: (fn: (s: Studio) => void) => Promise<Studio>,
  api: PayPal,
) {
  for (const move of snapshot.plan!.moves) {
    if (move.refundStatus === "COMPLETED") continue;
    if (move.refund === 0) {
      await save((s) => {
        s.plan!.moves.find(
          (m) => m.bookingId === move.bookingId,
        )!.refundStatus = "COMPLETED";
      });
      continue;
    }
    if (move.refundStatus === "FAILED" || move.refundStatus === "CANCELLED")
      continue;
    const booking = snapshot.bookings.find((b) => b.id === move.bookingId)!;
    if (!booking.captureId)
      throw new DomainError("Original payment reference is missing.");
    if (
      !move.refundId &&
      move.refundAttemptAt &&
      Date.now() - Date.parse(move.refundAttemptAt) > 5 * 60 * 60_000
    )
      throw new DomainError(
        "An earlier refund has an unknown result. Check it in PayPal before making another refund.",
      );
    await save((s) => {
      const m = s.plan!.moves.find((m) => m.bookingId === move.bookingId)!;
      m.refundAttemptAt ??= new Date().toISOString();
      m.refundStatus ??= "REQUESTED";
    });
    const r = move.refundId
      ? await api.getRefund(move.refundId)
      : await api.refund(booking.captureId, move.refund, move.refundKey);
    confirmedAmount(r, move.refund);
    await save((s) => {
      const m = s.plan!.moves.find((m) => m.bookingId === move.bookingId)!;
      const wasComplete = m.refundStatus === "COMPLETED";
      m.refundId = r.id;
      m.refundStatus = r.status;
      if (r.status === "COMPLETED" && !wasComplete)
        s.bookings.find((b) => b.id === m.bookingId)!.refunded += m.refund;
      event(
        s,
        r.status === "COMPLETED"
          ? "Refund completed"
          : "Refund " + r.status.toLowerCase(),
        move.name + ": " + money(move.refund) + " via PayPal sandbox.",
        "payment",
      );
    });
  }
  await save((s) => {
    s.plan!.status = s.plan!.moves.every((m) => m.refundStatus === "COMPLETED")
      ? "complete"
      : "settling";
    delete s.plan!.error;
  });
}
export async function captureAndSettle(owner: string) {
  return transaction(
    owner,
    "capture-and-refund",
    (s) => {
      const p = s.plan;
      if (!p || p.status !== "authorized" || !p.authorizationId)
        throw new DomainError("A current buyer authorization is required.");
      if (Date.parse(p.expiresAt) < Date.now())
        throw new DomainError(
          "The offer expired. Cancel the authorization and ask for new approvals.",
        );
      if (p.moves.some((m) => m.consent !== "accepted"))
        throw new DomainError("Every customer must accept.");
      p.paymentAttemptAt ??= new Date().toISOString();
    },
    async (s, save, api) => {
      const p = s.plan!;
      const result = await api.capture(p.authorizationId!, p.captureKey);
      await save((s) => {
        s.plan!.captureId = result.id;
        s.plan!.captureStatus = result.status;
      });
      const verified = await api.getCapture(result.id);
      confirmedAmount(verified, p.totalCharge);
      const updated = await save((s) => {
        s.plan!.captureStatus = verified.status;
        if (verified.status === "COMPLETED") {
          commit(s);
        } else {
          s.plan!.status = "review";
        }
      });
      if (verified.status === "COMPLETED")
        await refundMoves(updated, save, api);
    },
  );
}
export async function reconcile(owner: string) {
  return transaction(
    owner,
    "reconcile",
    (s) => {
      if (!s.plan?.orderId)
        throw new DomainError("There is no PayPal request to check.");
    },
    async (s, save, api) => {
      const p = s.plan!;
      let capture: PayPalResource | undefined;
      if (p.captureId) capture = await api.getCapture(p.captureId);
      else {
        const order = await api.getOrder(p.orderId!);
        capture = order.purchase_units?.[0]?.payments?.captures?.[0];
        const auth = order.purchase_units?.[0]?.payments?.authorizations?.[0];
        if (!capture && auth && auth.status === "CREATED") {
          await save((s) => {
            s.plan!.authorizationId = auth.id;
            if (s.plan!.status !== "review") s.plan!.status = "authorized";
          });
        }
      }
      if (capture) {
        confirmedAmount(capture, p.totalCharge);
        const updated = await save((s) => {
          s.plan!.captureId = capture!.id;
          s.plan!.captureStatus = capture!.status;
          if (capture!.status === "COMPLETED") commit(s);
        });
        if (capture.status === "COMPLETED")
          await refundMoves(updated, save, api);
      } else if (p.committed) await refundMoves(s, save, api);
      else
        await save((s) =>
          event(
            s,
            "PayPal checked",
            "No completed capture was found. The original appointments remain unchanged.",
            "notice",
          ),
        );
    },
    true,
  );
}
export async function cancelCheckout(owner: string) {
  return transaction(
    owner,
    "cancel-checkout",
    (s) => {
      const p = s.plan;
      if (!p || p.committed || p.captureId || p.status === "review")
        throw new DomainError(
          "This payment needs reconciliation before it can be cancelled.",
        );
    },
    async (s, save, api) => {
      const p = s.plan!;
      if (p.authorizationId) await api.void(p.authorizationId, p.authorizeKey);
      await save((s) => {
        s.plan!.status = "cancelled";
        delete s.plan!.approvalUrl;
        event(
          s,
          "Offer cancelled",
          "Original appointments are unchanged. Any uncaptured authorization was voided.",
          "payment",
        );
      });
    },
  );
}
