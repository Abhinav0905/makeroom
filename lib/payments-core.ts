// PayPal payment orchestration with its storage and PayPal client injected,
// so node:test can drive it without Cloudflare bindings. lib/payments-service.ts
// wires it to the real store and credentials.
import { PayPal, PayPalError, type PayPalResource } from "./paypal.ts";
import {
  DomainError,
  assertReady,
  commit,
  event,
  id,
  money,
  type Booking,
  type Move,
  type Studio,
} from "./domain.ts";
export type PaymentsDeps = {
  paypal(): PayPal;
  readStudio(owner: string): Promise<Studio>;
  updateStudio(owner: string, fn: (s: Studio) => void): Promise<Studio>;
  now?(): number;
};
type Save = (fn: (s: Studio) => void) => Promise<Studio>;
// What PayPal shows for the current plan after syncFromPayPal has applied it.
type Synced =
  | { kind: "captured" }
  | { kind: "pending" }
  | { kind: "held"; authorizationId: string }
  | { kind: "auth-pending" }
  | { kind: "awaiting-buyer" }
  | { kind: "released" };
// Only these steps can leave money in an unknown state at PayPal for the plan.
// Funding steps concern an original booking and never change the plan.
const PLAN_REVIEW_KINDS = [
  "authorize",
  "capture-and-refund",
  "cancel-checkout",
  "reconcile",
];
const FUNDING_KINDS = ["fund-booking", "capture-prepayment"];
const FAILED_CAPTURE = ["DECLINED", "FAILED"];
const FAILED_REFUND = ["FAILED", "CANCELLED"];
const RETRY_REFUND = [...FAILED_REFUND, "REJECTED"];
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
function captureProblem(status: string) {
  if (status === "PENDING")
    return "PayPal is still reviewing this payment. No appointment has moved. Use Check payment in a few minutes.";
  if (FAILED_CAPTURE.includes(status))
    return "PayPal declined this payment. No appointment has moved. Use Check payment to retry or cancel.";
  return (
    "PayPal reports this payment as " +
    status.toLowerCase() +
    ". No appointment has moved. Use Check payment."
  );
}
// A 4xx means PayPal refused the request outright, so a new key cannot repeat
// money movement. 409 and 429 are "try again later", like a timeout.
function definitelyRefused(e: unknown): e is PayPalError {
  return (
    e instanceof PayPalError &&
    !e.uncertain &&
    e.status >= 400 &&
    e.status < 500 &&
    e.status !== 409 &&
    e.status !== 429
  );
}
export function createPayments(deps: PaymentsDeps) {
  const now = () => (deps.now ? deps.now() : Date.now());
  async function transaction(
    owner: string,
    kind: string,
    prepare: (s: Studio) => void,
    run: (s: Studio, save: Save, api: PayPal) => Promise<void>,
    recovery = false,
  ) {
    const api = deps.paypal();
    const operationId = id();
    const s = await deps.updateStudio(owner, (s) => {
      if (s.mode !== "sandbox")
        throw new DomainError(
          "Switch to PayPal sandbox to use this payment step.",
        );
      if (
        s.operation &&
        !(recovery && now() - Date.parse(s.operation.startedAt) > 120_000)
      )
        throw new DomainError(
          "A payment step is already running. Please wait.",
        );
      prepare(s);
      s.operation = {
        id: operationId,
        kind,
        startedAt: new Date(now()).toISOString(),
      };
    });
    const save: Save = (fn) =>
      deps.updateStudio(owner, (s) => {
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
        const p = s.plan;
        // A complete plan has nothing left to fix, so a refused step (Cancel
        // after PayPal had already taken the payment) is logged below but not
        // left on the plan, where no button could clear it.
        if (p && !FUNDING_KINDS.includes(kind) && p.status !== "complete") {
          p.error =
            e instanceof Error ? e.message : "Payment step needs review.";
          // Review means "PayPal may hold or have moved money for this plan".
          // Without an order there is nothing at PayPal to hold money.
          if (
            e instanceof PayPalError &&
            e.uncertain &&
            PLAN_REVIEW_KINDS.includes(kind) &&
            p.orderId &&
            !p.committed
          )
            p.status = "review";
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
    return deps.readStudio(owner);
  }
  // Capture a booking's prepayment order (finishFunding's path) and record it
  // once PayPal reads it back as completed.
  async function captureFunding(
    b: Booking,
    order: PayPalResource,
    save: Save,
    api: PayPal,
  ) {
    let r = order;
    if (!r.purchase_units?.[0]?.payments?.captures?.length)
      r = await api.captureOrder(b.fundingOrderId!, b.fundingCaptureKey!);
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
      const current = s.bookings.find((x) => x.id === b.id)!;
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
  }
  async function fundBooking(owner: string, bookingId: string, origin: string) {
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
        if (b.captureId)
          throw new DomainError("This booking is already funded.");
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
        // The customer already approved but the return redirect was lost:
        // there is no approval link left, so finish the capture instead.
        if (b.fundingOrderId && ["APPROVED", "COMPLETED"].includes(r.status))
          return captureFunding(b, r, save, api);
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
  async function finishFunding(
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
        await captureFunding(b, await api.getOrder(orderId), save, api);
      },
    );
  }
  async function beginCheckout(owner: string, origin: string) {
    return transaction(
      owner,
      "create-checkout",
      (s) => {
        assertReady(s);
      },
      async (s, save, api) => {
        const p = s.plan!;
        // A retry after a lost response reuses orderKey, so PayPal returns
        // the order it already created instead of a second one.
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
          delete s.plan!.error;
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
  async function finishApproval(owner: string, orderId: string) {
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
        if (p.status === "review")
          throw new DomainError(
            "This payment needs a check first. Use Check payment.",
          );
        if (
          p.status === "expired" ||
          (p.status === "proposed" && Date.parse(p.expiresAt) < now())
        )
          throw new DomainError(
            "This offer expired before payment was authorized; cancel it.",
          );
        if (p.status !== "authorized") assertReady(s);
      },
      async (s, save, api) => {
        const p = s.plan!;
        if (p.authorizationId) return;
        let order = await api.getOrder(orderId);
        if (!order.purchase_units?.[0]?.payments?.authorizations?.length)
          order = await api.authorize(orderId, p.authorizeKey);
        await recordAuthorization(order, p.totalCharge, save);
      },
    );
  }
  // finishApproval's checks on an authorize result, shared with reconcile.
  async function recordAuthorization(
    order: PayPalResource,
    total: number,
    save: Save,
  ) {
    const a = order.purchase_units?.[0]?.payments?.authorizations?.[0];
    if (!a || a.status !== "CREATED")
      throw new DomainError("The buyer's payment is not authorized yet.");
    confirmedAmount(a, total);
    await save((s) => {
      s.plan!.authorizationId = a.id;
      s.plan!.status = "authorized";
      delete s.plan!.approvalUrl;
      delete s.plan!.error;
      event(
        s,
        "Payment authorized",
        money(total) +
          " is on hold. Review the arrangement before confirming the booking.",
        "payment",
      );
    });
    return a.id;
  }
  // One move's refund. Problems are returned, not thrown, so one customer's
  // refund cannot block another's. Errors from save() still propagate: a lost
  // payment lock must stop the whole pass.
  async function refundMove(
    move: Move,
    captureId: string | undefined,
    save: Save,
    api: PayPal,
  ): Promise<string | undefined> {
    const update = (fn: (m: Move, s: Studio) => void) =>
      save((s) =>
        fn(s.plan!.moves.find((m) => m.bookingId === move.bookingId)!, s),
      );
    // UNKNOWN needs a person to look in PayPal; it is never retried here.
    const manual = async (message: string, refundId?: string) => {
      await update((m, s) => {
        m.refundStatus = "UNKNOWN";
        m.refundError = message;
        if (refundId) m.refundId = refundId;
        event(
          s,
          "Refund needs manual review",
          move.name + ": " + message,
          "notice",
        );
      });
      return message;
    };
    const record = async (r: PayPalResource) => {
      try {
        confirmedAmount(r, move.refund);
      } catch {
        return manual(
          "PayPal returned a different refund amount. Check it in PayPal.",
          r.id,
        );
      }
      await update((m, s) => {
        const wasComplete = m.refundStatus === "COMPLETED";
        m.refundId = r.id;
        m.refundStatus = r.status;
        delete m.refundError;
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
      if (FAILED_REFUND.includes(r.status))
        return (
          "PayPal reported the refund as " +
          r.status.toLowerCase() +
          ". Use Check payment & refunds to try again."
        );
    };
    // Timeouts, 5xx, 409 and 429 leave the result unknown: keep REQUESTED and
    // the same key so the next check repeats the identical request.
    const unsure = (e: unknown) =>
      e instanceof Error ? e.message : "PayPal's response did not arrive.";
    if (move.refundStatus === "UNKNOWN")
      return move.refundError ?? "Check this refund in PayPal.";
    if (!captureId) return manual("Original payment reference is missing.");
    let refundId = move.refundId;
    let key = move.refundKey;
    // This key already went to PayPal once and no definite answer came back.
    let repeat = false;
    if (RETRY_REFUND.includes(move.refundStatus ?? "")) {
      if (refundId) {
        let r: PayPalResource;
        try {
          r = await api.getRefund(refundId);
        } catch (e) {
          return unsure(e);
        }
        if (!FAILED_REFUND.includes(r.status)) return record(r);
      }
      // PayPal definitely did not pay this refund. The old key would only
      // replay that answer, so retry once with a new one.
      key = id();
      refundId = undefined;
      await update((m) => {
        if (m.refundId) (m.previousRefundIds ??= []).push(m.refundId);
        m.refundKey = key;
        delete m.refundId;
        delete m.refundStatus;
        delete m.refundAttemptAt;
        delete m.refundError;
      });
    } else if (!refundId && move.refundAttemptAt) {
      if (now() - Date.parse(move.refundAttemptAt) > 5 * 60 * 60_000)
        return manual(
          "An earlier refund has an unknown result. Check it in PayPal before making another refund.",
        );
      repeat = true;
    }
    await update((m) => {
      m.refundAttemptAt ??= new Date(now()).toISOString();
      m.refundStatus ??= "REQUESTED";
    });
    let r: PayPalResource;
    try {
      r = refundId
        ? await api.getRefund(refundId)
        : await api.refund(captureId, move.refund, key);
    } catch (e) {
      if (refundId || !definitelyRefused(e)) return unsure(e);
      const issue = e.issue ?? "REQUEST_FAILED";
      // Refusing a repeat does not prove the first request failed: it may be
      // in progress or done, so a new key could pay this customer twice.
      if (repeat)
        return manual(
          "PayPal refused a repeat of an earlier refund whose result is unknown (" +
            issue +
            "). Check it in PayPal before making another refund.",
        );
      await update((m, s) => {
        m.refundStatus = "REJECTED";
        m.refundError = issue;
        event(
          s,
          "Refund rejected",
          move.name +
            ": PayPal refused the " +
            money(move.refund) +
            " refund (" +
            issue +
            ").",
          "notice",
        );
      });
      return (
        "PayPal refused the refund (" +
        issue +
        "). Use Check payment & refunds to try again."
      );
    }
    return record(r);
  }
  async function refundMoves(snapshot: Studio, save: Save, api: PayPal) {
    const problems: string[] = [];
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
      const booking = snapshot.bookings.find((b) => b.id === move.bookingId)!;
      const problem = await refundMove(move, booking.captureId, save, api);
      if (problem) problems.push(move.name.split(" ")[0] + ": " + problem);
    }
    const message = problems.length
      ? "Booking confirmed. Some refunds need attention: " + problems.join(" ")
      : undefined;
    await save((s) => {
      s.plan!.status = s.plan!.moves.every(
        (m) => m.refundStatus === "COMPLETED",
      )
        ? "complete"
        : "settling";
      if (message) s.plan!.error = message;
      else delete s.plan!.error;
    });
    if (message) throw new DomainError(message);
  }
  // A COMPLETED capture: confirm the booking and pay the agreed refunds.
  async function settle(
    capture: PayPalResource,
    authorizationId: string | undefined,
    save: Save,
    api: PayPal,
    total: number,
  ) {
    confirmedAmount(capture, total);
    const updated = await save((s) => {
      s.plan!.captureId = capture.id;
      s.plan!.captureStatus = capture.status;
      if (authorizationId) s.plan!.authorizationId ??= authorizationId;
      commit(s);
    });
    await refundMoves(updated, save, api);
  }
  // Read the plan's payment from PayPal and move the plan to the state PayPal
  // proves. Used by reconcile, and by cancel (cancelling = true) when a hold
  // may exist that the studio has not recorded; cancel must never create an
  // authorization and leaves the final save to the cancel itself.
  async function syncFromPayPal(
    s: Studio,
    save: Save,
    api: PayPal,
    cancelling: boolean,
  ): Promise<Synced> {
    const p = s.plan!;
    const toReview = async (message: string): Promise<never> => {
      await save((s) => {
        if (!s.plan!.committed) s.plan!.status = "review";
      });
      throw new DomainError(message);
    };
    if (p.committed) {
      // The booking was confirmed against a completed capture; only refunds
      // can remain.
      const capture = await api.getCapture(p.captureId!);
      if (capture.status !== "COMPLETED")
        await toReview(
          "PayPal now reports this payment as " +
            capture.status.toLowerCase() +
            ". Check it in PayPal before more refunds are made.",
        );
      await settle(capture, undefined, save, api, p.totalCharge);
      return { kind: "captured" };
    }
    const seen: PayPalResource[] = [];
    if (p.captureId) seen.push(await api.getCapture(p.captureId));
    let order: PayPalResource | undefined;
    if (!seen.some((c) => ["COMPLETED", "PENDING"].includes(c.status))) {
      try {
        order = await api.getOrder(p.orderId!);
      } catch (e) {
        // An order PayPal no longer has cannot hold money, unless this studio
        // already recorded an authorization or capture for it.
        if (
          !(e instanceof PayPalError) ||
          e.status !== 404 ||
          p.authorizationId ||
          p.captureId
        )
          throw e;
      }
      seen.push(...(order?.purchase_units?.[0]?.payments?.captures ?? []));
    }
    const auth = order?.purchase_units?.[0]?.payments?.authorizations?.[0];
    const capture =
      seen.find((c) => c.status === "COMPLETED") ??
      seen.find((c) => c.status === "PENDING") ??
      seen.find((c) => !FAILED_CAPTURE.includes(c.status));
    // (a) PayPal took the payment.
    if (capture?.status === "COMPLETED") {
      await settle(capture, auth?.id, save, api, p.totalCharge);
      return { kind: "captured" };
    }
    // (b) PayPal is still reviewing the payment.
    if (capture?.status === "PENDING") {
      confirmedAmount(capture, p.totalCharge);
      await save((s) => {
        s.plan!.captureId = capture.id;
        s.plan!.captureStatus = capture.status;
        s.plan!.status = "review";
        s.plan!.error = captureProblem("PENDING");
        event(
          s,
          "Payment pending",
          "PayPal is still reviewing this payment; nothing has moved.",
          "payment",
        );
      });
      return { kind: "pending" };
    }
    if (capture)
      await toReview(
        "PayPal reports this payment as " +
          capture.status.toLowerCase() +
          ". Manual review is required.",
      );
    // (c) The authorization was captured but the capture is not readable.
    if (auth && ["CAPTURED", "PARTIALLY_CAPTURED"].includes(auth.status))
      await toReview(
        "PayPal shows this authorization as captured, but the capture could not be read. Check it in PayPal.",
      );
    // (d) Only declined or failed captures, or none at all.
    const failed = seen.filter(
      (c) =>
        FAILED_CAPTURE.includes(c.status) &&
        !p.failedCaptureIds?.includes(c.id),
    );
    if (failed.length || p.captureId)
      await save((s) => {
        const q = s.plan!;
        for (const c of failed)
          if (!q.failedCaptureIds?.includes(c.id))
            (q.failedCaptureIds ??= []).push(c.id);
        // The old key would replay the declined capture. Only a definite
        // failure rotates it, never a timeout.
        if (failed.length) q.captureKey = id();
        delete q.captureId;
        delete q.captureStatus;
        if (failed.length)
          event(
            s,
            "Payment declined",
            "PayPal declined the capture. No appointment has moved.",
            "payment",
          );
      });
    const release = async (why: string): Promise<Synced> => {
      if (!cancelling)
        await save((s) => {
          s.plan!.status = "cancelled";
          delete s.plan!.approvalUrl;
          delete s.plan!.error;
          event(
            s,
            "No payment is held",
            why + " The original appointments are unchanged.",
            "payment",
          );
        });
      return { kind: "released" };
    };
    if (auth?.status === "CREATED") {
      confirmedAmount(auth, p.totalCharge);
      await save((s) => {
        const q = s.plan!;
        q.authorizationId = auth.id;
        // A cancelled plan stays cancelled; reconcile then voids the hold.
        if (q.status === "cancelled") return;
        q.status = "authorized";
        delete q.approvalUrl;
        delete q.error;
        event(
          s,
          "PayPal checked",
          money(q.totalCharge) +
            " is on hold. No appointment has moved yet.",
          "payment",
        );
      });
      return { kind: "held", authorizationId: auth.id };
    }
    if (auth?.status === "PENDING") {
      await save((s) =>
        event(
          s,
          "Authorization pending",
          "PayPal is still reviewing the buyer's authorization. Nothing has moved.",
          "notice",
        ),
      );
      return { kind: "auth-pending" };
    }
    if (auth && ["VOIDED", "DENIED", "EXPIRED"].includes(auth.status))
      return release(
        "PayPal reports the authorization as " +
          auth.status.toLowerCase() +
          ".",
      );
    if (auth)
      await toReview(
        "PayPal reports the authorization as " +
          auth.status.toLowerCase() +
          ". Manual review is required.",
      );
    // No authorization yet.
    const open =
      ["proposed", "review"].includes(p.status) &&
      p.moves.every((m) => m.consent === "accepted") &&
      Date.parse(p.expiresAt) > now() &&
      s.bookings.every(
        (b) => !p.moves.some((m) => m.bookingId === b.id) || !!b.captureId,
      );
    if (!cancelling && open && order?.status === "APPROVED") {
      // The buyer approved but the authorize result was lost (redirect or
      // timeout). The same authorizeKey makes this the same request.
      const authorizationId = await recordAuthorization(
        await api.authorize(p.orderId!, p.authorizeKey),
        p.totalCharge,
        save,
      );
      return { kind: "held", authorizationId };
    }
    if (
      !cancelling &&
      open &&
      ["CREATED", "SAVED", "PAYER_ACTION_REQUIRED"].includes(
        order?.status ?? "",
      )
    ) {
      await save((s) => {
        s.plan!.status = "proposed";
        delete s.plan!.error;
        event(
          s,
          "PayPal checked",
          "The buyer has not approved the payment yet. Nothing is held.",
          "notice",
        );
      });
      return { kind: "awaiting-buyer" };
    }
    return release(
      order
        ? "PayPal shows no authorization for this offer."
        : "PayPal has no record of this checkout.",
    );
  }
  // Void an authorization with the plan's own void key and accept only a
  // confirmed VOIDED result.
  async function voidHold(
    s: Studio,
    authorizationId: string,
    save: Save,
    api: PayPal,
  ) {
    const p = s.plan!;
    let r: PayPalResource;
    try {
      r = await api.void(authorizationId, p.voidKey!);
    } catch (e) {
      if (e instanceof PayPalError && e.issue === "PREVIOUSLY_CAPTURED") {
        await save((s) => {
          s.plan!.status = "review";
        });
        throw new DomainError(
          "PayPal shows this payment was captured; use Check payment.",
        );
      }
      throw e;
    }
    let status = r.status;
    if (!status && p.orderId) {
      // An empty 204 body: read the authorization back from the order.
      const auths =
        (await api.getOrder(p.orderId)).purchase_units?.[0]?.payments
          ?.authorizations ?? [];
      status = (auths.find((a) => a.id === authorizationId) ?? auths[0])
        ?.status;
    }
    if (status !== "VOIDED")
      throw new DomainError("PayPal did not confirm the void.");
  }
  async function captureAndSettle(owner: string) {
    return transaction(
      owner,
      "capture-and-refund",
      (s) => {
        const p = s.plan;
        if (!p || p.status !== "authorized" || !p.authorizationId)
          throw new DomainError("A current buyer authorization is required.");
        if (Date.parse(p.expiresAt) < now())
          throw new DomainError(
            "The offer expired. Cancel the authorization and ask for new approvals.",
          );
        if (p.moves.some((m) => m.consent !== "accepted"))
          throw new DomainError("Every customer must accept.");
        p.paymentAttemptAt ??= new Date(now()).toISOString();
      },
      async (s, save, api) => {
        const p = s.plan!;
        const result = await api.capture(p.authorizationId!, p.captureKey);
        await save((s) => {
          s.plan!.captureId = result.id;
          s.plan!.captureStatus = result.status;
        });
        const verified = await api.getCapture(result.id);
        try {
          confirmedAmount(verified, p.totalCharge);
        } catch (e) {
          await save((s) => {
            s.plan!.captureStatus = verified.status;
            s.plan!.status = "review";
          });
          throw e;
        }
        const completed = verified.status === "COMPLETED";
        const updated = await save((s) => {
          s.plan!.captureStatus = verified.status;
          if (completed) {
            commit(s);
          } else {
            s.plan!.status = "review";
            event(
              s,
              "Payment " + verified.status.toLowerCase(),
              "PayPal reported the capture as " +
                verified.status.toLowerCase() +
                ". No appointment has moved.",
              "payment",
            );
          }
        });
        if (!completed) throw new DomainError(captureProblem(verified.status));
        await refundMoves(updated, save, api);
      },
    );
  }
  async function reconcile(owner: string) {
    let restored = false;
    return transaction(
      owner,
      "reconcile",
      (s) => {
        const p = s.plan;
        // Older records could enter review when order creation timed out.
        // With no order there is nothing at PayPal to check or hold money.
        if (p && !p.orderId && p.status === "review") {
          p.status = "proposed";
          delete p.error;
          event(
            s,
            "Payment check complete",
            "No PayPal checkout was recorded for this offer, so nothing is held. You can request payment again.",
            "notice",
          );
          restored = true;
          return;
        }
        if (!p?.orderId)
          throw new DomainError("There is no PayPal request to check.");
        p.voidKey ??= id();
      },
      async (s, save, api) => {
        if (restored) return;
        const r = await syncFromPayPal(s, save, api, false);
        if (r.kind === "held" && s.plan!.status === "cancelled") {
          // A cancelled offer whose hold PayPal still shows: finish the void.
          await voidHold(s, r.authorizationId, save, api);
          await save((s) =>
            event(
              s,
              "Authorization voided",
              "PayPal confirmed the hold for this cancelled offer was released.",
              "payment",
            ),
          );
        }
      },
      true,
    );
  }
  async function cancelCheckout(owner: string) {
    return transaction(
      owner,
      "cancel-checkout",
      (s) => {
        const p = s.plan;
        if (!p)
          throw new DomainError(
            "This payment needs reconciliation before it can be cancelled.",
          );
        if (
          p.committed ||
          ["COMPLETED", "PENDING"].includes(p.captureStatus ?? "")
        )
          throw new DomainError(
            "PayPal has taken this payment. Use Check payment.",
          );
        if (!["proposed", "expired", "authorized", "review"].includes(p.status))
          throw new DomainError("This offer is already closed.");
        // Saved before any PayPal call, so a retried void repeats the same
        // request instead of making a new one.
        p.voidKey ??= id();
      },
      async (s, save, api) => {
        const p = s.plan!;
        let hold = p.authorizationId;
        // Read PayPal first whenever it could hold money this studio has not
        // recorded: after review, or when an authorize result was never saved
        // (a failed save, an amount mismatch or a pending authorization).
        if (p.orderId && (p.status === "review" || !hold)) {
          // Cancel only after PayPal proves nothing was captured.
          const r = await syncFromPayPal(s, save, api, true);
          if (r.kind === "captured" || r.kind === "pending")
            throw new DomainError(
              "PayPal shows a payment for this booking; it was not cancelled.",
            );
          if (r.kind === "auth-pending")
            throw new DomainError(
              "PayPal is still reviewing this authorization; it was not cancelled. Use Check payment in a few minutes.",
            );
          hold = r.kind === "held" ? r.authorizationId : undefined;
        }
        if (hold) await voidHold(s, hold, save, api);
        await save((s) => {
          s.plan!.status = "cancelled";
          delete s.plan!.approvalUrl;
          delete s.plan!.error;
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
  return {
    fundBooking,
    finishFunding,
    beginCheckout,
    finishApproval,
    captureAndSettle,
    reconcile,
    cancelCheckout,
  };
}
