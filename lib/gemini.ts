import { validateDraft, preferencePrompt } from "./preference.ts";
export async function readPreference(
  key: string,
  model: string,
  message: string,
  duration: number,
  remaining: number,
  send: typeof fetch = fetch,
) {
  if (!/^[a-zA-Z0-9.-]+$/.test(model))
    throw new Error("Invalid AI model configuration.");
  const res = await send(
    "https://generativelanguage.googleapis.com/v1beta/models/" +
      model +
      ":generateContent",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      signal: AbortSignal.timeout(30000),
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [{ text: preferencePrompt(message, duration, remaining) }],
          },
        ],
        generationConfig: {
          temperature: 0,
          maxOutputTokens: 4096,
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
  if (!res.ok)
    throw new Error(
      "The AI provider could not read this message. Your current terms are unchanged.",
    );
  const body = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const text =
    body.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") ||
    "";
  try {
    return {
      draft: validateDraft(JSON.parse(text), message, duration, remaining),
      model,
    };
  } catch {
    throw new Error(
      "The AI response did not pass the studio's checks. Enter the terms manually or try a clearer message.",
    );
  }
}
