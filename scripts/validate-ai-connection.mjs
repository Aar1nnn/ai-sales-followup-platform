const baseUrl = process.env.AI_BASE_URL?.replace(/\/$/, "");
const apiKey = process.env.AI_API_KEY;
const model = process.env.AI_MODEL || "qwen3.7-plus";
if (!baseUrl || !apiKey) throw new Error("AI_BASE_URL and AI_API_KEY are required.");
const response = await fetch(`${baseUrl}/chat/completions`, {
  method: "POST",
  headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
  body: JSON.stringify({ model, temperature: 0, max_tokens: 8, messages: [{ role: "user", content: "Reply with OK." }] }),
  signal: AbortSignal.timeout(20_000),
});
if (!response.ok) {
  const safeBody = (await response.text()).slice(0, 500).replace(/[A-Za-z0-9_-]{24,}/g, "[redacted]");
  throw new Error(`Model validation failed (${response.status}): ${safeBody}`);
}
const result = await response.json();
if (!result?.choices?.[0]?.message) throw new Error("Provider returned an incompatible response.");
console.log(JSON.stringify({ ok: true, model_requested: model, model_returned: result.model || null }));
