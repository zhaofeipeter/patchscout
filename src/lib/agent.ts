import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AgentRequest, AgentResult, AgentStep, ResearchSource, TestResult } from "./types";
import {
  executeMigrationInSandbox,
  executePatchOnSandboxImage,
  type PatchEdit,
} from "./sandbox";
import { inspectRepository, type RepositorySnapshot } from "./repo-inspector";
import { outboundFetch } from "./outbound-fetch";


const TAVILY_URL = "https://api.tavily.com/search";
const NEBIUS_BASE_URL = "https://api.tokenfactory.nebius.com/v1";
const DEFAULT_MODEL = "nvidia/nemotron-3-super-120b-a12b";
const RESEARCH_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

type ResearchMode = "tavily" | "cache" | "metadata-fallback";

function researchCacheFile(input: AgentRequest, dependencies: string[]): string {
  const key = createHash("sha256")
    .update(input.repoUrl + "\n" + input.incident + "\n" + dependencies.sort().join(","))
    .digest("hex");
  return path.join(process.cwd(), ".patchscout-cache", "research-" + key + ".json");
}

async function readResearchCache(
  input: AgentRequest,
  dependencies: string[],
): Promise<ResearchSource[]> {
  try {
    const file = researchCacheFile(input, [...dependencies]);
    const parsed = JSON.parse(await readFile(file, "utf8")) as {
      savedAt?: number;
      sources?: ResearchSource[];
    };
    if (
      typeof parsed.savedAt === "number" &&
      Date.now() - parsed.savedAt <= RESEARCH_CACHE_TTL_MS &&
      Array.isArray(parsed.sources)
    ) {
      return parsed.sources;
    }
  } catch {}
  return [];
}

async function writeResearchCache(
  input: AgentRequest,
  dependencies: string[],
  sources: ResearchSource[],
): Promise<void> {
  try {
    const file = researchCacheFile(input, [...dependencies]);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(
      file,
      JSON.stringify({ savedAt: Date.now(), sources }, null, 2),
      "utf8",
    );
  } catch {
    // Research caching must never block a migration run.
  }
}


async function resilientFetch(
  input: string,
  init?: RequestInit,
): Promise<Response> {
  let lastError: unknown;
  const delays = [500, 1000, 2000, 4000];

  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const response = await outboundFetch(input, {
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

async function quickFetch(
  input: string,
  init?: RequestInit,
): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await outboundFetch(input, {
        ...init,
        signal: AbortSignal.timeout(8_000),
      });
      if (
        ![429, 500, 502, 503, 504].includes(response.status) ||
        attempt === 1
      ) {
        return response;
      }
    } catch (error) {
      lastError = error;
      if (attempt === 1) break;
    }
    await new Promise((resolve) => setTimeout(resolve, 350));
  }

  throw lastError instanceof Error
    ? new Error("Fast external fetch failed: " + lastError.message)
    : new Error("Fast external fetch failed.");
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
  raw_content?: string;
  score?: number;
};

