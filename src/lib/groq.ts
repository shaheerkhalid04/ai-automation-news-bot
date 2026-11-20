import { config } from "./config";

const ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";

/** Tokens a reasoning model may spend thinking, on top of the reply itself. */
export const REASONING_HEADROOM = 512;

/**
 * gpt-oss models reason before they answer, and that reasoning counts against
 * max_tokens. Low effort keeps each call quick and inside the budget.
 */
export function reasoningParams(model: string): { reasoning_effort?: "low" } {
  return model.startsWith("openai/gpt-oss") ? { reasoning_effort: "low" } : {};
}

export type ModelCheck =
  | { ok: true; model: string; latency_ms: number }
  | { ok: false; model: string; error: string };

/** One tiny real call to the configured model, for the health check. Never throws. */
export async function verifyModel(): Promise<ModelCheck> {
  const model = config.groqModel;
  if (!config.groqApiKey) return { ok: false, model, error: "GROQ_API_KEY is not set" };

  const started = performance.now();
  try {
    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.groqApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: 64,
        ...reasoningParams(model),
        messages: [{ role: "user", content: "Reply with OK." }],
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) return { ok: false, model, error: `Groq responded ${response.status}` };
    return { ok: true, model, latency_ms: Math.round(performance.now() - started) };
  } catch (error) {
    return { ok: false, model, error: error instanceof Error ? error.name : "request failed" };
  }
}
