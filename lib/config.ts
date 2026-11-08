import { env } from "cloudflare:workers";
type Runtime = {
  PAYPAL_CLIENT_ID?: string;
  PAYPAL_CLIENT_SECRET?: string;
  PAYPAL_WEBHOOK_ID?: string;
  GEMINI_API_KEY?: string;
  GEMINI_MODEL?: string;
  AI_MODEL?: string;
  OPENAI_API_KEY?: string;
};
export const config = () => env as unknown as Runtime;
export const integrationStatus = () => {
  const c = config();
  return {
    paypal: !!(c.PAYPAL_CLIENT_ID && c.PAYPAL_CLIENT_SECRET),
    ai: !!c.GEMINI_API_KEY,
    aiProvider: c.GEMINI_API_KEY ? "Gemini" : null,
    aiModel: c.GEMINI_MODEL || "gemini-2.5-flash",
    webhooks: !!c.PAYPAL_WEBHOOK_ID,
  };
};
