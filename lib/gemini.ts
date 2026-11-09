import { validateDraft, preferencePrompt, DraftError } from "./preference.ts";
type GeminiReply = {
  candidates?: {
    finishReason?: string;
    content?: { parts?: { text?: string; thought?: boolean }[] };
  }[];
  promptFeedback?: { blockReason?: string };
};
const unchanged = "Your current terms are unchanged.";
/** A failure whose message is plain, contains no secret and is safe to show to the studio owner. */
export class ReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReadError";
  }
}
/** AbortSignal.timeout rejects with a TimeoutError; some runtimes report an AbortError. */
const timedOut = (e: unknown) =>
  typeof e === "object" &&
  e !== null &&
  "name" in e &&
  (e.name === "TimeoutError" || e.name === "AbortError");
export async function readPreference(
  key: string,
  model: string,
  message: string,
  duration: number,
  remaining: number,
  current: number,
  send: typeof fetch = fetch,
) {
  try {
    return await read(key, model, message, duration, remaining, current, send);
  } catch (e) {
    if (e instanceof ReadError) throw e;
    // Never pass raw runtime or parser text to the owner.
    throw new ReadError(
      `The AI step failed for an unexpected reason. ${unchanged} Enter the terms manually or try again.`,
    );
  }
}
async function read(
  key: string,
  model: string,
  message: string,
  duration: number,
  remaining: number,
  current: number,
  send: typeof fetch,
) {
  if (!/^[a-zA-Z0-9.-]+$/.test(model))
    throw new ReadError("Invalid AI model configuration.");
  let res: Response;
  try {
    res = await send(
      "https://generativelanguage.googleapis.com/v1beta/models/" +
        model +
        ":generateContent",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": key,
        },
        signal: AbortSignal.timeout(30000),
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [
                {
                  text: preferencePrompt(message, duration, remaining, current),
                },
              ],
            },
          ],
          generationConfig: {
            temperature: 0,
            // Gemini 2.5 counts its thinking toward this limit, so leave ample
            // room for the JSON after it. 8192 is accepted by every Gemini model.
            maxOutputTokens: 8192,
            responseMimeType: "application/json",
            responseSchema: {
              type: "OBJECT",
              properties: {
                alternatives: {
                  type: "ARRAY",
                  items: {
                    type: "OBJECT",
                    properties: {
                      start: { type: "STRING" },
                      refundCents: { type: "INTEGER" },
                      evidence: { type: "STRING" },
                    },
                    required: ["start", "refundCents", "evidence"],
                  },
                },
                clarification: { type: "STRING", nullable: true },
                explanation: { type: "STRING" },
              },
              required: ["alternatives", "clarification", "explanation"],
            },
          },
        }),
      },
    );
  } catch (e) {
    throw new ReadError(
      timedOut(e)
        ? `The AI provider did not respond in time. ${unchanged}`
        : `The AI provider could not be reached. Check the network connection and try again. ${unchanged}`,
    );
  }
  if (!res.ok)
    throw new ReadError(
      `The AI provider could not read this message (HTTP ${res.status}). ${unchanged}`,
    );
  let raw: string;
  try {
    raw = await res.text();
  } catch (e) {
    throw new ReadError(
      timedOut(e)
        ? `The AI provider started replying but did not finish in time. ${unchanged}`
        : `The connection to the AI provider dropped while its reply was arriving. ${unchanged}`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = undefined;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
    throw new ReadError(
      `The AI provider sent a reply in an unexpected format. ${unchanged} Try again in a moment.`,
    );
  const body = parsed as GeminiReply;
  const candidate = Array.isArray(body.candidates)
    ? body.candidates[0]
    : undefined;
  if (!candidate)
    throw new ReadError(
      body.promptFeedback?.blockReason
        ? "The AI provider declined to read this message. Enter the terms manually."
        : `The AI provider returned no answer. ${unchanged}`,
    );
  const reason = candidate.finishReason;
  if (reason === "MAX_TOKENS")
    throw new ReadError(
      "The AI reply was cut off before it finished. Try a shorter message or enter the terms manually.",
    );
  if (reason && reason !== "STOP")
    throw new ReadError(
      `The AI provider stopped early${/^[A-Z_]{1,40}$/.test(reason) ? ` (${reason})` : ""}. Enter the terms manually.`,
    );
  const parts = candidate.content?.parts;
  const text = (Array.isArray(parts) ? parts : [])
    .filter((p) => p && !p.thought)
    .map((p) => (typeof p.text === "string" ? p.text : ""))
    .join("");
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new ReadError(
      "The AI reply was not valid JSON. Enter the terms manually or try again.",
    );
  }
  try {
    return {
      draft: validateDraft(value, message, duration, remaining, current),
      model,
    };
  } catch (e) {
    throw new ReadError(
      e instanceof DraftError
        ? `The AI response did not pass the studio's checks. ${e.message} Enter the terms manually or try a clearer message.`
        : "The AI response did not pass the studio's checks. Enter the terms manually or try a clearer message.",
    );
  }
}