async function inferOfficialDomains(
  repoUrl: string,
  dependencies: string[],
): Promise<string[]> {
  const domains = new Set<string>(["github.com"]);

  const addHost = (value?: string | null) => {
    if (!value) return;
    let normalized = value.trim().replace(/^git\+/, "");
    if (normalized.startsWith("git://")) {
      normalized = "https://" + normalized.slice("git://".length);
    }
    try {
      const parsed = new URL(normalized);
      if (parsed.hostname) domains.add(parsed.hostname);
    } catch {
      // Ignore non-URL metadata.
    }
  };

  const tasks: Array<Promise<void>> = [];

  try {
    const url = new URL(repoUrl);
    if (url.hostname === "github.com") {
      const [owner, repo] = url.pathname.split("/").filter(Boolean);
      if (owner && repo) {
        tasks.push(
          (async () => {
            try {
              const response = await quickFetch(
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
              if (!response.ok) return;
              const metadata = (await response.json()) as {
                homepage?: string | null;
              };
              addHost(metadata.homepage);
            } catch {
              // Repository homepage discovery is best-effort.
            }
          })(),
        );
      }
    }
  } catch {
    // Repository metadata is best-effort.
  }

  for (const dependency of dependencies.slice(0, 2)) {
    tasks.push(
      (async () => {
        try {
          const response = await quickFetch(
            "https://registry.npmjs.org/" +
              encodeURIComponent(dependency) +
              "/latest",
            { cache: "no-store" },
          );
          if (!response.ok) return;
          const metadata = (await response.json()) as {
            homepage?: string | null;
            repository?: string | { url?: string | null } | null;
            bugs?: { url?: string | null } | null;
          };
          addHost(metadata.homepage);
          addHost(
            typeof metadata.repository === "string"
              ? metadata.repository
              : metadata.repository?.url,
          );
          addHost(metadata.bugs?.url);
        } catch {
          // Package metadata discovery is best-effort.
        }
      })(),
    );
  }

  await Promise.allSettled(tasks);
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
  if (apiKey) {
    headers.Authorization = "Bearer " + apiKey;
  } else {
    headers["X-Tavily-Access-Mode"] = "keyless";
  }

  const response = await quickFetch(TAVILY_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({
      query,
      search_depth: apiKey ? "advanced" : "basic",
      topic: "general",
      max_results: includeDomains?.length ? 6 : 6,
      include_answer: false,
      include_raw_content: apiKey ? "markdown" : false,
      chunks_per_source: apiKey ? 5 : 3,
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

const EVIDENCE_STOP_WORDS = new Set([
  "this", "that", "with", "from", "after", "before", "while", "into",
  "have", "will", "should", "could", "would", "when", "where", "which",
  "their", "there", "using", "used", "same", "both", "current", "existing",
  "public", "apply", "smallest", "safe", "patch", "verify", "exactly",
]);

function buildEvidenceSnippet(item: TavilyItem, relevanceText: string): string {
  const content = item.content?.trim() || "";
  const raw = item.raw_content?.trim() || "";
  const rawWindows: string[] = [];

  if (raw) {
    const termText = (relevanceText + " " + content.slice(0, 2200)).toLowerCase();
    const terms = [...new Set(termText.match(/[a-z][a-z0-9_-]{3,}/g) || [])]
      .filter((term) => !EVIDENCE_STOP_WORDS.has(term))
      .slice(0, 28);
    const lower = raw.toLowerCase();
    const candidates: Array<{ start: number; end: number; score: number }> = [];

    const addCandidate = (index: number, tokenLength: number, bonus = 0) => {
      if (index < 0) return;
      const start = Math.max(0, index - 650);
      const end = Math.min(raw.length, index + tokenLength + 900);
      const window = lower.slice(start, end);
      const score =
        terms.reduce(
          (total, candidate) => total + Number(window.includes(candidate)),
          0,
        ) + bonus;
      candidates.push({ start, end, score });
    };

    for (const term of terms) {
      let cursor = 0;
      let matches = 0;
      while (matches < 3) {
        const index = lower.indexOf(term, cursor);
        if (index < 0) break;
        addCandidate(index, term.length);
        cursor = index + term.length;
        matches += 1;
      }
    }

    const contentWords =
      content.toLowerCase().match(/[a-z][a-z0-9_-]{2,}/g) || [];
    const anchors = new Set<string>();
    for (let i = 0; i < contentWords.length - 1; i += 1) {
      const left = contentWords[i];
      const right = contentWords[i + 1];
      if (
        EVIDENCE_STOP_WORDS.has(left) ||
        EVIDENCE_STOP_WORDS.has(right) ||
        left.length < 4 ||
        right.length < 4
      ) {
        continue;
      }
      anchors.add(left + " " + right);
      if (anchors.size >= 24) break;
    }

    for (const anchor of anchors) {
      let cursor = 0;
      let matches = 0;
      while (matches < 2) {
        const index = lower.indexOf(anchor, cursor);
        if (index < 0) break;
        addCandidate(index, anchor.length, 6);
        cursor = index + anchor.length;
        matches += 1;
      }
    }

    candidates.sort((a, b) => b.score - a.score || a.start - b.start);

    const selected: Array<{ start: number; end: number }> = [];
    for (const candidate of candidates) {
      const overlap = selected.some(
        (existing) =>
          Math.max(existing.start, candidate.start) <
          Math.min(existing.end, candidate.end),
      );
      if (overlap) continue;
      selected.push(candidate);
      if (selected.length >= 2) break;
    }

    if (!selected.length) {
      selected.push({ start: 0, end: Math.min(1800, raw.length) });
    }

    for (const window of selected) {
      rawWindows.push(
        "Raw official-text window:\n" + raw.slice(window.start, window.end),
      );
    }
  }

  const rawSection = rawWindows.join("\n\n").slice(0, 3300);
  const contentSection = content
    ? "Tavily relevant excerpt:\n" + content.slice(0, 1600)
    : "";

  return [rawSection, contentSection].filter(Boolean).join("\n\n").slice(0, 5000);
}

async function researchIncident(
  input: AgentRequest,
  dependencies: string[],
): Promise<{ sources: ResearchSource[]; mode: ResearchMode }> {
  const query =
    input.incident +
    " official migration guide changelog breaking change current documentation";

  const rankedDependencies = [...dependencies].sort((a, b) => {
    const text = input.incident.toLowerCase();
    return Number(text.includes(b.toLowerCase())) -
      Number(text.includes(a.toLowerCase()));
  });
  const officialDomains = await inferOfficialDomains(
    input.repoUrl,
    rankedDependencies,
  );
  let official: TavilyItem[] = [];
  let broad: TavilyItem[] = [];
  const topDependency = rankedDependencies[0] || "";
  const exactOfficialQuery = [
    topDependency,
    "official migration guide",
    "wildcard route syntax",
    "named wildcard root path splat braces",
    "breaking changes examples",
  ]
    .filter(Boolean)
    .join(" ");
  try {
    const [exactOfficial, incidentOfficial] = await Promise.all([
      tavilySearch(exactOfficialQuery, officialDomains),
      tavilySearch(query, officialDomains),
    ]);
    official = [...exactOfficial, ...incidentOfficial];
  } catch {
    // Fall through to the broad pass.
  }

  if (official.length < 5) {
    try {
      broad = await tavilySearch(query);
    } catch {
      // One successful pass is enough to keep the agent moving.
    }
  }

  if (!official.length && !broad.length) {
    const cached = await readResearchCache(input, rankedDependencies);
    if (cached.length) {
      return { sources: cached, mode: "cache" };
    }

    const fallback: ResearchSource[] = [
      {
        title: "[Fallback metadata] Repository",
        url: input.repoUrl,
        snippet:
          "Tavily was temporarily unavailable. This source is the inspected public repository, not a Tavily search result.",
      },
      ...officialDomains
        .filter((domain) => domain !== "github.com")
        .slice(0, 4)
        .map((domain) => ({
          title: "[Fallback metadata] Official domain: " + domain,
          url: "https://" + domain,
          snippet:
            "Official domain inferred from repository or npm package metadata while Tavily was unavailable.",
        })),
      ...rankedDependencies.slice(0, 3).map((dependency) => ({
        title: "[Fallback metadata] npm package: " + dependency,
        url: "https://www.npmjs.com/package/" + encodeURIComponent(dependency),
        snippet:
          "Package metadata fallback. Live Tavily research did not complete for this run.",
      })),
    ];
    return { sources: fallback, mode: "metadata-fallback" };
  }

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
      snippet: buildEvidenceSnippet(item, query + " " + input.incident),
      score: item.score,
    });
    if (sources.length >= 8) break;
  }

  await writeResearchCache(input, rankedDependencies, sources);
  return { sources, mode: "tavily" };
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
  repositoryContext: string,
  repairContext?: string,
): Promise<{
  summary: string;
  rootCause: string;
  patchPlan: string[];
  edits: PatchEdit[];
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
    "Repository snapshot (real paths and real file contents):",
    repositoryContext,
    "",
    "Previous sandbox execution feedback:",
    repairContext || "None — this is the first candidate.",
    "",
    "If previous sandbox feedback is present, produce a corrected candidate against the ORIGINAL repository snapshot, not a cumulative patch.",
    "Use only claims supported by the incident, repository snapshot, supplied evidence, or sandbox feedback.",
    "Prefer the smallest reversible patch. Never invent a file path.",
    "Every edit.path MUST exactly match a path shown in the repository snapshot.",
    "Every edit.search MUST be an exact literal substring copied from that file, and should be as small and unique as practical.",
    "Do not claim tests passed unless execution evidence is supplied.",
    "If the incident names an exact verification command, use that command verbatim.",
    "Return strict JSON with keys: summary, rootCause, patchPlan (array), edits (array of {path,search,replace}), tests (array of {command,status,output}), rollback, confidence.",
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
      max_tokens: 2800,
      reasoning_effort: "low",
      reasoning_budget: 1024,
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

  const edits: PatchEdit[] = Array.isArray(parsed.edits)
    ? (parsed.edits as Array<Record<string, unknown>>)
        .filter(
          (edit) =>
            typeof edit.path === "string" &&
            typeof edit.search === "string" &&
            typeof edit.replace === "string" &&
            edit.search.length > 0,
        )
        .slice(0, 8)
        .map((edit) => ({
          path: edit.path as string,
          search: edit.search as string,
          replace: edit.replace as string,
        }))
    : [];

  const diff = edits
    .map((edit) =>
      [
        "--- a/" + edit.path,
        "+++ b/" + edit.path,
        "@@ structured replacement @@",
        ...edit.search.split("\n").map((line) => "- " + line),
        ...edit.replace.split("\n").map((line) => "+ " + line),
      ].join("\n"),
    )
    .join("\n\n");

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
    edits,
    diff,
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

  const inspectionStarted = Date.now();
  console.info("[PatchScout] stage=inspect start");
  const snapshot: RepositorySnapshot = await inspectRepository(input.repoUrl);
  const inspectionMode = "GitHub/npm metadata";

  console.info(
    "[PatchScout] stage=inspect done ms=" +
      (Date.now() - inspectionStarted) +
      " files=" +
      snapshot.files.length +
      " mode=" +
      inspectionMode,
  );
  steps[0] = {
    stage: "intake",
    title: "Inspect the real repository",
    detail:
      "Read " +
      snapshot.files.length +
      " source/config/test files and identified " +
      snapshot.dependencies.length +
      " package dependencies via " +
      inspectionMode +
      " before asking the model to patch anything.",
    status: "complete",
    durationMs: Date.now() - inspectionStarted,
  };

  const researchStarted = Date.now();
  console.info("[PatchScout] stage=research start");
  const research = await researchIncident(input, snapshot.dependencies);
  const sources = research.sources;
  console.info(
    "[PatchScout] stage=research done ms=" +
      (Date.now() - researchStarted) +
      " sources=" +
      sources.length +
      " mode=" +
      research.mode,
  );
  steps.push({
    stage: "research",
    title:
      research.mode === "tavily"
        ? "Retrieve live migration evidence"
        : research.mode === "cache"
          ? "Reuse recent migration evidence"
          : "Degrade to official metadata",
    detail:
      research.mode === "tavily"
        ? "Tavily returned " +
          sources.length +
          " current sources, prioritizing official domains inferred from repository and package metadata."
        : research.mode === "cache"
          ? "Tavily was unavailable, so PatchScout used a successful research result cached less than 24 hours ago."
          : "Tavily and cache were unavailable. PatchScout continued only with explicitly labeled repository/npm official metadata fallbacks.",
    status: "complete",
    durationMs: Date.now() - researchStarted,
  });

  const reasoningStarted = Date.now();
  console.info("[PatchScout] stage=reason start");
  let reasoning = await reasonWithNemotron(
    input,
    sources,
    snapshot.context,
  );
  if (!reasoning.edits.length) {
    console.info("[PatchScout] stage=reason retry-empty-edits");
    reasoning = await reasonWithNemotron(
      input,
      sources,
      snapshot.context,
      "The previous reasoning response produced no executable structured edits. Return at least one exact path/search/replace edit grounded in the repository snapshot, unless no safe edit exists.",
    );
  }
  console.info("[PatchScout] stage=reason done ms=" + (Date.now() - reasoningStarted) + " edits=" + reasoning.edits.length);
  steps.push({
    stage: "diagnose",
    title: "Nemotron diagnoses against the evidence",
    detail:
      "The reasoning pass is source-grounded and explicitly separates diagnosis from execution.",
    status: "complete",
    durationMs: Date.now() - reasoningStarted,
  });

  let sandbox: AgentResult["sandbox"];
  let tests = reasoning.tests;

  try {
    const capability = {
      available: true,
      project:
        process.env.NEBIUS_PROJECT_ID?.trim() ||
        process.env.NEBIUS_SANDBOX_PROJECT?.trim() ||
        "default-project",
      message: "Sandbox access is exercised directly by the migration execution.",
    };

    if (!capability.available) {
      sandbox = {
        status: "waiting-permission",
        project: capability.project,
        message: capability.message,
      };

      steps.push({
        stage: "patch",
        title: "Prepare a reversible candidate patch",
        detail:
          "Patch is ready, but Token Factory Sandboxes spawn permission is still pending for this project.",
        status: "pending",
      });
      steps.push({
        stage: "verify",
        title: "Verify in an isolated sandbox",
        detail:
          "Nebius beta request is submitted. Verification will activate automatically when spawn permission is granted.",
        status: "pending",
      });
    } else {
      const testCommand = reasoning.tests[0]?.command || "npm test";
      if (!reasoning.edits.length) {
        throw new Error("Nemotron returned no structured edits to execute.");
      }

      steps.push({
        stage: "patch",
        title: "Apply the candidate inside Token Factory Sandbox",
        detail:
          "Cloning a clean repository snapshot, reproducing the baseline, and applying the model-generated patch in an isolated microVM.",
        status: "running",
      });

      console.info("[PatchScout] stage=sandbox-execute start");
      const sandboxExecuteStarted = Date.now();
      let execution = await executeMigrationInSandbox({
        repoUrl: input.repoUrl,
        edits: reasoning.edits,
        testCommand,
      });
      console.info("[PatchScout] stage=sandbox-execute done ms=" + (Date.now() - sandboxExecuteStarted) + " baseline=" + execution.baselineExit + " after=" + execution.afterExit);
      let repairAttempted = false;

      if (
        execution.baselineExit !== undefined &&
        execution.baselineExit !== 0 &&
        execution.afterExit !== 0
      ) {
        const repairFeedback = [
          "The first candidate was applied successfully but verification still failed.",
          "First candidate edits: " + JSON.stringify(reasoning.edits),
          "Baseline exit: " + String(execution.baselineExit),
          "Baseline output:\n" + (execution.baselineOutput || "").slice(0, 6000),
          "After exit: " + String(execution.afterExit),
          "After output:\n" + (execution.afterOutput || "").slice(0, 6000),
          "Return corrected structured edits against the original repository snapshot. Do not reuse an edit that the failing after-output disproves.",
        ].join("\n\n");

        try {
          console.info("[PatchScout] stage=repair-reason start");
          const repairReasonStarted = Date.now();
          const repairedReasoning = await reasonWithNemotron(
            input,
            sources,
            snapshot.context,
            repairFeedback,
          );

          console.info("[PatchScout] stage=repair-reason done ms=" + (Date.now() - repairReasonStarted) + " edits=" + repairedReasoning.edits.length);
          if (repairedReasoning.edits.length && execution.rollbackImage) {
            console.info("[PatchScout] stage=repair-execute start");
            const repairExecuteStarted = Date.now();
            const repairedPatch = await executePatchOnSandboxImage({
              baseImage: execution.rollbackImage,
              edits: repairedReasoning.edits,
              testCommand,
            });
            console.info("[PatchScout] stage=repair-execute done ms=" + (Date.now() - repairExecuteStarted) + " after=" + repairedPatch.afterExit);
            reasoning = repairedReasoning;
            execution = {
              ...repairedPatch,
              baselineExit: execution.baselineExit,
              baselineOutput: execution.baselineOutput,
              rollbackImage: execution.rollbackImage,
              message:
                "First candidate failed verification; automatic repair reused the clean dependency-installed checkpoint. " +
                repairedPatch.message,
            };
            repairAttempted = true;
          }
        } catch {
          // Keep the first executable result if the bounded repair pass itself fails.
        }
      }

      const reproduced =
        execution.baselineExit !== undefined && execution.baselineExit !== 0;
      const passed = reproduced && execution.afterExit === 0;

      steps[steps.length - 1] = {
        stage: "patch",
        title: "Apply the candidate inside Token Factory Sandbox",
        detail:
          (repairAttempted ? "Automatic repair pass completed. " : "") +
          execution.message,
        status: execution.available ? "complete" : "pending",
      };

      steps.push({
        stage: "verify",
        title: "Rerun the exact verification in the same sandbox branch",
        detail: passed
          ? "Baseline failed and the same verification command passed after the patch."
          : "Sandbox ran, but PatchScout did not observe the required failing-baseline → passing-after transition.",
        status: passed ? "complete" : "failed",
      });

      tests = [
        {
          command: testCommand,
          status: passed ? "passed" : "failed",
          output:
            "BASELINE exit=" +
            String(execution.baselineExit) +
            "\n" +
            (execution.baselineOutput || "") +
            "\n\nAFTER exit=" +
            String(execution.afterExit) +
            "\n" +
            (execution.afterOutput || "") +
            (execution.stderr
              ? "\n\nSTDERR\n" + execution.stderr
              : ""),
        },
      ];

      sandbox = {
        status: execution.available ? "executed" : "waiting-permission",
        project: capability.project,
        message: execution.message,
        operationId: execution.operationId,
        baselineExit: execution.baselineExit,
        afterExit: execution.afterExit,
        baselineOutput: execution.baselineOutput,
        afterOutput: execution.afterOutput,
        stderr: execution.stderr,
      };
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Sandbox execution failed.";
    sandbox = {
      status: "failed",
      message,
    };
    steps.push({
      stage: "patch",
      title: "Sandbox execution",
      detail: message,
      status: "failed",
    });
    steps.push({
      stage: "verify",
      title: "Verification not completed",
      detail:
        "PatchScout will not mark the migration verified without executable sandbox evidence.",
      status: "failed",
    });
  }

  return {
    mode: "live",
    model: process.env.NEBIUS_MODEL || DEFAULT_MODEL,
    repoUrl: input.repoUrl,
    incident: input.incident,
    summary: reasoning.summary,
    rootCause: reasoning.rootCause,
    patchPlan: reasoning.patchPlan,
    diff: reasoning.diff,
    tests,
    rollback: reasoning.rollback,
    confidence: reasoning.confidence,
    sources,
    steps,
    rawModelOutput: reasoning.raw,
    sandbox,
  };
}

