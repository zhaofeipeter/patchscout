import type { AgentRequest, AgentResult, AgentStep, ResearchSource, TestResult } from "./types";


const TAVILY_URL = "https://api.tavily.com/search";
const NEBIUS_BASE_URL = "https://api.tokenfactory.nebius.com/v1";
const DEFAULT_MODEL = "nvidia/nemotron-3-super-120b-a12b";

async function resilientFetch(
  input: string,
  init?: RequestInit,
): Promise<Response> {
  let lastError: unknown;
  const delays = [500, 1000, 2000, 4000];

  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const response = await fetch(input, {
        ...init,
        signal: init?.signal ?? AbortSignal.timeout(30_000),
      });
      const retryable = [429, 500, 502, 503, 504].includes(response.status);
      if (!retryable || attempt === 4) return response;
    } catch (error) {
      lastError = error;
      if (attempt === 4) break;
    }

    await new Promise((resolve) =>
      setTimeout(resolve, delays[Math.min(attempt, delays.length - 1)]),
    );
  }

  let host = input;
  try {
    host = new URL(input).hostname;
  } catch {
    // Preserve the original input when it is not a URL.
  }

  const detail =
    lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error("Network request failed for " + host + ": " + detail);
}

function demoResult(input: AgentRequest): AgentResult {
  const sources: ResearchSource[] = [
    {
      title: "Moving to Express 5",
      url: "https://expressjs.com/en/guide/migrating-5.html",
      snippet:
        "Express 5 requires named wildcards in route paths. The migration guide documents /*splat and /{*splat} when the root path must also match.",
      score: 0.99,
    },
    {
      title: "Express 5 API reference",
      url: "https://expressjs.com/en/5x/api.html",
      snippet:
        "The Express 5 API reference is the current source of truth for routing and middleware behavior.",
      score: 0.96,
    },
  ];

  const steps: AgentStep[] = [
    {
      stage: "intake",
      title: "Reproduce the baseline failure",
      detail:
        "Demo transcript: the Express 5 app fails during route registration with the unnamed catch-all wildcard.",
      status: "complete",
      durationMs: 820,
    },
    {
      stage: "research",
      title: "Retrieve current upstream guidance",
      detail:
        "Tavily-style evidence pass selects the official Express 5 migration guide and API reference instead of relying on model memory.",
      status: "complete",
      durationMs: 640,
    },
    {
      stage: "diagnose",
      title: "Connect the failure to the breaking change",
      detail:
        "Nemotron identifies the unnamed wildcard as the smallest root cause consistent with the observed stack trace and migration guide.",
      status: "complete",
      durationMs: 980,
    },
    {
      stage: "patch",
      title: "Propose the minimal route change",
      detail:
        "The patch keeps the fallback behavior while changing only the incompatible catch-all syntax.",
      status: "complete",
      durationMs: 410,
    },
    {
      stage: "verify",
      title: "Rerun the original verification",
      detail:
        "Demo transcript: the same test command is rerun after the patch and the route behavior is preserved.",
      status: "complete",
      durationMs: 1170,
    },
  ];

  const tests: TestResult[] = [
    {
      command: "npm test",
      status: "passed",
      output:
        "DEMO TRANSCRIPT\nPASS 8 tests\n0 failed\nFallback route serves / and nested client routes.",
    },
  ];

  return {
    mode: "demo",
    model: DEFAULT_MODEL,
    repoUrl: input.repoUrl,
    incident: input.incident,
    summary:
      "Demo transcript: PatchScout grounds the Express 5 migration in current upstream guidance, isolates the route-syntax change, and requires the original verification command to pass before calling the migration complete.",
    rootCause:
      "Express 5 changed wildcard path matching: unnamed * wildcards are no longer valid. A named wildcard is required; /{*splat} preserves catch-all behavior including the root path.",
    patchPlan: [
      "Keep the existing fallback handler and middleware order unchanged.",
      "Replace the unnamed catch-all path with the Express 5-compatible named wildcard form.",
      "Run the same regression command used to reproduce the failure.",
      "Keep the pre-patch sandbox checkpoint as the rollback point.",
    ],
    diff:
      [
        "--- a/src/app.ts",
        "+++ b/src/app.ts",
        "@@",
        "- app.all(\"*\", fallbackHandler);",
        "+ app.all(\"/{*splat}\", fallbackHandler);",
      ].join("\n"),
    tests,
    rollback:
      "Restore the pre-patch Token Factory Sandbox checkpoint or revert the one-line route change.",
    confidence: 0.96,
    sources,
    steps,
  };
}

type TavilyItem = {
  title?: string;
  url?: string;
  content?: string;
  score?: number;
};

