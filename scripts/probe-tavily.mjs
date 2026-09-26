import { fetch, ProxyAgent } from "undici";

const key = process.env.TAVILY_API_KEY;
if (!key) {
  console.error("TAVILY_KEY_MISSING");
  process.exit(2);
}

const dispatcher = process.env.OUTBOUND_PROXY_URL
  ? new ProxyAgent(process.env.OUTBOUND_PROXY_URL)
  : undefined;

const base = {
  query: "Express 5 wildcard migration official",
  search_depth: "advanced",
  topic: "general",
  max_results: 3,
  include_domains: ["expressjs.com", "github.com"],
  include_domains_mode: "restrict",
};

for (const mode of ["bearer", "body"]) {
  const headers = { "content-type": "application/json" };
  const body = { ...base };

  if (mode === "bearer") {
    headers.authorization = "Bearer " + key;
  } else {
    body.api_key = key;
  }

  try {
    const response = await fetch("https://api.tavily.com/search", {
      dispatcher,
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });

    console.log("TAVILY_" + mode.toUpperCase() + "_STATUS=" + response.status);
    const text = await response.text();
    if (!response.ok) {
      console.log("TAVILY_" + mode.toUpperCase() + "_ERROR=" + text.slice(0, 600));
    } else {
      const data = JSON.parse(text);
      console.log("TAVILY_" + mode.toUpperCase() + "_RESULTS=" + (data.results?.length || 0));
      for (const item of (data.results || []).slice(0, 3)) {
        console.log("SOURCE=" + item.title + " | " + item.url);
      }
    }
  } catch (error) {
    console.log("TAVILY_" + mode.toUpperCase() + "_EXCEPTION=" + error.message);
  }
}

if (dispatcher?.close) await dispatcher.close();
