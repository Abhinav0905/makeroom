import { config } from "./config";
import { DomainError, type Booking } from "./domain";
import { readPreference } from "./gemini";
export async function interpret(message: string, b: Booking) {
  const c = config();
  if (!c.GEMINI_API_KEY)
    throw new DomainError(
      "AI isn't connected yet. You can enter and review the exact terms below.",
      503,
    );
  try {
    return await readPreference(
      c.GEMINI_API_KEY,
      c.GEMINI_MODEL || "gemini-2.5-flash",
      message,
      b.duration,
      b.prepaid - b.refunded,
      b.start,
    );
  } catch (e) {
    throw new DomainError(
      e instanceof Error
        ? e.message
        : "The AI provider did not respond. Your current terms are unchanged.",
      422,
    );
  }
}