async function inferOfficialDomains(repoUrl: string): Promise<string[]> {
  const domains = new Set<string>(["github.com"]);

  try {
    const url = new URL(repoUrl);
    if (url.hostname !== "github.com") return [...domains];

    const [owner, repo] = url.pathname.split("/").filter(Boolean);
    if (!owner || !repo) return [...domains];

    const response = await resilientFetch(
      "https://api.github.com/repos/" +
        encodeURIComponent(owner) +
        "/" +
        encodeURIComponent(repo.replace(/\.git$/, "")),
      {
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": "PatchScout/1.0",
        },
        cache: "no-store",
      },
    );

    if (!response.ok) return [...domains];

    const metadata = (await response.json()) as { homepage?: string | null };
    if (metadata.homepage) {
      try {
        const homepage = new URL(metadata.homepage);
        if (homepage.hostname) domains.add(homepage.hostname);
      } catch {
        // Ignore malformed repository homepage metadata.
      }
    }
  } catch {
    // A malformed repo URL should not block broad research.
  }

  return [...domains];
}

async function tavilySearch(
  query: string,
  includeDomains?: string[],
): Promise<TavilyItem[]> {
  const apiKey = process.env.TAVILY_API_KEY;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (!apiKey) headers["X-Tavily-Access-Mode"] = "keyless";

  const response = await resilientFetch(TAVILY_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({
      ...(apiKey ? { api_key: apiKey } : {}),
      query,
      search_depth: "advanced",
      topic: "general",
      max_results: includeDomains?.length ? 5 : 6,
      include_answer: false,
      include_raw_content: false,
      ...(includeDomains?.length
        ? { include_domains: includeDomains, include_domains_mode: "restrict" }
        : {}),
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      "Tavily search failed (" +
        response.status +
        "): " +
        body.slice(0, 240),
    );
  }

  const data = (await response.json()) as { results?: TavilyItem[] };
  return data.results || [];
}

async function researchIncident(input: AgentRequest): Promise<ResearchSource[]> {
  const query =
    input.incident +
    " official migration guide changelog breaking change current documentation";

  const officialDomains = await inferOfficialDomains(input.repoUrl);
  let official: TavilyItem[] = [];
  try {
    official = await tavilySearch(query, officialDomains);
  } catch {
    // Official-source pass is best-effort; broad research can still proceed.
  }
  const broad = await tavilySearch(query);

  const officialSet = new Set(officialDomains);
  const trustScore = (item: TavilyItem) => {
    if (!item.url) return 0;
    try {
      const host = new URL(item.url).hostname;
      if (host !== "github.com" && officialSet.has(host)) return 2;
      if (host === "github.com" && officialSet.has(host)) return 1;
    } catch {}
    return 0;
  };
  const merged = [...official, ...broad].sort(
    (a, b) => trustScore(b) - trustScore(a),
  );
  const seen = new Set<string>();
  const sources: ResearchSource[] = [];

  for (const item of merged) {
    if (!item.title || !item.url || seen.has(item.url)) continue;
    seen.add(item.url);
    sources.push({
      title: item.title,
      url: item.url,
      snippet: (item.content || "").slice(0, 900),
      score: item.score,
    });
    if (sources.length >= 8) break;
  }

  return sources;
}

function parseJsonObject(text: string): Record<string, unknown> {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const candidate = fenced ? fenced[1] : text;
  const first = candidate.indexOf("{");
  const last = candidate.lastIndexOf("}");
  if (first < 0 || last <= first) {
    throw new Error("Nemotron response did not contain a JSON object.");
  }
  return JSON.parse(candidate.slice(first, last + 1)) as Record<string, unknown>;
}

async function reasonWithNemotron(
  input: AgentRequest,
  sources: ResearchSource[],
): Promise<{
  summary: string;
  rootCause: string;
  patchPlan: string[];
  diff: string;
  tests: TestResult[];
  rollback: string;
  confidence: number;
  raw: string;
}> {
  const apiKey = process.env.NEBIUS_API_KEY;
  if (!apiKey) throw new Error("NEBIUS_API_KEY is not configured.");

  const baseUrl = (process.env.NEBIUS_BASE_URL || NEBIUS_BASE_URL).replace(
    /\/$/,
    "",
  );
  const model = process.env.NEBIUS_MODEL || DEFAULT_MODEL;
  const evidence = sources
    .map(
      (source, index) =>
        "[" +
        (index + 1) +
        "] " +
        source.title +
        "\nURL: " +
        source.url +
        "\n" +
        source.snippet,
    )
    .join("\n\n");

  const prompt = [
    "You are PatchScout, a source-grounded dependency migration agent.",
    "Repository: " + input.repoUrl,
    "",
    "Incident:",
    input.incident,
    "",
    "Live evidence:",
    evidence,
    "",
    "Use only claims supported by the incident or the supplied evidence.",
    "Prefer the smallest reversible patch. Do not claim tests passed unless execution evidence is supplied.",
    "Return strict JSON with keys: summary, rootCause, patchPlan (array), diff, tests (array of {command,status,output}), rollback, confidence.",
    'For tests, status must be "planned" unless the prompt itself contains actual execution output.',
  ].join("\n");

  const response = await resilientFetch(baseUrl + "/chat/completions", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0.1,
      max_tokens: 1800,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You are a senior software migration engineer. Be conservative, evidence-driven, and explicit about what has and has not been executed.",
        },
        { role: "user", content: prompt },
      ],
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      "Nebius Token Factory failed (" +
        response.status +
        "): " +
        body.slice(0, 260),
    );
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const raw = payload.choices?.[0]?.message?.content || "";
  const parsed = parseJsonObject(raw);

  const tests = Array.isArray(parsed.tests)
    ? (parsed.tests as Array<Record<string, unknown>>).slice(0, 6).map<TestResult>((test) => ({
        command: typeof test.command === "string" ? test.command : "npm test",
        status:
          test.status === "passed" || test.status === "failed"
            ? test.status
            : "planned",
        output:
          typeof test.output === "string"
            ? test.output
            : "Execution pending in Token Factory Sandbox.",
      }))
    : [
        {
          command: "npm test",
          status: "planned" as const,
          output: "Execution pending in Token Factory Sandbox.",
        },
      ];

  return {
    summary:
      typeof parsed.summary === "string"
        ? parsed.summary
        : "Source-grounded migration analysis completed.",
    rootCause:
      typeof parsed.rootCause === "string"
        ? parsed.rootCause
        : "Root cause requires repository execution to confirm.",
    patchPlan: Array.isArray(parsed.patchPlan)
      ? parsed.patchPlan.filter((item): item is string => typeof item === "string").slice(0, 8)
      : [],
    diff: typeof parsed.diff === "string" ? parsed.diff : "",
    tests,
    rollback:
      typeof parsed.rollback === "string"
        ? parsed.rollback
        : "Restore the pre-patch sandbox checkpoint.",
    confidence:
      typeof parsed.confidence === "number"
        ? Math.max(0, Math.min(1, parsed.confidence))
        : 0.7,
    raw,
  };
}

