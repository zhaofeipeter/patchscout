const base = (process.env.NEBIUS_BASE_URL || "https://api.tokenfactory.nebius.com/v1").replace(/\/$/, "");
const key = process.env.NEBIUS_API_KEY;
const model = process.env.NEBIUS_MODEL || "nvidia/nemotron-3-super-120b-a12b";

if (!key) {
  console.error("NEBIUS_PROBE_CONFIG_MISSING");
  process.exit(2);
}

const payload = {
  model,
  temperature: 0,
  max_tokens: 80,
  reasoning_effort: "low",
  reasoning_budget: 128,
  response_format: { type: "json_object" },
  messages: [
    {
      role: "user",
      content: 'Return JSON exactly like {"ok":true,"message":"PATCHSCOUT_OK"}',
    },
  ],
};

let lastError;
for (let attempt = 1; attempt <= 5; attempt += 1) {
  const started = Date.now();
  try {
    const response = await fetch(base + "/chat/completions", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + key,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30_000),
    });
    const text = await response.text();
    console.log("ATTEMPT=" + attempt + " STATUS=" + response.status + " MS=" + (Date.now() - started));
    if (response.ok) {
      const parsed = JSON.parse(text);
      console.log("MODEL=" + (parsed.model || model));
      console.log("CONTENT=" + (parsed.choices?.[0]?.message?.content || "").slice(0, 300));
      process.exit(0);
    }
    console.log("BODY=" + text.slice(0, 500));
    if (![429, 500, 502, 503, 504].includes(response.status)) process.exit(3);
  } catch (error) {
    lastError = error;
    console.log("ATTEMPT=" + attempt + " ERROR=" + (error instanceof Error ? error.message : String(error)) + " MS=" + (Date.now() - started));
  }
  await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** (attempt - 1)));
}

console.error("NEBIUS_PROBE_FAILED=" + (lastError instanceof Error ? lastError.message : String(lastError)));
process.exit(4);
