import { validateDraft, preferencePrompt, DraftError } from "./preference.ts";
type GeminiReply = {
  candidates?: {
    finishReason?: string;
    content?: { parts?: { text?: string; thought?: boolean }[] };
  }[];
  promptFeedback?: { blockReason?: string };
};
const unchanged = "Your current terms are unchanged.";
export async function readPreference(
  key: string,
  model: string,
  message: string,
  duration: number,
  remaining: number,
  current: number,
  send: typeof fetch = fetch,
) {
  if (!/^[a-zA-Z0-9.-]+$/.test(model))
    throw new Error("Invalid AI model configuration.");
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
  } catch {
    throw new Error(`The AI provider did not respond in time. ${unchanged}`);
  }
  if (!res.ok)
    throw new Error(
      `The AI provider could not read this message (HTTP ${res.status}). ${unchanged}`,
    );
  const body = (await res.json()) as GeminiReply;
  const candidate = body.candidates?.[0];
  if (!candidate)
    throw new Error(
      body.promptFeedback?.blockReason
        ? "The AI provider declined to read this message. Enter the terms manually."
        : `The AI provider returned no answer. ${unchanged}`,
    );
  const reason = candidate.finishReason;
  if (reason === "MAX_TOKENS")
    throw new Error(
      "The AI reply was cut off before it finished. Try a shorter message or enter the terms manually.",
    );
  if (reason && reason !== "STOP")
    throw new Error(
      `The AI provider stopped early${/^[A-Z_]{1,40}$/.test(reason) ? ` (${reason})` : ""}. Enter the terms manually.`,
    );
  const text =
    candidate.content?.parts
      ?.filter((p) => !p.thought)
      .map((p) => p.text || "")
      .join("") || "";
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error(
      "The AI reply was not valid JSON. Enter the terms manually or try again.",
    );
  }
  try {
    return {
      draft: validateDraft(value, message, duration, remaining, current),
      model,
    };
  } catch (e) {
    throw new Error(
      e instanceof DraftError
        ? `The AI response did not pass the studio's checks. ${e.message} Enter the terms manually or try a clearer message.`
        : "The AI response did not pass the studio's checks. Enter the terms manually or try a clearer message.",
    );
  }
}