export async function runPatchScout(input: AgentRequest): Promise<AgentResult> {
  const live =
    process.env.PATCHSCOUT_MODE === "live" &&
    Boolean(process.env.NEBIUS_API_KEY);

  if (!live) return demoResult(input);

  const steps: AgentStep[] = [
    {
      stage: "intake",
      title: "Capture the incident",
      detail:
        "Repository and failure context accepted. Sandbox execution is kept separate from reasoning so unexecuted claims cannot be marked verified.",
      status: "complete",
      durationMs: 50,
    },
  ];

  const researchStarted = Date.now();
  const sources = await researchIncident(input);
  steps.push({
    stage: "research",
    title: "Retrieve live migration evidence",
    detail:
      "Tavily returned " +
      sources.length +
      " current sources for the observed dependency drift.",
    status: "complete",
    durationMs: Date.now() - researchStarted,
  });

  const reasoningStarted = Date.now();
  const reasoning = await reasonWithNemotron(input, sources);
  steps.push({
    stage: "diagnose",
    title: "Nemotron diagnoses against the evidence",
    detail:
      "The reasoning pass is source-grounded and explicitly separates diagnosis from execution.",
    status: "complete",
    durationMs: Date.now() - reasoningStarted,
  });
  steps.push({
    stage: "patch",
    title: "Prepare a reversible candidate patch",
    detail:
      "Patch plan generated. Applying it is gated on Token Factory Sandbox access.",
    status: "pending",
  });
  steps.push({
    stage: "verify",
    title: "Verify in an isolated sandbox",
    detail:
      "Pending: branch from a clean checkpoint, apply the candidate, and rerun the original verification command.",
    status: "pending",
  });

  return {
    mode: "live",
    model: process.env.NEBIUS_MODEL || DEFAULT_MODEL,
    repoUrl: input.repoUrl,
    incident: input.incident,
    summary: reasoning.summary,
    rootCause: reasoning.rootCause,
    patchPlan: reasoning.patchPlan,
    diff: reasoning.diff,
    tests: reasoning.tests,
    rollback: reasoning.rollback,
    confidence: reasoning.confidence,
    sources,
    steps,
    rawModelOutput: reasoning.raw,
  };
}

