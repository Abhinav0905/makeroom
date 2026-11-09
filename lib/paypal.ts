export class PayPalError extends Error {
  status: number;
  debugId?: string;
  uncertain: boolean;
  issue?: string;
  constructor(
    message: string,
    status: number,
    debugId?: string,
    uncertain = false,
    issue?: string,
  ) {
    super(message);
    this.name = "PayPalError";
    this.status = status;
    this.debugId = debugId;
    this.uncertain = uncertain;
    this.issue = issue;
  }
}
export type PayPalConfig = { clientId: string; secret: string };
export type PayPalResource = {
  id: string;
  status: string;
  amount?: { value: string; currency_code: string };
  links?: { rel: string; href: string }[];
  purchase_units?: {
    payments?: {
      authorizations?: PayPalResource[];
      captures?: PayPalResource[];
    };
  }[];
};
const BASE = "https://api-m.sandbox.paypal.com";
export class PayPal {
  private config: PayPalConfig;
  private send: typeof fetch;
  constructor(config: PayPalConfig, send: typeof fetch = fetch) {
    this.config = config;
    this.send = send;
  }
  private async token() {
    const res = await this.send(BASE + "/v1/oauth2/token", {
      method: "POST",
      headers: {
        Authorization:
          "Basic " + btoa(this.config.clientId + ":" + this.config.secret),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok)
      throw new PayPalError(
        "PayPal sandbox credentials were not accepted.",
        res.status,
      );
    return ((await res.json()) as { access_token: string }).access_token;
  }
  async request<T = PayPalResource>(
    path: string,
    method = "GET",
    body?: unknown,
    key?: string,
  ): Promise<T> {
    const token = await this.token();
    let res: Response;
    try {
      res = await this.send(BASE + path, {
        method,
        headers: {
          Authorization: "Bearer " + token,
          "Content-Type": "application/json",
          Prefer: "return=representation",
          ...(key ? { "PayPal-Request-Id": key } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(20000),
      });
    } catch {
      throw new PayPalError(
        "PayPal's response did not arrive. Check the payment before trying again.",
        504,
        undefined,
        method !== "GET",
      );
    }
    const debug = res.headers.get("paypal-debug-id") || undefined;
    if (!res.ok) {
      const detail = (await res.json().catch(() => ({}))) as {
        details?: { issue?: string }[];
      };
      const issue = detail.details?.[0]?.issue || "REQUEST_FAILED";
      throw new PayPalError(
        "PayPal could not complete this step (" + issue + ").",
        res.status,
        debug,
        method !== "GET" && res.status >= 500,
        detail.details?.[0]?.issue,
      );
    }
    return (res.status === 204 ? {} : await res.json()) as T;
  }
  createOrder(
    amount: number,
    intent: "AUTHORIZE" | "CAPTURE",
    key: string,
    returnUrl: string,
    cancelUrl: string,
    description: string,
  ) {
    return this.request(
      "/v2/checkout/orders",
      "POST",
      {
        intent,
        purchase_units: [
          {
            reference_id: key,
            description,
            amount: { currency_code: "USD", value: (amount / 100).toFixed(2) },
          },
        ],
        payment_source: {
          paypal: {
            experience_context: {
              brand_name: "MakeRoom Studio",
              user_action: "PAY_NOW",
              shipping_preference: "NO_SHIPPING",
              return_url: returnUrl,
              cancel_url: cancelUrl,
            },
          },
        },
      },
      key,
    );
  }
  getOrder(order: string) {
    return this.request("/v2/checkout/orders/" + encodeURIComponent(order));
  }
  authorize(order: string, key: string) {
    return this.request(
      "/v2/checkout/orders/" + encodeURIComponent(order) + "/authorize",
      "POST",
      {},
      key,
    );
  }
  captureOrder(order: string, key: string) {
    return this.request(
      "/v2/checkout/orders/" + encodeURIComponent(order) + "/capture",
      "POST",
      {},
      key,
    );
  }
  capture(auth: string, key: string) {
    return this.request(
      "/v2/payments/authorizations/" + encodeURIComponent(auth) + "/capture",
      "POST",
      { final_capture: true },
      key,
    );
  }
  void(auth: string, key: string) {
    return this.request(
      "/v2/payments/authorizations/" + encodeURIComponent(auth) + "/void",
      "POST",
      {},
      key,
    );
  }
  getCapture(capture: string) {
    return this.request("/v2/payments/captures/" + encodeURIComponent(capture));
  }
  refund(capture: string, amount: number, key: string) {
    return this.request(
      "/v2/payments/captures/" + encodeURIComponent(capture) + "/refund",
      "POST",
      {
        amount: { currency_code: "USD", value: (amount / 100).toFixed(2) },
        note_to_payer: "Thank you for moving your MakeRoom appointment.",
      },
      key,
    );
  }
  getRefund(refund: string) {
    return this.request("/v2/payments/refunds/" + encodeURIComponent(refund));
  }
}
